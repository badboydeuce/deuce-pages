import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWalletQuote,
  coingeckoIdForAsset,
  cryptoFundingOptions,
  fundingOptionsFromEnv
} from "./wallet.js";

test("Litecoin is exposed as a configured native-network funding option", () => {
  const previous = process.env.WALLET_LTC;
  process.env.WALLET_LTC = "LXaA3b1odQrZVfkde1v3mF6NwpyGVXrX5J";
  try {
    const definition = cryptoFundingOptions.find((option) => option.value === "LTC_LTC");
    const configured = fundingOptionsFromEnv().find((option) => option.value === "LTC_LTC");
    assert.deepEqual(definition, {
      value: "LTC_LTC",
      asset: "LTC",
      network: "LTC",
      label: "Litecoin - LTC",
      envKey: "WALLET_LTC"
    });
    assert.equal(configured.address, process.env.WALLET_LTC);
    assert.equal(configured.configured, true);
    assert.equal(coingeckoIdForAsset("LTC"), "litecoin");
  } finally {
    if (previous === undefined) delete process.env.WALLET_LTC;
    else process.env.WALLET_LTC = previous;
  }
});

test("Litecoin funding quotes use the live Litecoin USD rate", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /ids=litecoin/);
    return new Response(JSON.stringify({ litecoin: { usd: 100 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  try {
    const quote = await buildWalletQuote({ amount: 50, cryptoType: "LTC", network: "LTC" });
    assert.equal(quote.cryptoType, "LTC");
    assert.equal(quote.network, "LTC");
    assert.equal(quote.label, "Litecoin - LTC");
    assert.equal(quote.rate, 100);
    assert.equal(quote.cryptoAmount, "0.5");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
