import assert from "node:assert/strict";
import test from "node:test";
import { pageSubscriptionState, userPageCapabilities } from "./appRepository.js";

function pageWithRenewal(renewalDate, overrides = {}) {
  return {
    status: "active",
    subscription: {
      renewalDate,
      renewalStatus: "active",
      ...overrides.subscription
    },
    ...overrides
  };
}

test("active subscriptions retain operational page capabilities", () => {
  const page = pageWithRenewal("2099-01-01");
  const capabilities = userPageCapabilities(page);

  assert.equal(pageSubscriptionState(page).blocked, false);
  assert.equal(capabilities.goLive, true);
  assert.equal(capabilities.editConfig, true);
  assert.equal(capabilities.editSecurity, true);
  assert.equal(capabilities.generateIndex, true);
});

test("expired subscriptions keep history and renewal access but lose operational controls", () => {
  const page = pageWithRenewal("2000-01-01");
  const capabilities = userPageCapabilities(page);

  assert.equal(pageSubscriptionState(page).status, "expired");
  assert.equal(capabilities.goLive, false);
  assert.equal(capabilities.editConfig, false);
  assert.equal(capabilities.editSecurity, false);
  assert.equal(capabilities.generateIndex, false);
  assert.equal(capabilities.verifyHosting, false);
  assert.equal(capabilities.installWorker, false);
  assert.equal(capabilities.syncScreens, false);
  assert.equal(capabilities.controlSessions, false);
  assert.equal(capabilities.viewResults, true);
  assert.equal(capabilities.manageResults, true);
  assert.equal(capabilities.viewTraffic, true);
  assert.equal(capabilities.viewLogs, true);
  assert.equal(capabilities.fundWallet, true);
  assert.equal(capabilities.renew, true);
  assert.equal(capabilities.rotateRelaySecret, true);
});

test("payment failures use the same restricted capability policy", () => {
  const page = pageWithRenewal("2099-01-01", { status: "payment_failed" });
  const capabilities = userPageCapabilities(page);

  assert.equal(pageSubscriptionState(page).status, "payment_failed");
  assert.equal(capabilities.goLive, false);
  assert.equal(capabilities.viewResults, true);
  assert.equal(capabilities.viewTraffic, true);
  assert.equal(capabilities.renew, true);
});
