"use strict";

const HANDS = ["rock", "scissors", "paper"];
const HAND_LABELS = {
  rock: "グー",
  scissors: "チョキ",
  paper: "パー"
};
const BEATS = {
  rock: "scissors",
  scissors: "paper",
  paper: "rock"
};
const RESULT_LABELS = {
  win: "勝ち",
  lose: "負け",
  draw: "引き分け"
};

// 表示専用の対応表（ゲームロジックには関与しない）
const HAND_ICONS = {
  rock: "#hand-rock",
  scissors: "#hand-scissors",
  paper: "#hand-paper"
};
const RESULT_MODIFIERS = {
  win: "is-win",
  lose: "is-lose",
  draw: "is-draw"
};

const state = {
  total: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  lastUserHand: null,
  lastCpuHand: null,
  lastResult: null,
  history: []
};

const handButtons = document.querySelectorAll("[data-hand]");
const roundResult = document.getElementById("round-result");
const roundBoard = document.getElementById("round-board");
const roundVerdict = document.getElementById("round-verdict");
const youHandIcon = document.getElementById("you-hand-icon");
const youHandName = document.getElementById("you-hand-name");
const cpuHandIcon = document.getElementById("cpu-hand-icon");
const cpuHandName = document.getElementById("cpu-hand-name");
const totalCount = document.getElementById("total-count");
const winCount = document.getElementById("win-count");
const lossCount = document.getElementById("loss-count");
const drawCount = document.getElementById("draw-count");
const winRate = document.getElementById("win-rate");
const historyList = document.getElementById("history-list");
const historyEmpty = document.getElementById("history-empty");

function handFromRandom(randomValue) {
  return HANDS[Math.floor(randomValue * 3)];
}

function pickComputerHand() {
  return handFromRandom(Math.random());
}

function judge(userHand, computerHand) {
  if (userHand === computerHand) return "draw";
  if (BEATS[userHand] === computerHand) return "win";
  return "lose";
}

function calculateWinRate(wins, total) {
  const rate = total === 0 ? 0 : (wins / total) * 100;
  return `${rate.toFixed(1)}%`;
}

function resultText(result) {
  return result === "win" ? "勝ち！" : RESULT_LABELS[result];
}

// 今回の結果の視覚表現。装飾のため aria-hidden 側だけを更新する
function renderRoundBoard() {
  roundBoard.classList.remove("is-empty", "is-win", "is-lose", "is-draw");

  if (state.lastResult === null) {
    roundBoard.classList.add("is-empty");
    roundVerdict.textContent = "まだ対戦していません";
    youHandIcon.setAttribute("href", "#hand-unknown");
    cpuHandIcon.setAttribute("href", "#hand-unknown");
    youHandName.textContent = "—";
    cpuHandName.textContent = "—";
    return;
  }

  roundBoard.classList.add(RESULT_MODIFIERS[state.lastResult]);
  roundVerdict.textContent = resultText(state.lastResult);
  youHandIcon.setAttribute("href", HAND_ICONS[state.lastUserHand]);
  cpuHandIcon.setAttribute("href", HAND_ICONS[state.lastCpuHand]);
  youHandName.textContent = HAND_LABELS[state.lastUserHand];
  cpuHandName.textContent = HAND_LABELS[state.lastCpuHand];
}

function createHistoryItem(entry) {
  const item = document.createElement("li");

  const indexLabel = document.createElement("span");
  indexLabel.className = "history-index";
  indexLabel.textContent = `${entry.index}回目`;

  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("class", "history-icon");
  icon.setAttribute("viewBox", "0 0 120 120");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");
  const iconUse = document.createElementNS("http://www.w3.org/2000/svg", "use");
  iconUse.setAttribute("href", HAND_ICONS[entry.userHand]);
  icon.append(iconUse);

  const text = document.createElement("span");
  text.className = "history-text";
  text.textContent = `あなた ${HAND_LABELS[entry.userHand]} / CPU ${HAND_LABELS[entry.cpuHand]}`;

  const badge = document.createElement("span");
  badge.className = `history-badge ${RESULT_MODIFIERS[entry.result]}`;
  badge.textContent = RESULT_LABELS[entry.result];

  item.append(indexLabel, icon, text, badge);
  return item;
}

function renderHistory() {
  const fragment = document.createDocumentFragment();
  for (let index = state.history.length - 1; index >= 0; index -= 1) {
    fragment.append(createHistoryItem(state.history[index]));
  }
  historyList.replaceChildren(fragment);
  historyEmpty.hidden = state.history.length !== 0;
}

function render() {
  if (state.lastResult === null) {
    roundResult.textContent = "まだ対戦していません";
  } else {
    roundResult.textContent = `あなた：${HAND_LABELS[state.lastUserHand]}、コンピュータ：${HAND_LABELS[state.lastCpuHand]}、結果：${resultText(state.lastResult)}`;
  }

  renderRoundBoard();
  totalCount.textContent = String(state.total);
  winCount.textContent = String(state.wins);
  lossCount.textContent = String(state.losses);
  drawCount.textContent = String(state.draws);
  winRate.textContent = calculateWinRate(state.wins, state.total);
  renderHistory();
}

function playRound(userHand) {
  const computerHand = pickComputerHand();
  const result = judge(userHand, computerHand);

  state.total += 1;
  if (result === "win") state.wins += 1;
  if (result === "lose") state.losses += 1;
  if (result === "draw") state.draws += 1;
  state.lastUserHand = userHand;
  state.lastCpuHand = computerHand;
  state.lastResult = result;
  state.history.push({
    index: state.total,
    userHand,
    cpuHand: computerHand,
    result
  });

  render();
}

for (const button of handButtons) {
  button.addEventListener("click", () => playRound(button.dataset.hand));
}

render();
