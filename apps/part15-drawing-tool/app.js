"use strict";

/* =========================================================
   Part 15: お絵描きツール
   仕様書: docs/part15-drawing-tool/part15-drawing-tool-spec.md
   ========================================================= */

/* ---------- 定数（7-1 / 6-1 / 9-1 / 15章） ---------- */

const COLORS = [
  { value: "#000000", name: "黒" },
  { value: "#e02020", name: "赤" },
  { value: "#f0820a", name: "オレンジ" },
  { value: "#f5c518", name: "黄" },
  { value: "#1f9d3a", name: "緑" },
  { value: "#1f6fd0", name: "青" },
  { value: "#8034c4", name: "紫" },
  { value: "#e85a9b", name: "ピンク" }
];

const LOGICAL_WIDTH = 700;   // Canvas論理座標の幅（6-1）
const ASPECT = 3 / 4;        // 高さ ÷ 幅（4:3。6-5）
const LOGICAL_HEIGHT = LOGICAL_WIDTH * ASPECT;
const MAX_DPR = 3;           // devicePixelRatio の上限（6-3 R2）

/* ---------- 要素 ---------- */

const canvas = document.getElementById("draw-canvas");
const ctx = canvas.getContext("2d");
const palette = document.getElementById("color-palette");
const penButton = document.getElementById("tool-pen");
const eraserButton = document.getElementById("tool-eraser");
const widthInput = document.getElementById("line-width");
const widthValue = document.getElementById("line-width-value");
const saveButton = document.getElementById("save-button");
const clearButton = document.getElementById("clear-button");
const message = document.getElementById("message");

/* ---------- 状態（12-1） ---------- */

const state = {
  isDrawing: false,
  activePointerId: null,
  lastX: 0,
  lastY: 0,
  color: COLORS[0].value,
  lineWidth: 5,
  tool: "pen"
};

const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);

/* ---------- 初期化（6-1） ---------- */

// 内部解像度は初期化時に1回だけ決め、以後変更しない（6-1 R3 / 6-4）
canvas.width = Math.round(LOGICAL_WIDTH * dpr);
canvas.height = Math.round(LOGICAL_HEIGHT * dpr);
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
ctx.lineCap = "round";
ctx.lineJoin = "round";

/* ---------- 座標変換（5-1） ---------- */

function toCanvasPoint(event) {
  // getBoundingClientRect はイベントのたびに呼ぶ（5-1 X4）
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX / dpr,
    y: (event.clientY - rect.top) * scaleY / dpr
  };
}

/* ---------- 描画設定（8-2 / 9-3） ---------- */

function applyStrokeStyle() {
  ctx.lineWidth = state.lineWidth;
  if (state.tool === "eraser") {
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "#000000"; // destination-out では色は結果に影響しない
  } else {
    // ペンへ戻すときは必ず source-over へ戻す（8-2 E2）
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = state.color;
  }
}

/* ---------- 描画（3-3 / 4-4） ---------- */

// pointerdown 時の点。第一候補：同一点への moveTo → lineTo → stroke（4-4 P5）
function drawDot(x, y) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y);
  ctx.stroke();
}

// pointermove 時の線。前回座標から現在座標へ引く（3-3 C3）
function drawLine(fromX, fromY, toX, toY) {
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();
}

/* ---------- Pointer Events（4章） ---------- */

function handlePointerDown(event) {
  // すでに描画中なら、別ポインタの pointerdown を無視する（4-6 P9）
  if (state.isDrawing) return;

  state.isDrawing = true;
  state.activePointerId = event.pointerId;

  try {
    canvas.setPointerCapture(event.pointerId);
  } catch (error) {
    // capture できなくても描画は継続する
  }

  const point = toCanvasPoint(event);
  state.lastX = point.x;
  state.lastY = point.y;

  applyStrokeStyle();
  drawDot(point.x, point.y);
}

function handlePointerMove(event) {
  if (!state.isDrawing) return;
  if (event.pointerId !== state.activePointerId) return; // 4-6 P10

  const point = toCanvasPoint(event);
  drawLine(state.lastX, state.lastY, point.x, point.y);
  state.lastX = point.x;
  state.lastY = point.y;
}

function endStroke(event) {
  if (!state.isDrawing) return;
  if (event.pointerId !== state.activePointerId) return; // 4-6 P10

  state.isDrawing = false;
  state.activePointerId = null;

  try {
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  } catch (error) {
    // 解放できなくても状態は待機へ戻す
  }
}

canvas.addEventListener("pointerdown", handlePointerDown);
canvas.addEventListener("pointermove", handlePointerMove);
canvas.addEventListener("pointerup", endStroke);
canvas.addEventListener("pointercancel", endStroke); // 4-2

/* ---------- 色パレット（7-2 / 7-3） ---------- */

function updateColorButtons() {
  const buttons = palette.querySelectorAll("[data-color]");
  for (const button of buttons) {
    button.setAttribute(
      "aria-pressed",
      button.dataset.color === state.color ? "true" : "false"
    );
  }
}

function buildPalette() {
  const fragment = document.createDocumentFragment();
  for (const color of COLORS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "color-button";
    button.dataset.color = color.value;
    button.setAttribute("aria-label", color.name);
    button.setAttribute("aria-pressed", "false");

    const swatch = document.createElement("span");
    swatch.className = "color-button__swatch";
    swatch.style.backgroundColor = color.value;
    button.append(swatch);

    button.addEventListener("click", () => {
      state.color = color.value;
      state.tool = "pen"; // 色を選んだらペンへ戻す（8-5）
      updateColorButtons();
      updateToolButtons();
    });

    fragment.append(button);
  }
  palette.replaceChildren(fragment);
  updateColorButtons();
}

/* ---------- ツール切替（8-4） ---------- */

function updateToolButtons() {
  penButton.setAttribute("aria-pressed", state.tool === "pen" ? "true" : "false");
  eraserButton.setAttribute("aria-pressed", state.tool === "eraser" ? "true" : "false");
}

penButton.addEventListener("click", () => {
  state.tool = "pen";
  updateToolButtons();
});

eraserButton.addEventListener("click", () => {
  state.tool = "eraser";
  updateToolButtons();
});

/* ---------- 線の太さ（9章） ---------- */

function updateWidthValue() {
  // 単位を付けない（9-2 W2）
  widthValue.textContent = String(state.lineWidth);
}

widthInput.addEventListener("input", () => {
  state.lineWidth = Number(widthInput.value);
  updateWidthValue();
});

/* ---------- 全消去（10章） ---------- */

clearButton.addEventListener("click", () => {
  // 合成モードの影響を受けないよう source-over に戻してからクリアする
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
  clearMessage();
  // 色・線幅・ツールは維持する（10-3）
});

/* ---------- メッセージ（11-5） ---------- */

function showMessage(text) {
  message.textContent = text;
}

function clearMessage() {
  message.textContent = "";
}

/* ---------- ファイル名（11-2） ---------- */

function buildFileName(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return "drawing-" +
    date.getFullYear() +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    "-" +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds()) +
    ".png";
}

/* ---------- PNG保存（11章） ---------- */

// 一時Canvasに白背景を合成する。表示中Canvasは変更しない（11-3 / 11-4）
function createExportCanvas() {
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = canvas.width;
  exportCanvas.height = canvas.height;
  const exportCtx = exportCanvas.getContext("2d");
  exportCtx.fillStyle = "#ffffff";
  exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  exportCtx.drawImage(canvas, 0, 0);
  return exportCanvas;
}

saveButton.addEventListener("click", () => {
  clearMessage();
  try {
    const exportCanvas = createExportCanvas();
    exportCanvas.toBlob((blob) => {
      if (!blob) {
        showMessage("画像を保存できませんでした");
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = buildFileName(new Date());
      link.click();
      URL.revokeObjectURL(url); // 11-1 S4
    }, "image/png");
  } catch (error) {
    showMessage("画像を保存できませんでした");
  }
});

/* ---------- 初期表示（15章） ---------- */

buildPalette();
updateToolButtons();
updateWidthValue();
