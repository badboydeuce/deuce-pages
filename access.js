const loginForm = document.querySelector("#loginForm");
const inviteForm = document.querySelector("#inviteForm");
const accessMessage = document.querySelector("#accessMessage");
const panelStatus = document.querySelector("#panelStatus");
const formError = document.querySelector("#formError");
const inviteSummary = document.querySelector("#inviteSummary");
const inviteEmail = document.querySelector("#inviteEmail");
let activeInviteToken = "";

function safeErrorMessage(error, fallback = "") {
  return window.DeucePublicErrors?.message?.(error, fallback) || fallback || "Request could not be completed. Please try again.";
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });
  } catch {
    const error = new Error("Connection failed. Please try again.");
    error.status = 0;
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(safeErrorMessage({ message: data.error, status: response.status }));
    error.status = response.status;
    throw error;
  }
  return data;
}

function setPanelStatus(value) {
  panelStatus.textContent = value.toUpperCase();
}

function showError(message = "") {
  formError.textContent = message;
  formError.hidden = !message;
}

function showOnly(target) {
  loginForm.hidden = target !== loginForm;
  inviteForm.hidden = target !== inviteForm;
  accessMessage.hidden = target !== accessMessage;
  showError("");
}

function showMessage(title, copy, label = "ACCESS NOTICE") {
  document.querySelector("#messageLabel").textContent = label;
  document.querySelector("#messageTitle").textContent = title;
  document.querySelector("#messageCopy").textContent = copy;
  showOnly(accessMessage);
}

function inviteTokenFromFragment() {
  const fragment = window.location.hash.slice(1);
  if (!fragment) return "";
  const normalized = fragment.startsWith("signup?") ? fragment.slice("signup?".length) : fragment;
  const params = new URLSearchParams(normalized);
  return (params.get("invite") || "").trim();
}

function invitationExpiry(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "soon" : date.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function setFormBusy(form, busy, label) {
  const button = form.querySelector('button[type="submit"]');
  form.querySelectorAll("input, button").forEach((control) => {
    if (control !== inviteEmail) control.disabled = busy;
  });
  if (button) {
    button.dataset.label ||= button.innerHTML;
    button.innerHTML = busy ? label : button.dataset.label;
  }
}

async function openLogin() {
  document.title = "Member Login | Deuce Pages";
  setPanelStatus("MEMBER AUTHENTICATION READY");
  showOnly(loginForm);
  document.querySelector("#loginEmail").focus();
}

async function openInvitation() {
  document.title = "Accept Invitation | Deuce Pages";
  activeInviteToken = inviteTokenFromFragment();
  if (!activeInviteToken) {
    setPanelStatus("INVITATION REQUIRED");
    showMessage("Invitation required", "This registration page opens only from a valid one-time administrator link.", "PRIVATE REGISTRATION");
    return;
  }

  setPanelStatus("VALIDATING ONE-TIME LINK");
  showMessage("Checking invitation", "Please wait while the server verifies this private registration link.", "SECURE LINK CHECK");
  try {
    const result = await api("/api/auth/invitations/validate", {
      method: "POST",
      body: JSON.stringify({ inviteToken: activeInviteToken })
    });
    inviteEmail.value = result.invitation.email;
    inviteSummary.textContent = `For ${result.invitation.email}. Expires ${invitationExpiry(result.invitation.expiresAt)} and becomes unusable after signup.`;
    setPanelStatus("INVITATION VERIFIED");
    showOnly(inviteForm);
    document.querySelector("#inviteName").focus();
  } catch (error) {
    setPanelStatus("INVITATION REJECTED");
    showMessage("Link cannot be used", "This invitation is invalid, expired, revoked, or already used.", "INVITATION UNAVAILABLE");
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("");
  setFormBusy(loginForm, true, "Verifying account...");
  setPanelStatus("VERIFYING CREDENTIALS");
  try {
    await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: document.querySelector("#loginEmail").value.trim(),
        password: document.querySelector("#loginPassword").value
      })
    });
    setPanelStatus("ACCESS GRANTED");
    window.location.replace("/portal#dashboard");
  } catch (error) {
    showError(error.status === 429 ? safeErrorMessage(error) : "Email or password is incorrect.");
    setPanelStatus("ACCESS DENIED");
    setFormBusy(loginForm, false);
  }
});

inviteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("");
  const password = document.querySelector("#invitePassword").value;
  const confirmation = document.querySelector("#inviteConfirm").value;
  if (password !== confirmation) {
    showError("Passwords do not match.");
    return;
  }

  setFormBusy(inviteForm, true, "Creating account...");
  setPanelStatus("CONSUMING INVITATION");
  try {
    await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        name: document.querySelector("#inviteName").value.trim(),
        password,
        inviteToken: activeInviteToken
      })
    });
    window.history.replaceState(null, "", "/invite");
    setPanelStatus("ACCOUNT CREATED");
    window.location.replace("/portal#dashboard");
  } catch (error) {
    showError(safeErrorMessage(error));
    setPanelStatus("SIGNUP NOT COMPLETED");
    setFormBusy(inviteForm, false);
  }
});

async function boot() {
  try {
    await api("/api/auth/me");
    window.location.replace("/portal#dashboard");
    return;
  } catch {
    // A missing session is expected on the public access pages.
  }

  if (window.location.pathname.startsWith("/invite")) await openInvitation();
  else await openLogin();
}

boot();
