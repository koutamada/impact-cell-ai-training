"use strict";

const DIFFICULTIES = {
  easy: { min: 1, max: 10 },
  normal: { min: 1, max: 50 },
  hard: { min: 1, max: 100 }
};

const INITIAL_HINT = "数字を予想してください";

const state = {
  difficulty: "easy",
  min: 1,
  max: 10,
  answer: null,
  attempts: 0,
  status: "playing"
};

const difficultySelect = document.getElementById("difficulty");
const rangeMessage = document.getElementById("range-message");
const guessForm = document.getElementById("guess-form");
const guessInput = document.getElementById("guess-input");
const guessButton = document.getElementById("guess-button");
const inputError = document.getElementById("input-error");
const hintMessage = document.getElementById("hint-message");
const attemptsMessage = document.getElementById("attempts-message");
const restartButton = document.getElementById("restart-button");

function generateAnswer(min, max, previousAnswer) {
  let candidate;
  do {
    candidate = Math.floor(Math.random() * (max - min + 1)) + min;
  } while (candidate === previousAnswer);
  return candidate;
}

function clearError() {
  inputError.textContent = "";
  guessInput.removeAttribute("aria-invalid");
}

function showError(message) {
  inputError.textContent = message;
  guessInput.setAttribute("aria-invalid", "true");
}

function updateAttempts() {
  attemptsMessage.textContent = `挑戦回数：${state.attempts}回`;
}

function startGame(difficulty, moveFocus) {
  const previousAnswer = state.answer;
  const range = DIFFICULTIES[difficulty];

  state.difficulty = difficulty;
  state.min = range.min;
  state.max = range.max;
  state.answer = generateAnswer(state.min, state.max, previousAnswer);
  state.attempts = 0;
  state.status = "playing";

  difficultySelect.value = difficulty;
  rangeMessage.textContent = `${state.min} 〜 ${state.max} の数字を当ててください`;
  guessInput.min = String(state.min);
  guessInput.max = String(state.max);
  guessInput.value = "";
  guessInput.disabled = false;
  guessButton.disabled = false;
  restartButton.disabled = true;
  hintMessage.textContent = INITIAL_HINT;
  updateAttempts();
  clearError();

  if (moveFocus) guessInput.focus();
}

function validateGuess() {
  const value = guessInput.value.trim();
  if (value === "") return { error: "数字を入力してください" };
  if (!/^[+-]?\d+$/.test(value)) return { error: "整数を入力してください" };

  const number = Number(value);
  if (number < state.min || number > state.max) {
    return { error: `${state.min} 〜 ${state.max} の範囲で入力してください` };
  }
  return { number };
}

function submitGuess(event) {
  event.preventDefault();
  if (event.isComposing || state.status !== "playing") return;

  const guess = validateGuess();
  if (guess.error) {
    showError(guess.error);
    return;
  }

  clearError();
  state.attempts += 1;
  updateAttempts();

  if (guess.number < state.answer) {
    hintMessage.textContent = "もっと大きい数字です";
    return;
  }
  if (guess.number > state.answer) {
    hintMessage.textContent = "もっと小さい数字です";
    return;
  }

  state.status = "cleared";
  hintMessage.textContent = `正解！ ${state.answer} でした。${state.attempts}回で当てました`;
  guessInput.disabled = true;
  guessButton.disabled = true;
  restartButton.disabled = false;
  restartButton.focus();
}

difficultySelect.addEventListener("change", () => {
  startGame(difficultySelect.value, true);
});

guessForm.addEventListener("submit", submitGuess);

restartButton.addEventListener("click", () => {
  startGame(state.difficulty, true);
});

startGame("easy", false);
