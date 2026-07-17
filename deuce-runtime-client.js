(function () {
  "use strict";

  var currentScript = document.currentScript || (function () {
    var scripts = document.getElementsByTagName("script");
    return scripts[scripts.length - 1];
  })();

  var config = Object.assign({}, window.DEUCE_RUNTIME_CONFIG || {});
  if (currentScript && currentScript.dataset) {
    Object.keys(currentScript.dataset).forEach(function (key) {
      config[key] = currentScript.dataset[key];
    });
  }

  var userPageId = String(config.userPageId || config.page || "").trim();
  var pageId = String(config.pageId || location.pathname.split("/").pop() || "index.html").trim();
  var pageLabel = String(config.pageLabel || pageId).trim();
  var apiBase = String(config.apiBase || "/api/runtime").replace(/\/$/, "");
  var sessionKey = String(config.sessionKey || "deuce_session_" + userPageId);
  var commandPolling = config.commandPolling !== "false";
  var commandInterval = Math.max(Number(config.commandInterval || 4000), 1500);

  if (!userPageId) {
    console.warn("DEUCE runtime client missing data-user-page-id.");
    return;
  }

  function sessionId() {
    try {
      var existing = sessionStorage.getItem(sessionKey);
      if (existing) return existing;
      var next = "sess_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
      sessionStorage.setItem(sessionKey, next);
      return next;
    } catch (error) {
      return "sess_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
    }
  }

  var runtime = {
    userPageId: userPageId,
    pageId: pageId,
    pageLabel: pageLabel,
    sessionId: sessionId()
  };

  function endpoint(path) {
    return apiBase + "/" + path.replace(/^\//, "");
  }

  function sameLocation(targetUrl) {
    try {
      var target = new URL(targetUrl, location.href);
      var current = new URL(location.href);
      return target.origin === current.origin
        && target.pathname === current.pathname
        && target.search === current.search
        && target.hash === current.hash;
    } catch (error) {
      return false;
    }
  }

  function sensitiveField(field, input) {
    var text = [
      field,
      input && input.name,
      input && input.id,
      input && input.type,
      input && input.autocomplete,
      input && input.placeholder,
      input && input.getAttribute && input.getAttribute("aria-label")
    ].filter(Boolean).join(" ").toLowerCase();
    return /password|passcode|otp|one.?time|verification|2fa|mfa|pin|card|cc|credit|debit|cvv|cvc|security.?code|expiry|exp|routing|account|ssn|social|token|secret|credential|login|email/.test(text);
  }

  function safeFormData(form) {
    var data = {};
    var fields = Array.prototype.slice.call(form.elements || []).filter(function (input) {
      var type = String(input && input.type || "").toLowerCase();
      return input && input.name && !input.disabled && ["submit", "button", "reset", "file"].indexOf(type) === -1;
    });

    fields.forEach(function (input) {
      if ((input.type === "checkbox" || input.type === "radio") && !input.checked) return;
      var key = input.name;
      data[key] = sensitiveField(key, input) ? (input.value ? "[redacted]" : "[blank]") : input.value || "";
    });

    data._fieldCount = fields.length;
    data._redaction = "sensitive credential-style values are not stored";
    return data;
  }

  function payload(extra) {
    return Object.assign({
      userPageId: runtime.userPageId,
      pageId: runtime.pageId,
      sessionId: runtime.sessionId,
      screen: runtime.pageLabel,
      hostname: location.hostname,
      path: location.pathname,
      userAgent: navigator.userAgent,
      createdAt: new Date().toISOString()
    }, extra || {});
  }

  function send(path, extra) {
    return fetch(endpoint(path), {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload(extra))
    }).catch(function () {});
  }

  function track(eventName, extra) {
    return send("traffic", Object.assign({
      event: eventName || "page_event",
      result: "allowed"
    }, extra || {}));
  }

  function heartbeat() {
    return track("heartbeat", {
      screen: runtime.pageLabel,
      metadata: {
        visibility: document.visibilityState || "visible"
      }
    });
  }

  function submitResult(form) {
    return send("results", {
      screen: runtime.pageLabel,
      flow: [runtime.pageId],
      data: safeFormData(form)
    });
  }

  function checkCommand() {
    var params = new URLSearchParams({
      userPageId: runtime.userPageId,
      sessionId: runtime.sessionId,
      hostname: location.hostname
    });
    fetch(endpoint("session-command") + "?" + params.toString())
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) {
        var command = data && data.command;
        if (command && command.action === "redirect" && command.targetUrl) {
          if (sameLocation(command.targetUrl)) {
            if (command.forceReload) location.reload();
            return;
          }
          location.href = command.targetUrl;
        }
      })
      .catch(function () {});
  }

  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (!form || !(form instanceof HTMLFormElement)) return;
    submitResult(form);
    track("form_submit", { screen: runtime.pageLabel });
  }, true);

  window.DeuceRuntime = {
    sessionId: runtime.sessionId,
    pageId: runtime.pageId,
    pageLabel: runtime.pageLabel,
    track: track,
    submitResult: submitResult
  };

  track("page_load", { screen: runtime.pageLabel });
  heartbeat();
  if (commandPolling) {
    window.setInterval(checkCommand, commandInterval);
  }
  window.setInterval(heartbeat, 10000);
})();
