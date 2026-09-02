"use strict";

const timer = { state: "stopped", configuredMs: 300000, remainingMs: 300000, endsAt: null };
const stopwatch = { state: "stopped", elapsedMs: 0, startedAt: null };
let selectedTab = "timer";
let updateId = null;
let audioContext = null;
let activeTone = null;

const timerTab = document.getElementById("timer-tab");
const stopwatchTab = document.getElementById("stopwatch-tab");
const timerPanel = document.getElementById("timer-panel");
const stopwatchPanel = document.getElementById("stopwatch-panel");
const timerDisplay = document.getElementById("timer-display");
const stopwatchDisplay = document.getElementById("stopwatch-display");
const timerState = document.getElementById("timer-state");
const stopwatchState = document.getElementById("stopwatch-state");
const timerMessage = document.getElementById("timer-message");
const timerStart = document.getElementById("timer-start");
const timerPause = document.getElementById("timer-pause");
const timerReset = document.getElementById("timer-reset");
const stopwatchStart = document.getElementById("stopwatch-start");
const stopwatchPause = document.getElementById("stopwatch-pause");
const stopwatchReset = document.getElementById("stopwatch-reset");
const timeInputs = ["hours", "minutes", "seconds"].map((id) => document.getElementById(id));
const stateLabels = { stopped: "停止中", running: "計測中", paused: "一時停止中", finished: "終了" };

function clampInput(value, maximum) {
  const number = Number(value);
  const integer = Math.round(Number.isFinite(number) ? number : 0);
  return Math.min(maximum, Math.max(0, integer));
}

function readSettings(commit) {
  if (timer.state !== "stopped") return;
  const values = timeInputs.map((input, index) => clampInput(input.value, index === 0 ? 99 : 59));
  if (commit) timeInputs.forEach((input, index) => { input.value = String(values[index]); });
  timer.configuredMs = (values[0] * 3600 + values[1] * 60 + values[2]) * 1000;
  timer.remainingMs = timer.configuredMs;
  render();
}

function formatTime(milliseconds, withCentiseconds) {
  const seconds = withCentiseconds ? Math.floor(milliseconds / 1000) : Math.ceil(milliseconds / 1000);
  const hours = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor(seconds / 60) % 60).padStart(2, "0");
  const rest = String(seconds % 60).padStart(2, "0");
  const fraction = String(Math.floor(milliseconds / 10) % 100).padStart(2, "0");
  return `${hours}:${minutes}:${rest}${withCentiseconds ? `.${fraction}` : ""}`;
}

function render() {
  timerDisplay.textContent = formatTime(timer.remainingMs, false);
  stopwatchDisplay.textContent = formatTime(stopwatch.elapsedMs, true);
  stopwatchDisplay.classList.toggle("long-time", stopwatch.elapsedMs >= 360000000);
  timerPanel.dataset.state = timer.state;
  stopwatchPanel.dataset.state = stopwatch.state;
  timerState.textContent = stateLabels[timer.state];
  stopwatchState.textContent = stateLabels[stopwatch.state];
  timeInputs.forEach((input) => { input.disabled = timer.state !== "stopped"; });
  timerStart.disabled = timer.state === "running" || timer.state === "finished" || timer.remainingMs === 0;
  timerPause.disabled = timer.state !== "running";
  stopwatchStart.disabled = stopwatch.state === "running";
  stopwatchPause.disabled = stopwatch.state !== "running";
  stopwatchReset.disabled = stopwatch.state === "stopped";
  timerStart.textContent = timer.state === "paused" ? "再開" : "開始";
  stopwatchStart.textContent = stopwatch.state === "paused" ? "再開" : "開始";
}

// AudioContext の生成・再開は必ず開始ボタンの操作内から呼ぶ。
function prepareAudio() {
  try {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    if (!audioContext || audioContext.state === "closed") audioContext = new Context();
    if (audioContext.state !== "running") {
      audioContext.resume().catch(() => { /* 音声が使えなくても計測を続ける。 */ });
    }
  } catch {
    // 非対応・生成失敗でも開始操作を妨げない。
  }
}

function disconnectTone(tone) {
  try { tone.oscillator.disconnect(); } catch { /* 切断済みでも継続。 */ }
  try { tone.gain.disconnect(); } catch { /* 切断済みでも継続。 */ }
  if (activeTone === tone) activeTone = null;
}

function stopTone() {
  if (!activeTone) return;
  const tone = activeTone;
  activeTone = null;
  try {
    const now = audioContext.currentTime;
    tone.gain.gain.cancelScheduledValues(now);
    tone.gain.gain.setValueAtTime(tone.gain.gain.value, now);
    tone.gain.gain.linearRampToValueAtTime(0, now + 0.03);
    tone.oscillator.stop(now + 0.04);
  } catch {
    disconnectTone(tone);
  }
}

function playEndTone() {
  let oscillator;
  let gain;
  try {
    if (!audioContext || audioContext.state !== "running") return;
    stopTone();
    oscillator = audioContext.createOscillator();
    gain = audioContext.createGain();
    const tone = { oscillator, gain };
    const now = audioContext.currentTime;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(660, now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.08);
    gain.gain.setValueAtTime(0.12, now + 1.5);
    gain.gain.linearRampToValueAtTime(0, now + 2);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.onended = () => disconnectTone(tone);
    activeTone = tone;
    oscillator.start(now);
    oscillator.stop(now + 2.05);
  } catch {
    try { oscillator?.stop(); } catch { /* 開始前の失敗も許容。 */ }
    if (oscillator && gain) disconnectTone({ oscillator, gain });
    activeTone = null;
  }
}

function finishTimer() {
  if (timer.state !== "running") return;
  timer.remainingMs = 0;
  timer.endsAt = null;
  timer.state = "finished";
  // 音声処理より先に状態と画面通知を確定し、重複通知を防ぐ。
  timerMessage.textContent = "時間になりました";
  render();
  playEndTone();
}

function updateMeasurements(now) {
  if (timer.state === "running") {
    timer.remainingMs = Math.max(0, timer.endsAt - now);
    if (timer.remainingMs === 0) finishTimer();
  }
  if (stopwatch.state === "running") {
    stopwatch.elapsedMs = Math.max(0, now - stopwatch.startedAt);
  }
}

function syncUpdateLoop() {
  const running = timer.state === "running" || stopwatch.state === "running";
  if (running && updateId === null) updateId = window.setInterval(tick, 20);
  if (!running && updateId !== null) {
    window.clearInterval(updateId);
    updateId = null;
  }
}

function tick() {
  updateMeasurements(Date.now());
  render();
  syncUpdateLoop();
}

function switchTab(name) {
  selectedTab = name;
  timerPanel.hidden = selectedTab !== "timer";
  stopwatchPanel.hidden = selectedTab !== "stopwatch";
  timerTab.setAttribute("aria-pressed", String(selectedTab === "timer"));
  stopwatchTab.setAttribute("aria-pressed", String(selectedTab === "stopwatch"));
  // 表示の切替では計測基準時刻も計測状態も変更しない。
  tick();
}

timerStart.addEventListener("click", () => {
  if (timer.state !== "stopped" && timer.state !== "paused") return;
  if (timer.state === "stopped") readSettings(true);
  if (timer.remainingMs <= 0) return;
  prepareAudio();
  timer.endsAt = Date.now() + timer.remainingMs;
  timer.state = "running";
  tick();
  timerPause.focus();
});

timerPause.addEventListener("click", () => {
  if (timer.state !== "running") return;
  // 最後の描画からの差分も反映。既に期限を過ぎていれば終了を優先する。
  updateMeasurements(Date.now());
  if (timer.state === "running") {
    timer.state = "paused";
    timer.endsAt = null;
  }
  tick();
  (timer.state === "finished" ? timerReset : timerStart).focus();
});

timerReset.addEventListener("click", () => {
  timer.state = "stopped";
  timer.endsAt = null;
  timer.remainingMs = timer.configuredMs;
  timerMessage.textContent = "";
  stopTone();
  tick();
});

stopwatchStart.addEventListener("click", () => {
  if (stopwatch.state === "running") return;
  prepareAudio();
  stopwatch.startedAt = Date.now() - stopwatch.elapsedMs;
  stopwatch.state = "running";
  tick();
  stopwatchPause.focus();
});

stopwatchPause.addEventListener("click", () => {
  if (stopwatch.state !== "running") return;
  updateMeasurements(Date.now());
  stopwatch.state = "paused";
  stopwatch.startedAt = null;
  tick();
  stopwatchStart.focus();
});

stopwatchReset.addEventListener("click", () => {
  stopwatch.state = "stopped";
  stopwatch.elapsedMs = 0;
  stopwatch.startedAt = null;
  tick();
  stopwatchStart.focus();
});

timeInputs.forEach((input) => {
  input.addEventListener("input", () => readSettings(false));
  input.addEventListener("blur", () => readSettings(true));
});
timerTab.addEventListener("click", () => switchTab("timer"));
stopwatchTab.addEventListener("click", () => switchTab("stopwatch"));
document.addEventListener("visibilitychange", tick);
window.addEventListener("pageshow", tick);
window.addEventListener("focus", tick);

// 再読み込み時は入力欄も含めて初期値へ戻す。永続化は行わない。
timeInputs[0].value = "0";
timeInputs[1].value = "5";
timeInputs[2].value = "0";
readSettings(true);
switchTab("timer");
