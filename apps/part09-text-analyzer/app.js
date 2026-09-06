"use strict";

const CHARACTER_LIMIT = 100000;
const SEGMENTER_SUPPORTED = typeof Intl.Segmenter === "function";
const STOP_WORDS = new Set([
  "の", "は", "に", "が", "を", "と", "て", "で", "も", "へ", "や",
  "から", "まで", "より",
  "です", "ます",
  "た", "だ", "である",
  "いる", "ある", "する", "した", "して",
  "ない", "な",
  "こと", "もの",
  "これ", "それ", "あれ",
  "って", "か", "っ", "い", "さん", "れ", "し"
]);

const PATTERNS = {
  whitespace: /\s/u,
  number: /\p{Nd}/u,
  latin: /\p{Script=Latin}/u,
  hiragana: /\p{Script=Hiragana}/u,
  japanese: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}\u30FC\u3005]/u,
  emoji: /\p{Extended_Pictographic}|\p{Regional_Indicator}/u,
  symbol: /[\p{P}\p{S}]/u
};

let composing = false;
let analysisTimer = null;

const input = document.getElementById("text-input");
const totalCharacters = document.getElementById("total-characters");
const nonWhitespaceCharacters = document.getElementById("non-whitespace-characters");
const wordCount = document.getElementById("word-count");
const lineCount = document.getElementById("line-count");
const paragraphCount = document.getElementById("paragraph-count");
const characterTypes = document.getElementById("character-types");
const characterTypesUnsupported = document.getElementById("character-types-unsupported");
const typeElements = {
  whitespace: document.getElementById("type-whitespace"),
  number: document.getElementById("type-number"),
  latin: document.getElementById("type-latin"),
  japanese: document.getElementById("type-japanese"),
  symbol: document.getElementById("type-symbol"),
  other: document.getElementById("type-other")
};
const typeTotal = document.getElementById("type-total");
const ranking = document.getElementById("ranking");
const rankingMessage = document.getElementById("ranking-message");
const rankingNote = document.getElementById("ranking-note");
const messageArea = document.getElementById("message-area");

rankingNote.textContent = "※簡易的な頻出語分析です。助詞・助動詞などの一部を除外しています。";

function normalizeNewlines(text) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function countLines(normalizedText) {
  if (normalizedText === "") return 0;
  let count = 1;
  for (const character of normalizedText) {
    if (character === "\n") count += 1;
  }
  return count;
}

function countParagraphs(normalizedText) {
  if (normalizedText === "") return 0;
  let count = 0;
  let insideParagraph = false;
  for (const line of normalizedText.split("\n")) {
    if (/^\s*$/u.test(line)) {
      insideParagraph = false;
    } else if (!insideParagraph) {
      count += 1;
      insideParagraph = true;
    }
  }
  return count;
}

function firstCodePoint(grapheme) {
  return String.fromCodePoint(grapheme.codePointAt(0));
}

function classifyGrapheme(grapheme) {
  const first = firstCodePoint(grapheme);
  if (PATTERNS.whitespace.test(first)) return "whitespace";
  if (PATTERNS.number.test(first)) return "number";
  if (PATTERNS.latin.test(first)) return "latin";
  if (PATTERNS.japanese.test(first)) return "japanese";
  if (PATTERNS.emoji.test(first)) return "other";
  if (PATTERNS.symbol.test(first)) return "symbol";
  return "other";
}

function isSingleHiraganaGrapheme(text, graphemeSegmenter) {
  const graphemes = graphemeSegmenter.segment(text)[Symbol.iterator]();
  const first = graphemes.next();
  if (first.done || !graphemes.next().done) return false;
  return PATTERNS.hiragana.test(firstCodePoint(first.value.segment));
}

function collectWords(text, wordSegmenter, graphemeSegmenter) {
  const frequencies = new Map();
  let count = 0;

  for (const item of wordSegmenter.segment(text)) {
    if (item.isWordLike !== true) continue;

    const firstPosition = count;
    count += 1;

    const display = item.segment;
    const key = display.normalize("NFKC").toLowerCase();
    if (STOP_WORDS.has(key)) continue;
    if (isSingleHiraganaGrapheme(key, graphemeSegmenter)) continue;

    const existing = frequencies.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      frequencies.set(key, { display, count: 1, firstPosition });
    }
  }

  const ranked = Array.from(frequencies.values())
    .sort((first, second) => second.count - first.count || first.firstPosition - second.firstPosition)
    .slice(0, 10);
  return { count, ranked };
}

function setText(element, value) {
  element.textContent = String(value);
}

function renderRanking(items) {
  ranking.replaceChildren();
  for (const item of items) {
    const listItem = document.createElement("li");
    const word = document.createElement("span");
    word.className = "ranking-word";
    word.textContent = item.display;
    const count = document.createElement("span");
    count.className = "ranking-count";
    count.textContent = `${item.count}回`;
    listItem.append(word, count);
    ranking.append(listItem);
  }
  rankingMessage.hidden = items.length !== 0;
  rankingMessage.textContent = items.length === 0 ? "単語がありません" : "";
}

function clearMessage() {
  messageArea.replaceChildren();
}

function showMessage(text, supportNotice = false) {
  const message = document.createElement("p");
  message.className = supportNotice ? "message-box support-message" : "message-box";
  message.textContent = text;
  messageArea.replaceChildren(message);
}

function renderEmptyResults() {
  setText(totalCharacters, "");
  setText(nonWhitespaceCharacters, "");
  setText(wordCount, "");
  setText(lineCount, "");
  setText(paragraphCount, "");
  for (const element of Object.values(typeElements)) setText(element, "");
  setText(typeTotal, "");
  characterTypes.hidden = false;
  characterTypesUnsupported.hidden = true;
  ranking.replaceChildren();
  rankingMessage.hidden = true;
  rankingMessage.textContent = "";
}

function renderZeroResults() {
  setText(totalCharacters, 0);
  setText(nonWhitespaceCharacters, 0);
  setText(wordCount, 0);
  setText(lineCount, 0);
  setText(paragraphCount, 0);
  for (const element of Object.values(typeElements)) setText(element, 0);
  setText(typeTotal, 0);
  characterTypes.hidden = false;
  characterTypesUnsupported.hidden = true;
  renderRanking([]);
}

function renderUnsupported(normalizedText) {
  const unsupported = "対応していません";
  setText(totalCharacters, unsupported);
  setText(nonWhitespaceCharacters, unsupported);
  setText(wordCount, unsupported);
  setText(lineCount, countLines(normalizedText));
  setText(paragraphCount, countParagraphs(normalizedText));
  characterTypes.hidden = true;
  characterTypesUnsupported.hidden = false;
  characterTypesUnsupported.textContent = unsupported;
  ranking.replaceChildren();
  rankingMessage.hidden = false;
  rankingMessage.textContent = unsupported;
  showMessage("このブラウザは文字単位の解析に対応していません。行数と段落数のみ表示します", true);
}

function analyzeText() {
  if (composing) return;
  const source = input.value;
  const normalizedText = normalizeNewlines(source);

  if (!SEGMENTER_SUPPORTED) {
    renderUnsupported(normalizedText);
    return;
  }

  clearMessage();
  if (source === "") {
    renderZeroResults();
    return;
  }

  const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const counts = { whitespace: 0, number: 0, latin: 0, japanese: 0, symbol: 0, other: 0 };
  let total = 0;

  for (const item of graphemeSegmenter.segment(normalizedText)) {
    total += 1;
    if (total > CHARACTER_LIMIT) {
      renderEmptyResults();
      showMessage("文章が長すぎます（10万文字まで）");
      return;
    }
    counts[classifyGrapheme(item.segment)] += 1;
  }

  const wordSegmenter = new Intl.Segmenter("ja", { granularity: "word" });
  const words = collectWords(normalizedText, wordSegmenter, graphemeSegmenter);
  const nonWhitespace = total - counts.whitespace;

  setText(totalCharacters, total);
  setText(nonWhitespaceCharacters, nonWhitespace);
  setText(wordCount, words.count);
  setText(lineCount, countLines(normalizedText));
  setText(paragraphCount, countParagraphs(normalizedText));
  for (const [type, element] of Object.entries(typeElements)) setText(element, counts[type]);
  setText(typeTotal, Object.values(counts).reduce((sum, value) => sum + value, 0));
  characterTypes.hidden = false;
  characterTypesUnsupported.hidden = true;
  renderRanking(words.ranked);
}

function scheduleAnalysis() {
  if (analysisTimer !== null) clearTimeout(analysisTimer);
  analysisTimer = setTimeout(() => {
    analysisTimer = null;
    analyzeText();
  }, 250);
}

input.addEventListener("compositionstart", () => {
  composing = true;
  if (analysisTimer !== null) clearTimeout(analysisTimer);
  analysisTimer = null;
});

input.addEventListener("compositionend", () => {
  composing = false;
  scheduleAnalysis();
});

input.addEventListener("input", (event) => {
  if (composing || event.isComposing) return;
  scheduleAnalysis();
});

analyzeText();
