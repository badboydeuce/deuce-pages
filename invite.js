const inviteForm = document.querySelector("#inviteForm");
const inviteState = document.querySelector("#inviteState");
const inviteEmail = document.querySelector("#inviteEmail");
const formError = document.querySelector("#formError");
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

function inviteTokenFromFragment() {
  const fragment = window.location.hash.slice(1);
  if (!fragment) return "";
  const normalized = fragment.startsWith("signup?") ? fragment.slice("signup?".length) : fragment;
  return (new URLSearchParams(normalized).get("invite") || "").trim();
}

function showError(message = "") {
  formError.textContent = message;
  formError.hidden = !message;
}

function showInviteState(message, state = "loading") {
  inviteState.textContent = message;
  inviteState.dataset.state = state;
  inviteState.hidden = false;
  inviteForm.hidden = true;
  showError();
}

function showInviteForm(email) {
  inviteEmail.value = email;
  inviteState.hidden = true;
  inviteForm.hidden = false;
  document.querySelector("#inviteName").focus();
}

function setBusy(busy) {
  const button = inviteForm.querySelector('button[type="submit"]');
  inviteForm.querySelectorAll("input, button").forEach((control) => {
    if (control !== inviteEmail) control.disabled = busy;
  });
  button.textContent = busy ? "Creating account..." : "Create account";
}

inviteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError();
  const password = document.querySelector("#invitePassword").value;
  const confirmation = document.querySelector("#inviteConfirm").value;
  if (password !== confirmation) {
    showError("Passwords do not match.");
    return;
  }

  setBusy(true);
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
    window.location.replace("/portal#dashboard");
  } catch (error) {
    showError(safeErrorMessage(error));
    setBusy(false);
  }
});

async function boot() {
  try {
    await api("/api/auth/me");
    window.location.replace("/portal#dashboard");
    return;
  } catch {
    // A missing session is expected on the invitation page.
  }

  activeInviteToken = inviteTokenFromFragment();
  if (!activeInviteToken) {
    showInviteState("A valid invitation link is required.", "error");
    return;
  }

  showInviteState("Validating invitation");
  try {
    const result = await api("/api/auth/invitations/validate", {
      method: "POST",
      body: JSON.stringify({ inviteToken: activeInviteToken })
    });
    showInviteForm(result.invitation.email);
  } catch {
    showInviteState("This invitation is invalid, expired, revoked, or already used.", "error");
  }
}

boot();
