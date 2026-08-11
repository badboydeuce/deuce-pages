import "./config/loadEnv.js";
import { createApp } from "./app.js";
import { configureTelegramWebhook, startTelegramDispatcher, telegramConfiguration } from "./services/telegram.js";

const port = Number(process.env.PORT || 10000);
const app = createApp();
startTelegramDispatcher();

app.listen(port, () => {
  console.log(`DEUCE Pages API listening on ${port}`);
  const telegram = telegramConfiguration();
  if (telegram.configured && process.env.TELEGRAM_AUTO_CONFIGURE_WEBHOOK === "true") {
    configureTelegramWebhook()
      .then(() => console.log("Telegram webhook configured"))
      .catch((error) => console.error("Telegram webhook setup failed", { code: error?.code || "TELEGRAM_WEBHOOK_SETUP_FAILED" }));
  }
});
