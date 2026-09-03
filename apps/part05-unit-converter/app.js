"use strict";

const units = {
  length: [
    { id: "mm", label: "mm（ミリメートル）", factor: 0.001 },
    { id: "cm", label: "cm（センチメートル）", factor: 0.01 },
    { id: "m", label: "m（メートル）", factor: 1 },
    { id: "km", label: "km（キロメートル）", factor: 1000 },
    { id: "in", label: "in（インチ）", factor: 0.0254 },
    { id: "ft", label: "ft（フィート）", factor: 0.3048 }
  ],
  weight: [
    { id: "mg", label: "mg（ミリグラム）", factor: 0.000001 },
    { id: "g", label: "g（グラム）", factor: 0.001 },
    { id: "kg", label: "kg（キログラム）", factor: 1 },
    { id: "oz", label: "oz（オンス）", factor: 0.028349523125 },
    { id: "lb", label: "lb（ポンド）", factor: 0.45359237 },
    { id: "t", label: "t（トン）", factor: 1000 }
  ],
  temperature: [
    { id: "℃", label: "℃（セルシウス度）", minimum: -273.15 },
    { id: "℉", label: "℉（ファーレンハイト度）", minimum: -459.67 },
    { id: "K", label: "K（ケルビン）", minimum: 0 },
    { id: "°R", label: "°R（ランキン度）", minimum: 0 },
    { id: "°Ré", label: "°Ré（レオミュール度）", minimum: -218.52 }
  ]
};

const defaults = {
  length: { from: "m", to: "cm" },
  weight: { from: "kg", to: "g" },
  temperature: { from: "℃", to: "℉" }
};

let category = "length";
let fromUnit = "m";
let toUnit = "cm";
let inputText = "1";
let composing = false;

const categorySelect = document.getElementById("category");
const input = document.getElementById("input-value");
const fromSelect = document.getElementById("from-unit");
const toSelect = document.getElementById("to-unit");
const output = document.getElementById("result");
const message = document.getElementById("message");

function normalizeInput(value) {
  return value.trim()
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
    .replace(/．/g, ".")
    .replace(/[－−]/g, "-");
}

function classifyInput(value) {
  const normalized = normalizeInput(value);
  if (normalized === "") return { kind: "empty" };
  if (["-", "+", ".", "-.", "+."].includes(normalized)) return { kind: "partial" };
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(normalized)) {
    return { kind: "invalid", message: "数値を入力してください" };
  }
  const number = Number(normalized);
  if (!Number.isFinite(number) || Math.abs(number) >= 1e15) {
    return { kind: "invalid", message: "入力できる範囲を超えています" };
  }
  if (category === "temperature") {
    const unit = units.temperature.find((item) => item.id === fromUnit);
    if (number < unit.minimum) {
      return {
        kind: "invalid",
        message: `絶対零度（${unit.minimum}${unit.id}）を下回る値は入力できません`
      };
    }
  }
  return { kind: "valid", value: number };
}

function convertTemperature(value, from, to) {
  let kelvin;
  if (from === "℃") kelvin = value + 273.15;
  if (from === "℉") kelvin = (value + 459.67) * 5 / 9;
  if (from === "K") kelvin = value;
  if (from === "°R") kelvin = value * 5 / 9;
  if (from === "°Ré") kelvin = value * 1.25 + 273.15;
  if (to === "℃") return kelvin - 273.15;
  if (to === "℉") return kelvin * 9 / 5 - 459.67;
  if (to === "K") return kelvin;
  if (to === "°R") return kelvin * 9 / 5;
  return (kelvin - 273.15) * 0.8;
}

function convertValue(value) {
  if (fromUnit === toUnit) return value;
  if (category === "temperature") return convertTemperature(value, fromUnit, toUnit);
  const list = units[category];
  const fromFactor = list.find((item) => item.id === fromUnit).factor;
  const toFactor = list.find((item) => item.id === toUnit).factor;
  const base = value * fromFactor;
  return base / toFactor;
}

// 仕様8章G1〜G7。固定小数点・指数表記とも有効数字12桁を保つ。
function formatResult(result) {
  if (!Number.isFinite(result)) return null;
  const value = Number(result.toPrecision(12));
  if (value === 0) return "0";
  if (Math.abs(value) >= 1e-9 && Math.abs(value) < 1e15) {
    const exponent = Math.floor(Math.log10(Math.abs(value)));
    const decimals = Math.min(Math.max(12 - exponent - 1, 0), 100);
    let text = value.toFixed(decimals);
    if (text.includes(".")) text = text.replace(/0+$/, "").replace(/\.$/, "");
    return text === "-0" ? "0" : text;
  }
  const [mantissa, exponent] = value.toExponential(11).split("e");
  const trimmedMantissa = mantissa.replace(/0+$/, "").replace(/\.$/, "");
  return `${trimmedMantissa}e${exponent}`;
}

function updateConversion() {
  if (composing) return;

  inputText = input.value;
  const parsed = classifyInput(inputText);
  if (parsed.kind !== "valid") {
    output.textContent = "";
    message.textContent = parsed.message || "";
    input.setAttribute("aria-invalid", String(parsed.kind === "invalid"));
    return;
  }
  const formatted = formatResult(convertValue(parsed.value));
  if (formatted === null) {
    output.textContent = "";
    message.textContent = "入力できる範囲を超えています";
    input.setAttribute("aria-invalid", "true");
    return;
  }
  output.textContent = formatted;
  message.textContent = "";
  input.setAttribute("aria-invalid", "false");
}

function populateUnits() {
  fromSelect.replaceChildren();
  toSelect.replaceChildren();
  for (const unit of units[category]) {
    const fromOption = document.createElement("option");
    fromOption.value = unit.id;
    fromOption.textContent = unit.label;
    const toOption = fromOption.cloneNode(true);
    fromSelect.append(fromOption);
    toSelect.append(toOption);
  }
  fromSelect.value = fromUnit;
  toSelect.value = toUnit;
}

categorySelect.addEventListener("change", () => {
  category = categorySelect.value;
  fromUnit = defaults[category].from;
  toUnit = defaults[category].to;
  populateUnits();
  updateConversion();
});

fromSelect.addEventListener("change", () => {
  fromUnit = fromSelect.value;
  updateConversion();
});

toSelect.addEventListener("change", () => {
  toUnit = toSelect.value;
  updateConversion();
});

input.addEventListener("compositionstart", () => { composing = true; });
input.addEventListener("compositionend", () => {
  composing = false;
  updateConversion();
});
input.addEventListener("input", (event) => {
  if (!composing && !event.isComposing) updateConversion();
});

categorySelect.value = category;
input.value = inputText;
populateUnits();
updateConversion();
