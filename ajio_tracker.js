require('dotenv').config();
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const http = require('http');

// Lightweight status server if running in cloud container / Render
if (process.env.PORT || process.env.RENDER) {
  const PORT = process.env.PORT || 3000;
  http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      service: 'Ajio Price & Size Availability Tracker',
      status: 'active',
      time: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST',
      uptime: `${Math.floor(process.uptime() / 60)} minutes`,
    }, null, 2) + '\n');
  }).listen(PORT, () => {
    console.log(`Web status server listening on port ${PORT}`);
  });
}
// ==================== CONFIGURATION ====================
const CONFIG_FILE = path.join(__dirname, 'ajio_products.json');
const HISTORY_FILE = path.join(__dirname, 'ajio_history.json');
const USER_DATA_DIR = path.join(__dirname, 'ajioUserData');

const CONFIG = {
  POLL_INTERVAL_MS: (parseInt(process.env.AJIO_POLL_INTERVAL_MINS || '15', 10)) * 60 * 1000,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',
  HEADLESS: process.env.HEADLESS === 'true' || !!process.env.RENDER,
  RUN_ONCE: process.argv.includes('--once'),
};


// ---------------- TELEGRAM ALERT DISPATCHER ----------------
async function sendTelegramAlert(message) {
  const token = CONFIG.TELEGRAM_BOT_TOKEN;
  const chatId = CONFIG.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn('[!] Telegram Warning: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured in .env.');
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
        disable_web_page_preview: false,
      }),
    });

    const data = await response.json();
    if (data.ok) {
      console.log('📲 [Telegram] Notification dispatched successfully!');
      return true;
    } else {
      console.error(`[!] Telegram API Error: ${data.description || JSON.stringify(data)}`);
      return false;
    }
  } catch (err) {
    console.error('[!] Failed to send Telegram alert:', err.message);
    return false;
  }
}

// ---------------- LOCAL HISTORY PERSISTENCE ----------------
function loadHistory() {
  if (fs.existsSync(HISTORY_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    } catch (_) {
      return {};
    }
  }
  return {};
}

function saveHistory(history) {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
  } catch (err) {
    console.warn('[!] Could not save history:', err.message);
  }
}

function loadProducts() {
  if (!fs.existsSync(CONFIG_FILE)) {
    console.log(`[!] ${CONFIG_FILE} not found. Creating default template...`);
    const defaultTemplate = [
      {
        name: "Schumann Men Lace-Up Derby Shoes",
        url: "https://www.ajio.com/schumann-men-lace-up-derby-shoes/p/450164234_black?",
        targetPrice: 799,
        targetSizes: ["10", "11"]
      }
    ];
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultTemplate, null, 2), 'utf8');
    return defaultTemplate;
  }

  try {
    const content = fs.readFileSync(CONFIG_FILE, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    console.error(`[!] Failed to parse ${CONFIG_FILE}:`, err.message);
    return [];
  }
}

function parsePriceNumber(priceStr) {
  if (!priceStr) return null;
  const cleaned = priceStr.replace(/[^0-9.]/g, '');
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------- PRODUCT INSPECTION & EXTRACTION ----------------
async function scrapeAjioProduct(page, productConfig) {
  const url = productConfig.url;
  console.log(`\nNavigating to: ${url}`);

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(3500);

  const productData = await page.evaluate(() => {
    // Basic details
    const titleEl = document.querySelector('h1, [class*="prod-title"], [class*="product-name"]');
    const brandEl = document.querySelector('h2.brand-name, [class*="brand-name"]');
    
    // Pricing details
    const spEl = document.querySelector('.prod-sp, [class*="prod-sp"], [class*="offer-price"]');
    const cpEl = document.querySelector('.prod-cp, [class*="prod-cp"], [class*="original-price"]');
    const discountEl = document.querySelector('.prod-discnt, [class*="discount"], [class*="prod-discount"]');
    
    let mrp = cpEl ? cpEl.innerText.replace(/MRP\s*:?/i, '').trim() : null;
    let sellingPrice = spEl ? spEl.innerText.replace(/MRP\s*:?/i, '').trim() : null;
    let discount = discountEl ? discountEl.innerText.trim() : null;


    // Check overall out-of-stock indicators
    const bodyText = document.body.innerText;
    const hasAddToBag = Array.from(document.querySelectorAll('button, div, span')).some(el => {
      const t = (el.innerText || '').trim().toUpperCase();
      return t === 'ADD TO BAG' || t.includes('ADD TO BAG');
    });
    const isCompletelyOOS = /out\s*of\s*stock|sold\s*out|currently\s*unavailable/i.test(bodyText) && !hasAddToBag;


    // Promotional & coupon offers
    const offerEls = Array.from(document.querySelectorAll('[class*="promo-desc"], [class*="offer-desc"], [class*="promo-title"]'));
    const offers = offerEls.map(o => o.innerText.replace(/\n+/g, ' ').trim()).filter(Boolean).slice(0, 3);

    // Size variants
    const sizeVariants = Array.from(document.querySelectorAll('.size-variant-item, [class*="size-variant-item"]')).map(el => {
      const text = (el.innerText || '').trim();
      const isOOS = el.classList.contains('swatch-size-oos') || el.classList.contains('disabled') || el.getAttribute('aria-disabled') === 'true';
      const isInstock = el.classList.contains('size-instock') || !isOOS;
      return {
        size: text,
        inStock: isInstock && !isOOS,
      };
    }).filter(s => s.size && s.size.length <= 10);

    return {
      title: titleEl ? titleEl.innerText.trim() : 'Unknown Product',
      brand: brandEl ? brandEl.innerText.trim() : '',
      sellingPrice,
      mrp,
      discount,
      offers,
      isCompletelyOOS,
      sizes: sizeVariants,
    };
  });

  return productData;
}

// ---------------- MAIN EVALUATION & NOTIFICATION LOGIC ----------------
async function evaluateProduct(page, item, history) {
  const url = item.url;
  const historyKey = url;
  const prevRecord = history[historyKey] || {};

  try {
    const data = await scrapeAjioProduct(page, item);
    const currentPriceNum = parsePriceNumber(data.sellingPrice);
    const targetPriceNum = item.targetPrice ? parsePriceNumber(String(item.targetPrice)) : null;
    const targetSizes = (item.targetSizes || []).map(s => String(s).trim().toLowerCase());

    console.log(`\n📦 Product: ${data.brand ? `[${data.brand}] ` : ''}${data.title}`);
    console.log(`💰 Price: ${data.sellingPrice || 'N/A'} (MRP: ${data.mrp || 'N/A'}, ${data.discount || 'No Discount'})`);
    if (data.offers.length > 0) {
      console.log(`🏷️ Offers: ${data.offers.join(' | ')}`);
    }

    const availableSizes = data.sizes.filter(s => s.inStock).map(s => s.size);
    const oosSizes = data.sizes.filter(s => !s.inStock).map(s => s.size);

    console.log(`📏 Available Sizes: ${availableSizes.length > 0 ? availableSizes.join(', ') : 'None'}`);
    if (oosSizes.length > 0) {
      console.log(`❌ Out of Stock Sizes: ${oosSizes.join(', ')};`);
    }

    // Determine alerts to dispatch
    const alertTriggers = [];

    // 1. Target Price reached
    if (targetPriceNum && currentPriceNum && currentPriceNum <= targetPriceNum) {
      if (!prevRecord.alertedTargetPrice || prevRecord.lastPrice > currentPriceNum) {
        alertTriggers.push(`🎯 *Target Price Reached!* Price is now *${data.sellingPrice}* (Target: ₹${targetPriceNum})`);
      }
    }

    // 2. Price drop compared to previous check
    if (prevRecord.lastPrice && currentPriceNum && currentPriceNum < prevRecord.lastPrice) {
      const drop = prevRecord.lastPrice - currentPriceNum;
      alertTriggers.push(`📉 *Price Dropped by ₹${drop}!* Was ₹${prevRecord.lastPrice}, now *${data.sellingPrice}*`);
    }

    // 3. Target Size Restocked
    if (targetSizes.length > 0) {
      for (const targetSize of targetSizes) {
        const sizeObj = data.sizes.find(s => s.size.toLowerCase() === targetSize);
        if (sizeObj && sizeObj.inStock) {
          const prevSizesObj = (prevRecord.sizes || []).find(s => s.size.toLowerCase() === targetSize);
          const wasOOS = !prevSizesObj || !prevSizesObj.inStock;
          if (wasOOS) {
            alertTriggers.push(`✨ *Desired Size Restocked!* Size *${sizeObj.size}* is now IN STOCK!`);
          }
        }
      }
    }

    // 4. Full Restock (Was completely OOS previously, now back in stock)
    if (prevRecord.isCompletelyOOS && !data.isCompletelyOOS && availableSizes.length > 0) {
      alertTriggers.push(`🎉 *Product Restocked!* This item was previously sold out and is now back in stock.`);
    }

    // Send Telegram Notification if any alert was triggered
    if (alertTriggers.length > 0) {
      console.log(`\n🔔 Triggering Telegram Alert for "${data.title}"...`);
      const message = [
        `🛒 *AJIO PRICE & AVAILABILITY ALERT!*`,
        ...alertTriggers,
        ``,
        `• *Product*: ${data.brand ? `*${data.brand}* - ` : ''}${data.title}`,
        `• *Current Price*: *${data.sellingPrice || 'N/A'}* ${data.discount ? `(${data.discount})` : ''}`,
        data.mrp ? `• *Original MRP*: ${data.mrp}` : null,
        availableSizes.length > 0 ? `• *In-Stock Sizes*: ${availableSizes.join(', ')}` : `• *In-Stock Sizes*: Out of Stock`,
        data.offers.length > 0 ? `• *Coupon Offer*: ${data.offers[0]}` : null,
        ``,
        `🔗 [Open Product on Ajio](${url})`,
        `⏰ *Time*: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`
      ].filter(line => line !== null).join('\n');

      await sendTelegramAlert(message);
    }

    // Update history cache
    history[historyKey] = {
      name: item.name || data.title,
      lastCheckTime: new Date().toISOString(),
      lastPrice: currentPriceNum,
      sellingPriceFormatted: data.sellingPrice,
      mrp: data.mrp,
      isCompletelyOOS: data.isCompletelyOOS,
      sizes: data.sizes,
      alertedTargetPrice: (targetPriceNum && currentPriceNum && currentPriceNum <= targetPriceNum),
    };

  } catch (err) {
    console.error(`[!] Error inspecting product "${item.name || url}":`, err.message);
  }
}

async function createBrowserSession() {
  const launchArgs = [
    '--disable-blink-features=AutomationControlled',
    '--no-default-browser-check',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
  ];

  try {
    const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: CONFIG.HEADLESS,
      viewport: { width: 1280, height: 800 },
      ignoreDefaultArgs: ['--enable-automation'],
      args: launchArgs,
    });
    return { context, profileDir: USER_DATA_DIR, isTemp: false };
  } catch (err) {
    if (err.message.includes('ProcessSingleton') || err.message.includes('used by another process')) {
      console.warn('\n[!] Main profile is in use by another running tracker.');
      console.log('    Launching parallel persistent session to complete check...\n');
      const tempDir = path.join(__dirname, `ajioUserData_worker_${Date.now()}`);
      const context = await chromium.launchPersistentContext(tempDir, {
        headless: CONFIG.HEADLESS,
        viewport: { width: 1280, height: 800 },
        ignoreDefaultArgs: ['--enable-automation'],
        args: launchArgs,
      });
      return { context, profileDir: tempDir, isTemp: true };
    }
    throw err;
  }
}


// ---------------- MAIN LOOP ----------------
async function run() {
  console.log('======================================================');
  console.log('        AJIO PRICE & AVAILABILITY TRACKER            ');
  console.log('======================================================');
  
  const products = loadProducts();
  if (products.length === 0) {
    console.warn(`[!] No products found in ${CONFIG_FILE}. Add product items to track.`);
    return;
  }

  console.log(`Tracking ${products.length} product(s) from ${path.basename(CONFIG_FILE)}:`);
  products.forEach((p, i) => {
    console.log(`  [${i + 1}] ${p.name || 'Product'} | Target Price: ₹${p.targetPrice || 'Any'} | Sizes: [${(p.targetSizes || []).join(', ') || 'Any'}]`);
  });
  console.log(`Polling interval: Every ${CONFIG.POLL_INTERVAL_MS / 60000} minutes`);
  console.log(`Mode: ${CONFIG.RUN_ONCE ? 'One-time Check (--once)' : 'Continuous Monitoring'}\n`);

  const history = loadHistory();

  console.log('Launching Chromium with anti-detection profile...');
  let session = null;

  try {
    session = await createBrowserSession();
    const context = session.context;
    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();


    let cycle = 1;
    let keepRunning = true;

    while (keepRunning) {
      const nowStr = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
      console.log(`\n======================================================`);
      console.log(`--- Ajio Tracking Cycle #${cycle} [${nowStr} IST] ---`);
      console.log(`======================================================`);

      for (let i = 0; i < products.length; i++) {
        const item = products[i];
        console.log(`\n[${i + 1}/${products.length}] Checking: ${item.name || item.url}`);
        await evaluateProduct(page, item, history);
        saveHistory(history);

        if (i < products.length - 1) {
          await sleep(3000);
        }
      }

      if (CONFIG.RUN_ONCE) {
        console.log('\n[Finished] One-time check complete.');
        break;
      }

      const nextCheckTime = new Date(Date.now() + CONFIG.POLL_INTERVAL_MS).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
      console.log(`\nSleeping for ${CONFIG.POLL_INTERVAL_MS / 60000} mins. Next check at ${nextCheckTime} IST...`);
      await sleep(CONFIG.POLL_INTERVAL_MS);
      cycle++;
    }

  } catch (error) {
    console.error('Fatal error in Ajio Tracker execution:', error);
  } finally {
    if (session) {
      if (session.context) await session.context.close().catch(() => {});
      if (session.isTemp && session.profileDir) {
        try { fs.rmSync(session.profileDir, { recursive: true, force: true }); } catch (_) {}
      }
    }
  }

}

// Graceful termination
process.on('SIGINT', async () => {
  console.log('\n[Ajio Tracker] Stopping tracker gracefully...');
  process.exit(0);
});

run();
