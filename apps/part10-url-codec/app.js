"use strict";

const sourceText = document.getElementById("source-text");
const resultText = document.getElementById("result-text");
const resultLabel = document.getElementById("result-label");
const encodeButton = document.getElementById("encode-button");
const decodeButton = document.getElementById("decode-button");
const copyButton = document.getElementById("copy-button");
const errorMessage = document.getElementById("error-message");
const errorMain = document.getElementById("error-main");
const errorDetail = document.getElementById("error-detail");
const copyStatus = document.getElementById("copy-status");

const CONVERSION_ERROR_ID = "error-message";
let conversionResult = "";
let conversionSucceeded = false;

function clearMessages() {
  errorMain.textContent = "";
  errorDetail.textContent = "";
  errorMessage.classList.remove("has-error");
  copyStatus.textContent = "";
}

function clearInputError() {
  sourceText.removeAttribute("aria-invalid");
  sourceText.removeAttribute("aria-describedby");
}

function setSuccessfulConversion(result, label) {
  conversionResult = result;
  conversionSucceeded = true;
  resultText.value = result;
  resultLabel.textContent = label;
  copyButton.disabled = result === "";
  clearInputError();
  clearMessages();
}

function setConversionError(mainMessage, error) {
  conversionResult = "";
  conversionSucceeded = false;
  resultText.value = "";
  resultLabel.textContent = "結果";
  copyButton.disabled = true;
  copyStatus.textContent = "";
  errorMain.textContent = mainMessage;
  errorDetail.textContent = error instanceof Error ? error.message : String(error);
  errorMessage.classList.add("has-error");
  sourceText.setAttribute("aria-invalid", "true");
  sourceText.setAttribute("aria-describedby", CONVERSION_ERROR_ID);
}

function convert(mode) {
  try {
    const result = mode === "encode"
      ? encodeURIComponent(sourceText.value)
      : decodeURIComponent(sourceText.value);
    const label = mode === "encode" ? "エンコード結果" : "デコード結果";
    setSuccessfulConversion(result, label);
  } catch (error) {
    const message = mode === "encode"
      ? "URLエンコードできません。入力文字列を確認してください。"
      : "URLデコードできません。入力文字列を確認してください。";
    setConversionError(message, error);
  }
}

async function copyResult() {
  if (!conversionSucceeded || conversionResult === "") return;

  try {
    await navigator.clipboard.writeText(conversionResult);
    errorMain.textContent = "";
    errorDetail.textContent = "";
    errorMessage.classList.remove("has-error");
    clearInputError();
    copyStatus.textContent = "コピーしました";
  } catch {
    copyStatus.textContent = "";
    errorMain.textContent = "コピーできませんでした。";
    errorDetail.textContent = "";
    errorMessage.classList.add("has-error");
    clearInputError();
  }
}

encodeButton.addEventListener("click", () => convert("encode"));
decodeButton.addEventListener("click", () => convert("decode"));
copyButton.addEventListener("click", copyResult);
