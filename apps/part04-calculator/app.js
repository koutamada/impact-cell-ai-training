"use strict";

// 仕様7-3の6状態。入力文字列と確定済み数値を分けて保持する。
let currentInput = "0";
let accumulator = null;
let pendingOperator = null;
let expression = [];
let state = "S1";
const history = [];

const display = document.getElementById("display");
const mainDisplay = document.getElementById("main-display");
const subDisplay = document.getElementById("sub-display");
const errorDisplay = document.getElementById("error-display");
const historyList = document.getElementById("history-list");
const historyEmpty = document.getElementById("history-empty");
const clearHistoryButton = document.getElementById("clear-history");
const buttons = new Map([...document.querySelectorAll("[data-action]")]
  .map((button) => [button.dataset.action, button]));
const highlightTimers = new Map();

// 仕様6-3-1 F1〜F6。指数表記を文字列操作で展開し、追加の丸めをしない。
function formatNumber(value) {
  if (value === 0) return "0";
  let text = value.toPrecision(12);
  const negative = text.startsWith("-");
  if (negative) text = text.slice(1);
  const [mantissa, exponent = "0"] = text.split(/e/i);
  const dot = mantissa.indexOf(".");
  const k = dot === -1 ? mantissa.length : dot;
  const digits = mantissa.replace(".", "");
  const p = k + Number(exponent);
  if (p <= 0) text = "0." + "0".repeat(-p) + digits;
  else if (p < digits.length) text = digits.slice(0, p) + "." + digits.slice(p);
  else text = digits + "0".repeat(p - digits.length);
  if (text.includes(".")) text = text.replace(/0+$/, "").replace(/\.$/, "");
  if (negative) text = "-" + text;
  return text === "-0" ? "0" : text;
}

function calculate(left, operator, right) {
  let result;
  switch (operator) {
    case "+": result = left + right; break;
    case "−": result = left - right; break;
    case "×": result = left * right; break;
    case "÷": result = left / right; break;
    default: return null;
  }
  if (!Number.isFinite(result)) return null;
  result = Number(result.toPrecision(12));
  if (Math.abs(result) >= 1e12 || (result !== 0 && Math.abs(result) < 1e-12)) return null;
  return { value: result, text: formatNumber(result) };
}

function allClear() {
  currentInput = "0";
  accumulator = null;
  pendingOperator = null;
  expression = [];
  state = "S1";
}

function inputDigit(digit) {
  if (state === "S5") allClear();
  if (state === "S1" || state === "S3") {
    currentInput = digit;
    state = state === "S3" ? "S4" : "S2";
  } else if ((currentInput.match(/[0-9]/g) || []).length < 12) {
    currentInput = currentInput === "0" ? digit : currentInput + digit;
  }
}

function inputDecimal() {
  if (state === "S5") allClear();
  if (state === "S1" || state === "S3") {
    currentInput = "0.";
    state = state === "S3" ? "S4" : "S2";
  } else if (!currentInput.includes(".")) currentInput += ".";
}

function inputOperator(operator) {
  if (state === "S3") {
    pendingOperator = operator;
    return;
  }
  if (state === "S4") {
    const right = Number(currentInput);
    const result = calculate(accumulator, pendingOperator, right);
    if (!result) { state = "S6"; return; }
    expression.push(pendingOperator, formatNumber(right), "→", result.text);
    accumulator = result.value;
    currentInput = result.text;
  } else {
    accumulator = Number(currentInput);
    expression = [formatNumber(accumulator)];
    // S2で確定しても入力中の表示（1.50、3.など）は書き換えない。
  }
  pendingOperator = operator;
  state = "S3";
}

function inputEquals() {
  if (state !== "S4") return;
  const right = Number(currentInput);
  const result = calculate(accumulator, pendingOperator, right);
  if (!result) { state = "S6"; return; }
  expression.push(pendingOperator, formatNumber(right));
  currentInput = result.text;
  accumulator = result.value;
  pendingOperator = null;
  state = "S5";
  // 履歴への追加はこの成功経路のみ。途中計算・連続した = では追加しない。
  history.unshift(expression.join(" ") + " = " + result.text);
  if (history.length > 50) history.pop();
  renderHistory();
}

function backspace() {
  if (state === "S2" || state === "S4") currentInput = currentInput.slice(0, -1) || "0";
}

function dispatchAction(action) {
  if (action === "AC") allClear();
  else {
    if (state === "S6") return;
    if (/^[0-9]$/.test(action)) inputDigit(action);
    else if (action === ".") inputDecimal();
    else if (["+", "−", "×", "÷"].includes(action)) inputOperator(action);
    else if (action === "=") inputEquals();
    else if (action === "backspace") backspace();
    else return;
  }
  render();
}

function render() {
  const error = state === "S6";
  display.classList.toggle("error", error);
  mainDisplay.hidden = error;
  errorDisplay.hidden = !error;
  errorDisplay.textContent = error ? "エラー" : "";
  if (mainDisplay.textContent !== currentInput) mainDisplay.textContent = currentInput;
  mainDisplay.classList.toggle("compact", currentInput.length > 10 && currentInput.length <= 15);
  mainDisplay.classList.toggle("long", currentInput.length > 15);
  let sub = "";
  if (state === "S3" || state === "S4") sub = expression.join(" ") + " " + pendingOperator;
  else if (state === "S5") sub = expression.join(" ") + " =";
  subDisplay.textContent = sub;
  // overflow:hidden のまま最新部分を見せる。ユーザー用の横スクロールは設けない。
  subDisplay.scrollLeft = subDisplay.scrollWidth;
}

function renderHistory() {
  historyList.replaceChildren();
  for (const entry of history) {
    const row = document.createElement("li");
    row.textContent = entry;
    historyList.append(row);
  }
  historyEmpty.hidden = history.length !== 0;
  clearHistoryButton.disabled = history.length === 0;
}

function clearHistory() {
  history.length = 0;
  renderHistory();
}

function highlightButton(action) {
  const button = buttons.get(action);
  if (!button) return;
  window.clearTimeout(highlightTimers.get(action));
  button.classList.add("key-active");
  highlightTimers.set(action, window.setTimeout(() => {
    button.classList.remove("key-active");
    highlightTimers.delete(action);
  }, 120));
}

function handleKeydown(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const keyMap = { "-": "−", "*": "×", "/": "÷", Enter: "=", Escape: "AC", Backspace: "backspace" };
  const action = /^[0-9.+=]$/.test(event.key) ? event.key
    : Object.hasOwn(keyMap, event.key) ? keyMap[event.key] : null;
  if (action === null) return;
  // エラー時もEnterの既定クリックを抑止し、フォーカスは維持する。
  event.preventDefault();
  if (state === "S6" && action !== "AC") return;
  highlightButton(action);
  dispatchAction(action);
}

for (const [action, button] of buttons) button.addEventListener("click", () => dispatchAction(action));
clearHistoryButton.addEventListener("click", clearHistory);
document.addEventListener("keydown", handleKeydown);
render();
renderHistory();
