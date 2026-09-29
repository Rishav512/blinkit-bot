# Blinkit Restock, Chips & COD Auto-Order Bot

Automated bot configured to monitor:
- **Target Products** (Orders whichever comes into stock first):
  1. `https://blinkit.com/prn/x/prid/804925`
  2. `https://blinkit.com/prn/x/prid/1383211`
  3. `https://blinkit.com/prn/x/prid/1382030`
- **Delivery Address**: **Home**
- **Extra Item**: ₹20 Chips (e.g., Lay's ₹20)
- **Payment Method**: **Cash on Delivery (COD)**
- **Polling Interval**: Every 15 minutes + **Sharp 12:00 AM Midnight Restock Surge**

---

## Restock & Polling Schedule

1. **Standard Checks**: Runs every **15 minutes** throughout the day.
2. **12:00 AM Midnight Surge**:
   - The bot automatically calculates the remaining time to midnight. If the next 15-minute interval would overshoot 12:00 AM, it synchronizes to wake up **precisely at 12:00:00 AM**.
   - During the restock window (**12:00 AM – 12:05 AM**), it switches to high-frequency polling (every 15 seconds) so you don't miss the restock drop.

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

