# AJIO Price & Size Availability Tracker

Automated tracker that monitors product prices, discounts, coupon offers, and individual size availability on **AJIO** with instant **Telegram alerts**.

---

## Features

* **Akamai Anti-Bot Bypass**: Uses persistent Chromium browser profiles and masked automation arguments to load AJIO product detail pages reliably.
* **Size-by-Size Availability Tracking**: Inspects individual size buttons (`size-instock` vs `swatch-size-oos`), allowing you to track specific sizes (e.g., `M`, `L`, `UK 8`, `UK 11`).
* **Target Price Alerts**: Triggers an alert when the selling price drops to or below your target threshold.
* **Price Drop Detection**: Notifies you whenever an item's price drops compared to the previous check cycle.
* **Coupon & Bank Offer Extraction**: Automatically extracts active coupon codes (e.g., `NEW30`, `ALLSTARS10`) and promotional discounted prices.
* **Smart Notification Cache**: Stores history in `ajio_history.json` to prevent duplicate spamming when price or availability has not changed.
* **Cloud Ready**: Includes an optional HTTP status server on port 3000 for Docker / Render deployments.

---

## Quick Setup

### 1. Telegram Notifications
1. Message `@BotFather` on Telegram to create a bot and get your **Bot Token**.
2. Message `@userinfobot` on Telegram to get your **Chat ID**.
3. Create or update your `.env` file:
   ```env
   TELEGRAM_BOT_TOKEN=your_bot_token_here
   TELEGRAM_CHAT_ID=your_chat_id_here
   AJIO_POLL_INTERVAL_MINS=15
   HEADLESS=false
   ```

### 2. Configure Products to Track
Edit [ajio_products.json](file:///c:/Users/rishav.nanda/OneDrive%20-%20Incture/Desktop/blinkitBot/ajio_products.json):
```json
[
  {
    "name": "TEAMSPIRIT Men Side Stripe Regular Fit Track Pants",
    "url": "https://www.ajio.com/teamspirit-men-side-stripe-regular-fit-track-pants/p/443101286_cream?user=old",
    "targetPrice": 270,
    "targetSizes": ["M", "L"]
  }
]
```

* **`name`**: Custom label for the item (shown in logs and Telegram alerts).
* **`url`**: The direct product URL from Ajio.
* **`targetPrice`**: *(Optional)* Price in ₹. Triggers an alert when `currentPrice <= targetPrice`.
* **`targetSizes`**: *(Optional)* Array of sizes to track (e.g., `["M", "L"]` or `["8", "9"]`). Triggers an alert the moment any of these sizes restock.

---

## How to Run

### Continuous Monitoring (Automatic polling with Telegram alerts)
```powershell
npm start
```
*(or `npm run track`)*

### Quick One-Time Check (Inspects all products once and exits)
```powershell
npm run track:once
```

### Windows Batch File
Double-click `start_bot.bat` to launch the tracker in a separate terminal window.

---

## Configuration Options

| Environment Variable | Default | Description |
| :--- | :--- | :--- |
| `TELEGRAM_BOT_TOKEN` | `""` | Telegram Bot API token |
| `TELEGRAM_CHAT_ID` | `""` | Telegram user/group Chat ID |
| `AJIO_POLL_INTERVAL_MINS` | `15` | Polling interval in minutes |
| `HEADLESS` | `false` | Set to `true` to run browser completely hidden in background |
