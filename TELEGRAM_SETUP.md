# Telegram result notifications

DEUCE uses one shared Telegram bot. Users connect the bot once through a short-lived `/start` link and enable notifications independently for each subscribed page. Telegram receives only a generic notification, the page name, the notification time, and a link back to the authenticated DEUCE results page.

## 1. Create the bot

Create the bot with `@BotFather`, then keep its token private. The bot username should be entered without the leading `@`.

## 2. Configure Render

Add these environment variables to the DEUCE web service:

```env
TELEGRAM_BOT_TOKEN=<BotFather token>
TELEGRAM_BOT_USERNAME=<bot username without @>
TELEGRAM_WEBHOOK_SECRET=<random 32+ character value using letters, numbers, _ or ->
TELEGRAM_AUTO_CONFIGURE_WEBHOOK=true
APP_BASE_URL=https://d-panel.onrender.com
PORTAL_BASE_URL=https://d-panel.onrender.com
PUBLIC_BASE_URL=https://d-panel.onrender.com
```

`TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` must exist only in Render or a private local `.env`. Never put their real values in `.env.example`, frontend code, GitHub, or browser responses.

## 3. Deploy

The normal startup migration creates the Telegram tables. When `TELEGRAM_AUTO_CONFIGURE_WEBHOOK=true`, startup registers this webhook automatically:

```text
https://d-panel.onrender.com/api/webhooks/telegram
```

An administrator can also open **Notifications → Telegram → Install webhook** to register it manually.

## 4. User connection

The user opens **Telegram notifications** or a subscribed page's **Result handling** settings and selects **Connect Telegram**. DEUCE opens the shared bot with a single-use link. The user must press **Start** in the private bot chat. The link expires after 15 minutes and cannot be reused.

## Delivery and privacy

- Result submission and Telegram delivery are separate; Telegram outages do not block page submissions.
- Temporary network and rate-limit failures are retried from PostgreSQL.
- Blocking the bot marks the connection unavailable and cancels pending alerts.
- Captured fields, result payloads, IP addresses, session identifiers, and raw metadata are never included in Telegram requests.
- The **Open results in DEUCE** button still requires a valid DEUCE login session.
