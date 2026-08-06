const loginForm = document.querySelector("#loginForm");
const formError = document.querySelector("#formError");

function safeErrorMessage(error, fallback = "") {
  return window.DeucePublicErrors?.message?.(error, fallback) || fallback || "Request could not be completed. Please try again.";
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options
    });
  } catch {
    const error = new Error("Connection failed. Please try again.");
    error.status = 0;
    throw error;
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(safeErrorMessage({ message: body.error, status: response.status }));
    error.status = response.status;
    throw error;
  }
  return body;
}

function showError(message = "") {
  formError.textContent = message;
  formError.hidden = !message;
}

function setBusy(busy) {
  const button = loginForm.querySelector('button[type="submit"]');
  loginForm.querySelectorAll("input, button").forEach((control) => {
    control.disabled = busy;
  });
  button.textContent = busy ? "Logging in..." : "Login";
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError();
  setBusy(true);
  try {
    await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: document.querySelector("#loginEmail").value.trim(),
        password: document.querySelector("#loginPassword").value
      })
    });
    window.location.replace("/portal#dashboard");
  } catch (error) {
    showError(error.status === 429 ? safeErrorMessage(error) : "Email or password is incorrect.");
    setBusy(false);
  }
});

api("/api/auth/me")
  .then(() => window.location.replace("/portal#dashboard"))
  .catch(() => document.querySelector("#loginEmail").focus());
