const loginForm = document.querySelector("#loginForm");
const formError = document.querySelector("#formError");

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || "Request failed");
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
    showError(error.status === 429 ? error.message : "Email or password is incorrect.");
    setBusy(false);
  }
});

api("/api/auth/me")
  .then(() => window.location.replace("/portal#dashboard"))
  .catch(() => document.querySelector("#loginEmail").focus());
