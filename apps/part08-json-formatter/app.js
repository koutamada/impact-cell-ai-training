"use strict";

const INPUT_LIMIT = 1000000;
const HIGHLIGHT_LIMIT = 200000;
const JSON_WHITESPACE_ONLY = /^[ \t\n\r]*$/;
const TOKEN_PATTERN = /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b|[{}\[\],:]/g;

let formattedJson = null;
let composing = false;
let processingTimer = null;

const input = document.getElementById("json-input");
const result = document.getElementById("json-result");
const resultNotice = document.getElementById("result-notice");
const errorArea = document.getElementById("error-area");
const operationStatus = document.getElementById("operation-status");
const copyButton = document.getElementById("copy-button");
const saveButton = document.getElementById("save-button");

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function classifyToken(token, source, endPosition) {
  if (token.startsWith('"')) {
    return /^\s*:/.test(source.slice(endPosition)) ? "key" : "string";
  }
  if (token === "true" || token === "false") return "boolean";
  if (token === "null") return "null";
  if (/^[{}\[\],:]$/.test(token)) return "symbol";
  return "number";
}

function makeHighlightedHtml(source) {
  let html = "";
  let previousEnd = 0;
  TOKEN_PATTERN.lastIndex = 0;
  let match = TOKEN_PATTERN.exec(source);

  while (match !== null) {
    html += escapeHtml(source.slice(previousEnd, match.index));
    const token = match[0];
    const type = classifyToken(token, source, TOKEN_PATTERN.lastIndex);
    html += `<span class="token-${type}">${escapeHtml(token)}</span>`;
    previousEnd = TOKEN_PATTERN.lastIndex;
    match = TOKEN_PATTERN.exec(source);
  }

  html += escapeHtml(source.slice(previousEnd));
  return html;
}

function getErrorLocation(message, source) {
  const match = /position (\d+)/i.exec(message);
  if (!match) return null;
  const position = Number(match[1]);
  if (!Number.isInteger(position) || position < 0) return null;
  const limitedPosition = Math.min(position, source.length);
  let line = 1;
  let lastNewline = -1;
  for (let index = 0; index < limitedPosition; index += 1) {
    if (source[index] === "\n") {
      line += 1;
      lastNewline = index;
    }
  }
  return { line, column: limitedPosition - lastNewline };
}

function setButtonsEnabled(enabled) {
  copyButton.disabled = !enabled;
  saveButton.disabled = !enabled;
}

function clearMessages() {
  errorArea.replaceChildren();
  operationStatus.textContent = "";
}

function clearResult() {
  formattedJson = null;
  result.textContent = "";
  resultNotice.textContent = "";
  resultNotice.className = "result-notice";
  setButtonsEnabled(false);
}

function showSimpleError(message) {
  const box = document.createElement("div");
  box.className = "error-box";
  const title = document.createElement("p");
  title.className = "error-title";
  title.textContent = message;
  box.append(title);
  errorArea.replaceChildren(box);
}

function showParseError(error, source) {
  const box = document.createElement("div");
  box.className = "error-box";
  const title = document.createElement("p");
  title.className = "error-title";
  title.textContent = "JSONの構文が正しくありません";
  box.append(title);

  const location = getErrorLocation(error.message, source);
  if (location !== null) {
    const position = document.createElement("p");
    position.className = "error-position";
    position.textContent = `${location.line}行目 ${location.column}列目付近`;
    box.append(position);
  }

  const detail = document.createElement("p");
  detail.className = "error-detail";
  detail.textContent = error.message;
  box.append(detail);
  errorArea.replaceChildren(box);
}

function showEmptyState() {
  clearResult();
  clearMessages();
  resultNotice.textContent = "JSONを入力してください";
  input.setAttribute("aria-invalid", "false");
}

function processInput() {
  if (composing) return;
  const source = input.value;
  clearMessages();

  if (JSON_WHITESPACE_ONLY.test(source)) {
    showEmptyState();
    return;
  }

  if (source.length > INPUT_LIMIT) {
    clearResult();
    input.setAttribute("aria-invalid", "true");
    showSimpleError("入力が大きすぎます（100万文字まで）");
    return;
  }

  try {
    const parsed = JSON.parse(source);
    formattedJson = JSON.stringify(parsed, null, 2);
    input.setAttribute("aria-invalid", "false");
    setButtonsEnabled(true);
    if (formattedJson.length > HIGHLIGHT_LIMIT) {
      result.textContent = formattedJson;
      resultNotice.textContent = "結果が大きいため、シンタックスハイライトを省略しました";
      resultNotice.className = "result-notice highlight-notice";
    } else {
      result.innerHTML = makeHighlightedHtml(formattedJson);
      resultNotice.textContent = "";
      resultNotice.className = "result-notice";
    }
  } catch (error) {
    clearResult();
    input.setAttribute("aria-invalid", "true");
    showParseError(error, source);
  }
}

function scheduleProcessing() {
  if (processingTimer !== null) clearTimeout(processingTimer);
  processingTimer = setTimeout(() => {
    processingTimer = null;
    processInput();
  }, 300);
}

function padTwoDigits(value) {
  return String(value).padStart(2, "0");
}

function makeFileName(now = new Date()) {
  const year = now.getFullYear();
  const month = padTwoDigits(now.getMonth() + 1);
  const day = padTwoDigits(now.getDate());
  const hours = padTwoDigits(now.getHours());
  const minutes = padTwoDigits(now.getMinutes());
  return `formatted-${year}${month}${day}-${hours}${minutes}.json`;
}

copyButton.addEventListener("click", async () => {
  if (formattedJson === null) return;
  errorArea.replaceChildren();
  operationStatus.textContent = "";
  try {
    await navigator.clipboard.writeText(formattedJson);
    operationStatus.textContent = "コピーしました";
  } catch (_error) {
    showSimpleError("コピーできませんでした");
  }
});

saveButton.addEventListener("click", () => {
  if (formattedJson === null) return;
  errorArea.replaceChildren();
  operationStatus.textContent = "";
  let objectUrl = null;
  try {
    const blob = new Blob([formattedJson], { type: "application/json" });
    objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = makeFileName();
    document.body.append(link);
    link.click();
    link.remove();
  } catch (_error) {
    showSimpleError("ファイルを保存できませんでした");
  } finally {
    if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
  }
});

input.addEventListener("compositionstart", () => {
  composing = true;
  if (processingTimer !== null) clearTimeout(processingTimer);
  processingTimer = null;
});

input.addEventListener("compositionend", () => {
  composing = false;
  scheduleProcessing();
});

input.addEventListener("input", (event) => {
  if (composing || event.isComposing) return;
  scheduleProcessing();
});

showEmptyState();
