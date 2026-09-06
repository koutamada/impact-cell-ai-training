"use strict";

const ROLL_DURATION_MS = 600;

const state = {
  sides: 6,
  count: 1,
  results: [],
  total: 0,
  isRolling: false
};

const rollForm = document.getElementById("roll-form");
const sidesSelect = document.getElementById("sides");
const countInput = document.getElementById("count");
const countDecreaseButton = document.getElementById("count-decrease");
const countIncreaseButton = document.getElementById("count-increase");
const rollButton = document.getElementById("roll-button");
const errorMessage = document.getElementById("count-error");
const diceResults = document.getElementById("dice-results");
const totalValue = document.getElementById("total-value");
const resultAnnouncement = document.getElementById("result-announcement");
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

function rollDieFromRandom(randomValue, sides) {
  return Math.floor(randomValue * sides) + 1;
}

function rollDie(sides) {
  return rollDieFromRandom(Math.random(), sides);
}

function rollDice(sides, count) {
  const results = [];
  for (let index = 0; index < count; index += 1) {
    results.push(rollDie(sides));
  }
  return results;
}

function validateCount(rawValue) {
  const value = rawValue.trim();
  if (value === "") {
    return { valid: false, type: "empty", message: "個数を入力してください" };
  }
  if (!/^[+-]?\d+$/.test(value)) {
    return { valid: false, type: "integer", message: "1〜10の整数を入力してください" };
  }

  const count = Number(value);
  if (count < 1 || count > 10) {
    return { valid: false, type: "range", message: "1〜10個の範囲で指定してください" };
  }
  return { valid: true, value: count };
}

function updateCountButtons() {
  const validation = validateCount(countInput.value);
  countDecreaseButton.disabled = !validation.valid || validation.value === 1;
  countIncreaseButton.disabled = !validation.valid || validation.value === 10;
}

function changeCount(amount) {
  const validation = validateCount(countInput.value);
  if (!validation.valid) return;

  const nextCount = validation.value + amount;
  if (nextCount < 1 || nextCount > 10) return;
  countInput.value = String(nextCount);
  updateCountButtons();
}

function calculateTotal(results) {
  return results.reduce((sum, value) => sum + value, 0);
}

function createDieCard(sides, value, isRolling) {
  const card = document.createElement("div");
  const kind = document.createElement("span");
  const result = document.createElement("strong");

  card.className = isRolling ? "die-card is-rolling" : "die-card";
  kind.className = "die-kind";
  result.className = "die-value";
  kind.textContent = `d${sides}`;
  result.textContent = isRolling ? "?" : String(value);
  card.append(kind, result);
  return card;
}

function renderCards(sides, values, isRolling) {
  const fragment = document.createDocumentFragment();
  for (const value of values) {
    fragment.append(createDieCard(sides, value, isRolling));
  }
  diceResults.replaceChildren(fragment);
}

function renderRolling(sides, count) {
  renderCards(sides, Array.from({ length: count }, () => null), true);
  totalValue.textContent = "—";
}

function renderResult() {
  renderCards(state.sides, state.results, false);
  totalValue.textContent = String(state.total);
}

function showError(message) {
  errorMessage.textContent = message;
  countInput.setAttribute("aria-invalid", "true");
}

function clearError() {
  errorMessage.textContent = "";
  countInput.removeAttribute("aria-invalid");
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function handleRoll(event) {
  event.preventDefault();
  if (state.isRolling) return;

  const sides = Number(sidesSelect.value);
  const validation = validateCount(countInput.value);
  if (!validation.valid) {
    showError(validation.message);
    return;
  }

  clearError();
  const count = validation.value;
  const results = rollDice(sides, count);
  const total = calculateTotal(results);

  state.sides = sides;
  state.count = count;
  state.results = results;
  state.total = total;
  state.isRolling = true;
  rollButton.disabled = true;
  renderRolling(sides, count);

  const waitTime = reducedMotionQuery.matches ? 0 : ROLL_DURATION_MS;
  await wait(waitTime);

  renderResult();
  resultAnnouncement.textContent = `${count}個のd${sides}を振りました。結果 ${results.join("、")}。合計${total}`;
  state.isRolling = false;
  rollButton.disabled = false;
}

rollForm.addEventListener("submit", handleRoll);
countInput.addEventListener("input", updateCountButtons);
countDecreaseButton.addEventListener("click", () => changeCount(-1));
countIncreaseButton.addEventListener("click", () => changeCount(1));
updateCountButtons();
