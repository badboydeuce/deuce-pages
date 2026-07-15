import "./config/loadEnv.js";
import { createApp } from "./app.js";

const port = Number(process.env.PORT || 10000);
const app = createApp();

app.listen(port, () => {
  console.log(`DEUCE Pages API listening on ${port}`);
});
