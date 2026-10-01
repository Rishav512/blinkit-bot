# Blinkit Restock, Chips & COD Auto-Order Bot

Automated bot configured to monitor:
- **Target Products** (Orders whichever comes into stock first):
  1. `https://blinkit.com/prn/x/prid/804925`
  2. `https://blinkit.com/prn/x/prid/1383211`
  3. `https://blinkit.com/prn/x/prid/1382030`
- **Delivery Address**: **Home**
- **Extra Item**: ₹20 Chips (e.g., Lay's ₹20)
- **Payment Method**: **Cash on Delivery (COD)**
- **Polling Interval**: Every 5 minutes + **Sharp 12:00 AM Midnight Restock Surge**
- **Store Closed Window**: **1:00 AM – 5:00 AM IST** (process paused, browser closed to save Render hours & RAM)

---

## Restock & Polling Schedule (Indian Standard Time - IST)

1. **Standard Checks**: Runs every **5 minutes** (configurable via `POLL_INTERVAL_MINS`) between 5:00 AM and 1:00 AM IST.
2. **12:00 AM Midnight Surge**:
   - The bot calculates remaining time to 12:00:00 AM IST. If the polling interval would overshoot midnight, it synchronizes to wake up **precisely at 12:00:00 AM IST**.
   - During the restock window (**12:00 AM – 12:05 AM IST**), it switches to high-frequency polling (every 15 seconds) so you don't miss the restock drop.
3. **1:00 AM – 5:00 AM Store Closure (Render Resource Saver)**:
   - Blinkit dark stores are closed between **1:00 AM and 5:00 AM IST**.
   - At 1:00 AM IST, the bot closes the Chromium browser context (freeing memory and CPU to 0%) and pauses checking.
   - At 5:00 AM IST, the bot automatically re-opens a fresh browser session and resumes polling.

---

## Render Free Tier Optimization (Monthly Limits Guide)

Render Free Web Services offer **750 free instance hours** and **100 GB egress bandwidth** per month. Here is how the bot ensures you never exhaust these limits:

### 1. Saving Free Instance Hours (750 Hours / Month)
- Running 24/7 in a 31-day month consumes **744 hours** (leaving < 6 hours margin).
- Render free web services automatically spin down after 15 minutes of receiving no HTTP requests.
- **How to save ~116 hours/month**:
  If you use a free pinging service (like [cron-job.org](https://cron-job.org) or UptimeRobot) to keep Render awake, **schedule it to pause pings between 1:00 AM and 5:00 AM IST**:
  - **In cron-job.org**: Set interval to every 10 or 14 minutes, and set active schedule to **05:00 to 00:59 IST** (or cron expression: `*/10 5-23,0 * * *` with timezone `Asia/Kolkata` / `*/10 23-24,0-18 * * *` in UTC).
  - When pings stop at 1:00 AM IST, Render automatically spins down the container at ~1:15 AM IST and wakes up when pings resume at 5:00 AM IST.
  - This saves **3.75 hours every day (~116 hours/month)**, dropping monthly usage to ~628 hours!

### 2. Saving Egress Bandwidth (< 100 GB / Month)
- Enabled by default (`BLOCK_MEDIA_ASSETS=true`): The bot automatically blocks heavy images, fonts, and video ads during routine background checks.
- This slashes data usage by ~85-90% (from ~140 GB/month down to < 5 GB/month) and significantly speeds up page checks.
- Images and styles are automatically unblocked if an item comes in stock so checkout and payment render normally.

### 3. Live Health & Schedule Status Endpoint
Visiting the root URL of your deployed Render service (or `http://localhost:3000`) returns live JSON status:
```json
{
  "service": "Blinkit Restock & COD Auto-Order Bot",
  "botStatus": "active",
  "storeStatus": "OPEN",
  "currentISTTime": "01/10/2026 15:45:00 IST",
  "nextCheckScheduled": "15:50:00 IST",
  "currentCycle": 12,
  "renderOptimization": {
    "sleepWindow": "1:00 AM - 5:00 AM IST",
    "browserStatus": "Active",
    "assetBlocking": "Enabled"
  }
}
```

---

## Action on Restock

1. **Add Target Product**: Clicks **ADD** on `https://blinkit.com/prn/x/prid/804925`.
2. **Add Extra Item**: Searches and adds a **₹20 pack of chips** to the cart.
3. **Checkout on COD**:
   - Opens cart and verifies "Home" delivery.
   - Selects **Cash on Delivery (COD)**.
   - Automatically clicks **Place Order**.

---

## Telegram Notifications (Manual Intervention & Order Alerts)

The bot will send you a Telegram message if:
- 🚨 **Manual Intervention Required**: The target item is **in stock** and added to cart, but auto-checkout/COD cannot be completed.
- 🎉 **Order Placed**: Cash on Delivery order was completed automatically.

### Setup Telegram Bot Credentials:
1. Open Telegram and search for `@BotFather`.
2. Send `/newbot` and follow the prompts to create your bot. Copy the **HTTP API token**.
3. To get your **Chat ID**, open Telegram and message `@userinfobot` (it will reply with your `Id`).
4. Paste both in your `.env` file:
   ```env
   TELEGRAM_BOT_TOKEN=123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ
   TELEGRAM_CHAT_ID=987654321
   ```

---

## How to Run

1. Make sure previous Chrome windows opened by this bot are closed.
2. In your terminal:
   ```powershell
   npm start
   ```

