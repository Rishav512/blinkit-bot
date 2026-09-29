require('dotenv').config();
const { chromium } = require('playwright');
const path = require('path');
const readline = require('readline');
const http = require('http');

// Dummy server to bind to a port for Render.com free tier Web Service
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Blinkit Bot is running...\n');
}).listen(PORT, () => {
  console.log(`Dummy web server listening on port ${PORT}`);
});

// ==================== CONFIGURATION ====================
const CONFIG = {
  TARGET_PRODUCT_URLS: [
    'https://blinkit.com/prn/x/prid/804925',
    'https://blinkit.com/prn/x/prid/1383211',
    'https://blinkit.com/prn/x/prid/1382030',
  ],
  TARGET_ADDRESS_LABEL: 'Home',
  CHIPS_SEARCH_QUERY: 'lays chips 20',
  CHIPS_TARGET_PRICE: 20,
  POLL_INTERVAL_MS: 5 * 60 * 1000, // 5 minutes
  MIDNIGHT_BURST_WINDOW_MINS: 5,   // Rapid checks for 5 mins during 12:00 AM restock
  MIDNIGHT_BURST_INTERVAL_MS: 15000, // 15 seconds during midnight window
  MAX_RETRIES: 2000,
  AUTO_ORDER: true, // User requested: order on COD
  USER_DATA_DIR: path.join(__dirname, 'userData'),
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',
};

// ---------------- TELEGRAM NOTIFICATIONS ----------------
async function sendTelegramNotification(message) {
  const token = CONFIG.TELEGRAM_BOT_TOKEN;
  const chatId = CONFIG.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn('\n[!] Telegram Warning: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set in .env.');
    console.warn('    Could not dispatch Telegram alert. Please add your credentials in .env.\n');
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
      }),
    });

    const data = await response.json();
    if (data.ok) {
      console.log('📲 [Telegram] Notification sent successfully to user!');
      return true;
    } else {
      console.error(`[!] Telegram API Error: ${data.description || JSON.stringify(data)}`);
      return false;
    }
  } catch (err) {
    console.error('[!] Failed to send Telegram notification:', err.message);
    return false;
  }
}

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => rl.question(query, (ans) => {
    rl.close();
    resolve(ans);
  }));
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------- ADDRESS VERIFICATION ----------------
async function verifyAndSetAddress(page) {
  console.log('\n[Address Check] Verifying delivery address is set to Home...');
  try {
    await page.waitForLoadState('domcontentloaded');
    await sleep(2500);

    const locationSelectors = [
      'div[class*="LocationBar"]',
      'div[class*="location-bar"]',
      'div[class*="DeliveryAddress"]',
      'header div:has-text("Delivery in")',
      'header div:has-text("Detect my location")',
      'header div:has-text("Select Location")',
      'div[role="button"]:has-text("Delivery in")',
    ];

    let locationElement = null;
    for (const sel of locationSelectors) {
      const el = page.locator(sel).first();
      if (await el.count() > 0 && await el.isVisible()) {
        locationElement = el;
        break;
      }
    }

    if (locationElement) {
      const headerText = await locationElement.innerText();
      console.log(`Current Header Location: "${headerText.replace(/\n/g, ' ')}"`);

      if (headerText.toLowerCase().includes(CONFIG.TARGET_ADDRESS_LABEL.toLowerCase())) {
        console.log(`[OK] Address is already set to "${CONFIG.TARGET_ADDRESS_LABEL}".`);
        return true;
      }

      console.log(`Opening address selector to switch to "${CONFIG.TARGET_ADDRESS_LABEL}"...`);
      await locationElement.click();
      await sleep(2000);

      // Look for saved address labeled "Home"
      const homeOptions = page.locator(`div:has-text("${CONFIG.TARGET_ADDRESS_LABEL}"), button:has-text("${CONFIG.TARGET_ADDRESS_LABEL}"), span:has-text("${CONFIG.TARGET_ADDRESS_LABEL}"), p:has-text("${CONFIG.TARGET_ADDRESS_LABEL}")`);
      const count = await homeOptions.count();

      for (let i = 0; i < count; i++) {
        const item = homeOptions.nth(i);
        if (await item.isVisible()) {
          const txt = (await item.innerText()).trim();
          if (txt.toLowerCase() === CONFIG.TARGET_ADDRESS_LABEL.toLowerCase() || txt.toLowerCase().includes(CONFIG.TARGET_ADDRESS_LABEL.toLowerCase())) {
            console.log(`Selecting saved address: "${txt}"...`);
            await item.click();
            await sleep(3000);
            console.log(`[OK] Successfully switched address to "${CONFIG.TARGET_ADDRESS_LABEL}".`);
            return true;
          }
        }
      }

      console.log(`[!] Could not locate saved address labeled "${CONFIG.TARGET_ADDRESS_LABEL}" in the drawer.`);
    } else {
      console.log('[!] Location header element not detected. Will continue.');
    }
  } catch (err) {
    console.warn('[!] Address verification warning:', err.message);
  }
  return false;
}

// ---------------- PRODUCT RESTOCK CHECK ----------------
async function checkProductStockAndAdd(page, productUrl) {
  console.log(`\nNavigating to target product page: ${productUrl}`);
  await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(3500);

  // Evaluate stock status strictly for the target product
  const stockEvaluation = await page.evaluate(() => {
    const bodyText = document.body.innerText;

    // Identify where recommendation sections start ("Similar products", "You might also like", etc.)
    const allElements = Array.from(document.querySelectorAll('h2, h3, h4, div, span, p'));
    const recHeading = allElements.find((el) => {
      const t = (el.innerText || '').trim();
      return /^(similar products|you might also like|customers also bought|people also bought|more like this|related products|top picks)/i.test(t);
    });

    const recIdx = bodyText.search(/similar products|you might also like|customers also bought|people also bought|more like this|related products/i);
    const mainAreaText = recIdx !== -1 ? bodyText.slice(0, recIdx) : bodyText.slice(0, 3000);

    // Negative indicators for the target product
    if (/coming\s*soon/i.test(mainAreaText)) {
      return { status: 'COMING_SOON', message: 'Product is COMING SOON' };
    }
    if (/out\s*of\s*stock/i.test(mainAreaText)) {
      return { status: 'OUT_OF_STOCK', message: 'Product is OUT OF STOCK' };
    }
    if (/currently\s*unavailable/i.test(mainAreaText)) {
      return { status: 'UNAVAILABLE', message: 'Product is CURRENTLY UNAVAILABLE' };
    }
    if (/notify\s*me/i.test(mainAreaText)) {
      return { status: 'NOTIFY_ME', message: 'Product has NOTIFY ME button' };
    }
    if (/sold\s*out/i.test(mainAreaText)) {
      return { status: 'SOLD_OUT', message: 'Product is SOLD OUT' };
    }

    // Look for ADD button belonging strictly to the MAIN product (NOT recommendation cards/carousels)
    const allAddButtons = Array.from(document.querySelectorAll('button, div')).filter((el) => {
      const text = (el.innerText || '').trim();
      return /^add$/i.test(text) && el.children.length <= 1;
    });

    for (let i = 0; i < allAddButtons.length; i++) {
      const btn = allAddButtons[i];

      // Ignore buttons inside carousel, slider, or recommendation containers
      if (btn.closest('[class*="carousel" i], [class*="slider" i], [class*="recommendation" i], [class*="similar" i], [class*="Product__" i]')) {
        continue;
      }

      // Ignore buttons positioned after recommendation heading
      if (recHeading) {
        const position = recHeading.compareDocumentPosition(btn);
        if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
          continue;
        }
      }

      const rect = btn.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        btn.setAttribute('data-target-product-add-btn', 'true');
        return { status: 'IN_STOCK', message: 'Target product ADD button found' };
      }
    }

    return { status: 'NO_BUTTON', message: 'No main product ADD button found' };
  });

  if (stockEvaluation.status !== 'IN_STOCK') {
    console.log(`[!] ${stockEvaluation.message}.`);
    return false;
  }

  // Click the identified main product ADD button
  const addBtn = page.locator('[data-target-product-add-btn="true"]').first();
  if (await addBtn.count() > 0 && await addBtn.isVisible()) {
    console.log('\n========================================');
    console.log('🎉 TARGET PRODUCT IS IN STOCK! Clicking ADD...');
    console.log('========================================\n');
    await addBtn.scrollIntoViewIfNeeded();
    await sleep(500);
    await addBtn.click();
    await sleep(2500);
    console.log('[OK] Target product added to cart.');
    return true;
  }

  console.log('[!] Product page loaded, but valid main ADD button was not clickable.');
  return false;
}

// ---------------- ADD 20 RUPEE CHIPS ----------------
async function addTwentyRupeeChips(page) {
  console.log('\n[Adding ₹20 Chips] Searching for 20 rupee chips...');
  const searchUrl = `https://blinkit.com/s/?q=${encodeURIComponent(CONFIG.CHIPS_SEARCH_QUERY)}`;
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(3500);

  // Find product cards
  const cards = page.locator('div[class*="Product__"], div[class*="Card"], div:has(div:text-matches("^ADD$", "i"))');
  const cardCount = await cards.count();
  console.log(`Found ${cardCount} potential product cards on chips search page.`);

  let chipsAdded = false;

  for (let i = 0; i < Math.min(cardCount, 15); i++) {
    const card = cards.nth(i);
    if (await card.isVisible()) {
      const cardText = await card.innerText();
      const lower = cardText.toLowerCase();

      // Check if price mentions 20 or ₹20 and contains chips / lays / potato
      const hasTwentyPrice = cardText.includes('₹20') || cardText.includes('Rs 20') || cardText.includes('Rs. 20') || /\b20\b/.test(cardText);
      const isChips = lower.includes('chips') || lower.includes('lays') || lower.includes('kurkure') || lower.includes('potato');

      if (hasTwentyPrice && isChips) {
        console.log(`Selected chips candidate: "${cardText.split('\n').slice(0, 3).join(' ')}"`);
        const addBtn = card.locator('div:text-matches("^ADD$", "i"), button:text-matches("^ADD$", "i")').first();
        if (await addBtn.count() > 0 && await addBtn.isVisible()) {
          console.log('Clicking ADD for ₹20 chips...');
          await addBtn.scrollIntoViewIfNeeded();
          await sleep(500);
          await addBtn.click();
          await sleep(2500);
          console.log('[OK] 20 Rupee chips added to cart!');
          chipsAdded = true;
          break;
        }
      }
    }
  }

  if (!chipsAdded) {
    console.log('[!] Specific ₹20 text match not found, clicking first available ADD on chips search page...');
    const firstAdd = page.locator('div:text-matches("^ADD$", "i"), button:text-matches("^ADD$", "i")').first();
    if (await firstAdd.count() > 0 && await firstAdd.isVisible()) {
      await firstAdd.click();
      await sleep(2500);
      console.log('[OK] Added chips to cart.');
      chipsAdded = true;
    }
  }

  return chipsAdded;
}

// ---------------- CART & CHECKOUT COD ----------------
async function proceedToCheckoutAndPlaceOrderCOD(page) {
  console.log('\n[Checkout] Opening cart and proceeding to Cash on Delivery checkout...');

  // Click View Cart / Cart button
  const cartBtnSelectors = [
    'div:has-text("View Cart")',
    'button:has-text("View Cart")',
    'div[class*="CartBar"]',
    'div[class*="CartButton"]',
    'button:has-text("Cart")',
    'header div:has-text("Cart")',
  ];

  let cartClicked = false;
  for (const sel of cartBtnSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.count() > 0 && await btn.isVisible()) {
      console.log(`Clicking cart trigger ("${sel}")...`);
      await btn.click();
      cartClicked = true;
      break;
    }
  }

  if (!cartClicked) {
    console.log('Navigating directly to cart URL: https://blinkit.com/cart...');
    await page.goto('https://blinkit.com/cart', { waitUntil: 'domcontentloaded' });
  }

  await sleep(3000);

  // Verify delivery address inside cart / checkout drawer
  console.log('Verifying delivery address in cart drawer...');
  const addressBlock = page.locator(`div:has-text("${CONFIG.TARGET_ADDRESS_LABEL}")`).first();
  if (await addressBlock.count() > 0) {
    console.log(`[OK] Address confirmed as "${CONFIG.TARGET_ADDRESS_LABEL}".`);
  }

  // Click Proceed / Checkout button
  const proceedSelectors = [
    'button:has-text("Proceed to Pay")',
    'div[role="button"]:has-text("Proceed to Pay")',
    'button:has-text("Proceed")',
    'button:has-text("Checkout")',
    'div[role="button"]:has-text("Checkout")',
  ];

  for (const sel of proceedSelectors) {
    const pBtn = page.locator(sel).first();
    if (await pBtn.count() > 0 && await pBtn.isVisible()) {
      console.log(`Clicking "${await pBtn.innerText()}"...`);
      await pBtn.click();
      await sleep(3500);
      break;
    }
  }

  // Payment Screen: Look for Cash on Delivery
  console.log('Locating Cash on Delivery (COD) payment option...');
  await page.waitForLoadState('domcontentloaded');
  await sleep(2500);

  const codSelectors = [
    'div:text-matches("Cash on Delivery", "i")',
    'span:text-matches("Cash on Delivery", "i")',
    'p:text-matches("Cash on Delivery", "i")',
    'div:text-matches("Pay on Delivery", "i")',
    'label:has-text("Cash on Delivery")',
    'input[value*="COD"], input[value*="cod"]',
  ];

  let codSelected = false;
  for (const sel of codSelectors) {
    const codEl = page.locator(sel).first();
    if (await codEl.count() > 0 && await codEl.isVisible()) {
      console.log(`Found COD option: "${await codEl.innerText().catch(() => 'COD')}". Selecting...`);
      await codEl.scrollIntoViewIfNeeded();
      await codEl.click();
      await sleep(2000);
      codSelected = true;
      break;
    }
  }

  if (!codSelected) {
    console.warn('\n[!] WARNING: Cash on Delivery option was not found or is currently disabled by Blinkit for this order.');
    console.warn('    Please check the opened Chrome window to inspect available payment methods.');
    return false;
  }

  console.log('\n[FINAL STEP] Placing Order with Cash on Delivery...');
  const placeOrderSelectors = [
    'button:has-text("Place Order")',
    'div[role="button"]:has-text("Place Order")',
    'button:has-text("Confirm Order")',
    'button:has-text("Pay Cash on Delivery")',
  ];

  for (const sel of placeOrderSelectors) {
    const poBtn = page.locator(sel).first();
    if (await poBtn.count() > 0 && await poBtn.isVisible()) {
      console.log(`Clicking "${await poBtn.innerText()}"...`);
      await poBtn.click();
      await sleep(5000);
      console.log('\n====================================================');
      console.log('🎉 ORDER PLACED SUCCESSFULLY ON CASH ON DELIVERY! 🎉');
      console.log('====================================================\n');
      process.stdout.write('\x07');
      return true;
    }
  }

  console.log('[!] Place Order button was not automatically triggered. Please review the open browser window.');
  return false;
}

function calculateNextCheckSchedule() {
  const now = new Date();

  // Calculate next midnight (12:00:00 AM)
  const nextMidnight = new Date(now);
  nextMidnight.setHours(24, 0, 0, 0); // Next 00:00:00
  const msUntilMidnight = nextMidnight.getTime() - now.getTime();

  // Check if we are currently within the midnight restock window (00:00:00 to 00:05:00)
  const isMidnightWindow = (now.getHours() === 0 && now.getMinutes() < CONFIG.MIDNIGHT_BURST_WINDOW_MINS);

  if (isMidnightWindow) {
    return {
      waitMs: CONFIG.MIDNIGHT_BURST_INTERVAL_MS,
      reason: '⚡ 12:00 AM MIDNIGHT RESTOCK WINDOW (Rapid 15s polling)',
    };
  }

  // If next midnight arrives sooner than 15 minutes, pause until exactly 12:00:00 AM!
  if (msUntilMidnight > 0 && msUntilMidnight < CONFIG.POLL_INTERVAL_MS) {
    return {
      waitMs: msUntilMidnight,
      reason: '🎯 Scheduled for EXACTLY 12:00:00 AM Midnight Restock',
    };
  }

  return {
    waitMs: CONFIG.POLL_INTERVAL_MS,
    reason: 'Standard 5-minute interval',
  };
}

// ---------------- MAIN LOOP ----------------
async function run() {
  console.log('======================================================');
  console.log('   BLINKIT RESTOCK, CHIPS & COD AUTO-ORDER BOT       ');
  console.log('======================================================');
  console.log('Target Products to Monitor:');
  CONFIG.TARGET_PRODUCT_URLS.forEach((url, i) => console.log(`  [${i + 1}] ${url}`));
  console.log(`Address: "${CONFIG.TARGET_ADDRESS_LABEL}"`);
  console.log(`Extra item: 20 Rupee Chips`);
  console.log(`Payment method: Cash on Delivery (COD)`);
  console.log(`Polling: Every 5 minutes + Sharp 12:00 AM Restock Surge\n`);

  console.log('Launching Chromium with persistent session profile...');
  let context = null;
  try {
    context = await chromium.launchPersistentContext(CONFIG.USER_DATA_DIR, {
      headless: true,
      viewport: null,
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--start-maximized',
        '--disable-blink-features=AutomationControlled',
        '--no-default-browser-check',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ],
    });
  } catch (err) {
    if (err.message.includes('Process singleton lock') || err.message.includes('Target page, context or browser has been closed')) {
      console.error('\n[!] Chrome profile is locked because an existing Chrome window is already open.');
      console.error('    Please close any other Chrome windows that were opened by this bot and rerun.\n');
    }
    throw err;
  }

  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

  try {
    console.log('Opening Blinkit home page to verify session & address...');
    await page.goto('https://blinkit.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(3000);

    // Verify address is set to Home
    await verifyAndSetAddress(page);

    let restockedProductUrl = null;
    let attempt = 1;

    while (!restockedProductUrl && attempt <= CONFIG.MAX_RETRIES) {
      const nowStr = new Date().toLocaleTimeString();
      console.log(`\n--- Availability Check Cycle #${attempt} [${nowStr}] ---`);

      for (let i = 0; i < CONFIG.TARGET_PRODUCT_URLS.length; i++) {
        const prodUrl = CONFIG.TARGET_PRODUCT_URLS[i];
        console.log(`\nChecking [${i + 1}/${CONFIG.TARGET_PRODUCT_URLS.length}]: ${prodUrl}`);
        const isInStock = await checkProductStockAndAdd(page, prodUrl);
        if (isInStock) {
          restockedProductUrl = prodUrl;
          break; // Found one in stock! Don't check the others, order this one asap.
        }
        if (i < CONFIG.TARGET_PRODUCT_URLS.length - 1) {
          await sleep(2500);
        }
      }

      if (restockedProductUrl) {
        console.log(`\n>>> Product restocked and added to cart: ${restockedProductUrl}`);
        console.log('Proceeding with extra items and checkout ASAP...');
        
        // 1. Add 20 Rupee chips
        await addTwentyRupeeChips(page);

        // 2. Open cart and order on COD
        let orderSuccess = false;
        try {
          orderSuccess = await proceedToCheckoutAndPlaceOrderCOD(page);
        } catch (checkoutErr) {
          console.error('[!] Error during checkout process:', checkoutErr.message);
          orderSuccess = false;
        }

        if (orderSuccess) {
          console.log('\n[SUCCESS] Order placed automatically on COD!');
          await sendTelegramNotification(
            `🎉 *Blinkit Order Placed Successfully!*\n\n` +
            `• *Product*: [Blinkit Target Product](${restockedProductUrl})\n` +
            `• *Address*: ${CONFIG.TARGET_ADDRESS_LABEL}\n` +
            `• *Payment*: Cash on Delivery (COD)\n` +
            `• *Time*: ${new Date().toLocaleString()}`
          );
        } else {
          console.warn('\n=============================================================');
          console.warn('⚠️ ATTENTION: Product is in stock but order could not be placed!');
          console.warn('   Dispatching Telegram notification for MANUAL INTERVENTION...');
          console.warn('=============================================================\n');
          process.stdout.write('\x07'); // Terminal alert beep

          await sendTelegramNotification(
            `🚨 *BLINKIT ALERT: MANUAL INTERVENTION REQUIRED!*\n\n` +
            `⚠️ The target product is *IN STOCK* and added to your cart, but the bot could *NOT* place the order automatically (COD unavailable or checkout blocked).\n\n` +
            `📍 *Delivery Address*: ${CONFIG.TARGET_ADDRESS_LABEL}\n` +
            `🛒 *Product Link*: [View Product](${restockedProductUrl})\n` +
            `⏰ *Time*: ${new Date().toLocaleString()}\n\n` +
            `👉 *Please open the browser window on your PC immediately to complete the payment and order manually!*`
          );
        }
        break;
      }

      const schedule = calculateNextCheckSchedule();
      const nextTime = new Date(Date.now() + schedule.waitMs).toLocaleTimeString();
      const waitMinutes = (schedule.waitMs / 60000).toFixed(1);

      console.log(`[Schedule] ${schedule.reason}`);
      console.log(`Next check scheduled at ${nextTime} (in ~${waitMinutes} min). Sleeping...`);

      await sleep(schedule.waitMs);
      attempt++;
    }

    console.log('\nBot task complete or in manual review. Keeping process alive for Render...');
    // Wait indefinitely so Render web service doesn't restart
    await new Promise(() => {});

  } catch (error) {
    console.error('An error occurred during bot execution:', error);
  } finally {
    if (context) {
      await context.close();
    }
  }
}

run();
