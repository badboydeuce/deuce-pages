const scene = document.querySelector("#accessScene");
const pullCord = document.querySelector("#pullCord");
const loginStage = document.querySelector("#memberLogin");
const loginForm = document.querySelector("#loginForm");
const formError = document.querySelector("#formError");
const emailInput = document.querySelector("#loginEmail");

const pullThreshold = 68;
const maximumPull = 112;
let pointerStartY = 0;
let activePointer = null;
let pullDistance = 0;
let movedDuringPull = false;
let suppressClick = false;
let revealed = false;

function safeErrorMessage(error, fallback = "") {
  return window.DeucePublicErrors?.message?.(error, fallback)
    || fallback
    || "Request could not be completed. Please try again.";
}

function setPullDistance(distance) {
  pullDistance = Math.max(0, Math.min(maximumPull, distance));
  scene.style.setProperty("--pull-y", `${pullDistance}px`);
}

function settleCord() {
  scene.classList.remove("is-dragging");
  setPullDistance(0);
}

function revealLogin({ focus = false } = {}) {
  if (revealed) return;
  revealed = true;
  scene.classList.add("is-active");
  pullCord.setAttribute("aria-pressed", "true");
  loginStage.removeAttribute("inert");
  loginStage.setAttribute("aria-hidden", "false");
  window.setTimeout(settleCord, 180);
  if (focus) window.setTimeout(() => emailInput.focus(), 820);
}

function performAutomaticPull() {
  if (revealed) return;
  scene.classList.add("is-dragging");
  setPullDistance(92);
  window.setTimeout(() => revealLogin({ focus: true }), 190);
}

pullCord.addEventListener("pointerdown", (event) => {
  if (revealed) return;
  activePointer = event.pointerId;
  pointerStartY = event.clientY;
  movedDuringPull = false;
  scene.classList.add("is-dragging");
  pullCord.setPointerCapture(event.pointerId);
});

pullCord.addEventListener("pointermove", (event) => {
  if (activePointer !== event.pointerId || revealed) return;
  const distance = Math.max(0, event.clientY - pointerStartY);
  movedDuringPull ||= distance > 5;
  setPullDistance(distance);
});

function finishPointerPull(event, cancelled = false) {
  if (activePointer !== event.pointerId) return;
  if (pullCord.hasPointerCapture(event.pointerId)) pullCord.releasePointerCapture(event.pointerId);
  activePointer = null;
  suppressClick = movedDuringPull;

  if (!cancelled && pullDistance >= pullThreshold) {
    revealLogin({ focus: event.pointerType !== "touch" });
  } else {
    settleCord();
  }
}

pullCord.addEventListener("pointerup", (event) => finishPointerPull(event));
pullCord.addEventListener("pointercancel", (event) => finishPointerPull(event, true));

pullCord.addEventListener("click", () => {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  performAutomaticPull();
});

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
  button.querySelector("span").textContent = busy ? "Entering..." : "Enter";
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError();
  setBusy(true);

  try {
    await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: emailInput.value.trim(),
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
  .catch(() => {});
