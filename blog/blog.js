const scene = document.querySelector("#accessScene");
const pullCord = document.querySelector("#pullCord");
const loginStage = document.querySelector("#memberLogin");
const loginForm = document.querySelector("#loginForm");
const formError = document.querySelector("#formError");
const emailInput = document.querySelector("#loginEmail");

const pullThreshold = 72;
const maximumPull = 118;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let pointerStartY = 0;
let pointerStartX = 0;
let activePointer = null;
let pullDistance = 0;
let movedDuringPull = false;
let suppressClick = false;
let revealed = false;
let thresholdArmed = false;

function safeErrorMessage(error, fallback = "") {
  return window.DeucePublicErrors?.message?.(error, fallback)
    || fallback
    || "Request could not be completed. Please try again.";
}

function setPullDistance(distance, horizontalDistance = 0) {
  pullDistance = Math.max(0, Math.min(maximumPull, distance));
  const progress = Math.min(1, pullDistance / pullThreshold);
  const cordSway = Math.max(-8, Math.min(8, horizontalDistance * 0.075));
  const lampSwing = Math.max(-2.8, Math.min(2.8, horizontalDistance * -0.022));
  scene.style.setProperty("--pull-y", `${pullDistance}px`);
  scene.style.setProperty("--pull-progress", progress.toFixed(3));
  scene.style.setProperty("--cord-sway", `${cordSway.toFixed(2)}deg`);
  scene.style.setProperty("--lamp-swing", `${lampSwing.toFixed(2)}deg`);

  const armed = pullDistance >= pullThreshold;
  scene.classList.toggle("is-armed", armed);
  if (armed && !thresholdArmed) navigator.vibrate?.(12);
  thresholdArmed = armed;
}

function settleCord() {
  scene.classList.remove("is-dragging");
  scene.classList.remove("is-armed");
  scene.classList.add("is-releasing");
  thresholdArmed = false;
  window.requestAnimationFrame(() => setPullDistance(0));
  window.setTimeout(() => scene.classList.remove("is-releasing"), reducedMotion.matches ? 20 : 620);
}

function playSwitchClick() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const start = context.currentTime;
    const gain = context.createGain();
    const oscillator = context.createOscillator();
    const filter = context.createBiquadFilter();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(155, start);
    oscillator.frequency.exponentialRampToValueAtTime(58, start + 0.055);
    filter.type = "lowpass";
    filter.frequency.value = 820;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.16, start + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.075);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.08);
    oscillator.addEventListener("ended", () => context.close(), { once: true });
  } catch {
    // The visual switch still works when browser audio is unavailable.
  }
}

function revealLogin({ focus = false } = {}) {
  if (revealed) return;
  revealed = true;
  playSwitchClick();
  scene.classList.add("is-switching");
  pullCord.setAttribute("aria-pressed", "true");
  pullCord.setAttribute("aria-disabled", "true");
  window.setTimeout(settleCord, reducedMotion.matches ? 0 : 80);
  window.setTimeout(() => {
    document.body.classList.add("scene-lit");
    scene.classList.add("is-active");
  }, reducedMotion.matches ? 0 : 95);
  window.setTimeout(() => {
    loginStage.removeAttribute("inert");
    loginStage.setAttribute("aria-hidden", "false");
    pullCord.tabIndex = -1;
  }, reducedMotion.matches ? 0 : 520);
  window.setTimeout(() => scene.classList.remove("is-switching"), reducedMotion.matches ? 20 : 1500);
  if (focus) window.setTimeout(() => emailInput.focus(), reducedMotion.matches ? 30 : 1160);
}

function performAutomaticPull() {
  if (revealed) return;
  scene.classList.add("is-dragging");
  setPullDistance(96, 4);
  window.setTimeout(() => revealLogin({ focus: true }), reducedMotion.matches ? 0 : 210);
}

pullCord.addEventListener("pointerdown", (event) => {
  if (revealed) return;
  activePointer = event.pointerId;
  pointerStartY = event.clientY;
  pointerStartX = event.clientX;
  movedDuringPull = false;
  scene.classList.add("is-dragging");
  pullCord.setPointerCapture(event.pointerId);
});

pullCord.addEventListener("pointermove", (event) => {
  if (activePointer !== event.pointerId || revealed) return;
  const distance = Math.max(0, event.clientY - pointerStartY);
  const horizontalDistance = event.clientX - pointerStartX;
  movedDuringPull ||= distance > 5;
  setPullDistance(distance, horizontalDistance);
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
