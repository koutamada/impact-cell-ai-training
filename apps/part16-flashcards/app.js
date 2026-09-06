'use strict';

/* ==========================================================================
   Part 16 フラッシュカード学習アプリ
   仕様書: docs/part16-flashcards/part16-flashcards-spec.md
   ========================================================================== */

/* --------------------------------------------------------------------------
   定数
   -------------------------------------------------------------------------- */

var STORAGE_KEY = 'part16-flashcards';
var STORAGE_VERSION = 1;

var DELETE_LABEL_MAX = 30;

var MSG_QUESTION_REQUIRED = '問題を入力してください。';
var MSG_ANSWER_REQUIRED = '答えを入力してください。';

var MSG_CORRUPTED =
  '保存データを読み込めませんでした。空の状態で開始します。\n' +
  '新しくカードを登録すると、保存データは上書きされます。';

var MSG_SAVE_FAIL_REGISTER =
  'カードを保存できませんでした。ブラウザの保存容量やプライベートモードの設定を確認してください。' +
  '入力内容は残しています。';

var MSG_SAVE_FAIL_DELETE =
  'カードを削除できませんでした。ブラウザの保存容量やプライベートモードの設定を確認してください。';

var MSG_SAVE_FAIL_GRADE =
  '学習記録を保存できませんでした。ブラウザの保存容量やプライベートモードの設定を確認してください。' +
  '次の問題には進んでいません。';

var MSG_DELETE_CONFIRM = 'このカードを削除しますか？（正解・不正解の記録も削除されます）';

var MSG_EMPTY_STUDY = 'カードを登録してください。';
var MSG_IDLE_STUDY = '学習を始めるボタンを押してください。';

var FACE_QUESTION = 'question';
var FACE_ANSWER = 'answer';

var LABEL_FACE_QUESTION = '問題';
var LABEL_FACE_ANSWER = '答え';

var LABEL_FLIP_TO_ANSWER = '答えを見る';
var LABEL_FLIP_TO_QUESTION = '問題に戻す';

/* --------------------------------------------------------------------------
   状態
   -------------------------------------------------------------------------- */

var state = {
  // 永続（localStorage に保存する）
  cards: [],
  // 非永続（メモリのみ。リロードで初期化される）
  study: {
    active: false,
    currentCardId: null,
    face: FACE_QUESTION
  }
};

/* --------------------------------------------------------------------------
   純粋関数：ランダム出題
   -------------------------------------------------------------------------- */

/**
 * 乱数値から出題インデックスを決める。
 * 内部で Math.random() を呼ばない（決定的にテストできるようにするため）。
 * Math.round() は使用しない。
 *
 * @param {number} randomValue 0 <= randomValue < 1
 * @param {number} length      1 以上の整数
 * @param {number|null} excludedIndex 除外するインデックス。除外しない場合は null
 * @returns {number} 0 <= result < length
 */
function pickNextIndex(randomValue, length, excludedIndex) {
  if (length <= 1 || excludedIndex === null || excludedIndex === undefined) {
    return Math.floor(randomValue * length);
  }
  var i = Math.floor(randomValue * (length - 1));
  return i >= excludedIndex ? i + 1 : i;
}

/* --------------------------------------------------------------------------
   純粋関数：学習状況
   -------------------------------------------------------------------------- */

/**
 * 正解率を小数1桁固定の文字列で返す。未回答時は '0.0%'。
 */
function formatAccuracy(correct, incorrect) {
  var total = correct + incorrect;
  if (total === 0) {
    return '0.0%';
  }
  return ((correct / total) * 100).toFixed(1) + '%';
}

/**
 * cards から全体集計を導出する（保存はしない）。
 */
function summarize(cards) {
  var correct = 0;
  var incorrect = 0;
  for (var i = 0; i < cards.length; i += 1) {
    correct += cards[i].correctCount;
    incorrect += cards[i].incorrectCount;
  }
  return {
    total: correct + incorrect,
    correct: correct,
    incorrect: incorrect,
    accuracy: formatAccuracy(correct, incorrect)
  };
}

/* --------------------------------------------------------------------------
   純粋関数：ID
   -------------------------------------------------------------------------- */

/**
 * 安定した一意IDを生成する。
 * crypto.randomUUID() は secure context 限定のため、file:// では利用できない。
 * その場合は簡易フォールバックを使う（UUID互換形式は自作しない）。
 */
function createId() {
  if (typeof crypto !== 'undefined' && crypto !== null &&
      typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/* --------------------------------------------------------------------------
   純粋関数：バリデーション・正規化
   -------------------------------------------------------------------------- */

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isCountNumber(value) {
  return Number.isInteger(value) && value >= 0;
}

/**
 * 保存データ由来のカード1件が仕様どおりかを検証する。
 */
function isValidStoredCard(card) {
  if (typeof card !== 'object' || card === null || Array.isArray(card)) {
    return false;
  }
  if (typeof card.id !== 'string' || card.id.length === 0) {
    return false;
  }
  if (!isNonEmptyString(card.question)) {
    return false;
  }
  if (!isNonEmptyString(card.answer)) {
    return false;
  }
  if (!isCountNumber(card.correctCount)) {
    return false;
  }
  if (!isCountNumber(card.incorrectCount)) {
    return false;
  }
  if (!Number.isFinite(card.createdAt)) {
    return false;
  }
  return true;
}

/**
 * 仕様上のフィールドのみを持つ新しいカードオブジェクトを作る。
 * 保存データの未知フィールドはここで破棄される。
 */
function normalizeStoredCard(card) {
  return {
    id: card.id,
    question: card.question,
    answer: card.answer,
    correctCount: card.correctCount,
    incorrectCount: card.incorrectCount,
    createdAt: card.createdAt
  };
}

/**
 * localStorage から取り出した生文字列を解釈する。
 * @returns {{status: 'empty'|'ok'|'corrupted', cards: Array}}
 */
function parseStoredData(rawText) {
  if (rawText === null || rawText === undefined) {
    return { status: 'empty', cards: [] };
  }

  var root;
  try {
    root = JSON.parse(rawText);
  } catch (error) {
    return { status: 'corrupted', cards: [] };
  }

  if (typeof root !== 'object' || root === null || Array.isArray(root)) {
    return { status: 'corrupted', cards: [] };
  }
  if (root.version !== STORAGE_VERSION) {
    return { status: 'corrupted', cards: [] };
  }
  if (!Array.isArray(root.cards)) {
    return { status: 'corrupted', cards: [] };
  }

  var seenIds = Object.create(null);
  var cards = [];
  for (var i = 0; i < root.cards.length; i += 1) {
    var raw = root.cards[i];
    if (!isValidStoredCard(raw)) {
      return { status: 'corrupted', cards: [] };
    }
    if (seenIds[raw.id] === true) {
      return { status: 'corrupted', cards: [] };
    }
    seenIds[raw.id] = true;
    cards.push(normalizeStoredCard(raw));
  }

  return { status: 'ok', cards: cards };
}

/**
 * 削除ボタンの aria-label 用に問題文を切り詰める。
 */
function truncateForLabel(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength) + '…';
}

/* --------------------------------------------------------------------------
   localStorage 入出力
   -------------------------------------------------------------------------- */

function readStorage() {
  var rawText;
  try {
    rawText = localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    return { status: 'corrupted', cards: [] };
  }
  return parseStoredData(rawText);
}

/**
 * 保存を試みる。成功したら true、失敗したら false を返す。
 * 破損データは削除も上書きもしない（保存が成功したときだけ上書きされる）。
 */
function writeStorage(cards) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: STORAGE_VERSION, cards: cards })
    );
    return true;
  } catch (error) {
    return false;
  }
}

/* --------------------------------------------------------------------------
   状態確定（cards を変更する唯一の経路）
   -------------------------------------------------------------------------- */

/**
 * 保存に成功したときだけ state.cards を差し替える。
 * 失敗した場合は nextCards を破棄し、state.cards は変更しない。
 */
function commit(nextCards) {
  if (!writeStorage(nextCards)) {
    return false;
  }
  state.cards = nextCards;
  return true;
}

/* --------------------------------------------------------------------------
   カード検索
   -------------------------------------------------------------------------- */

function findCardIndexById(id) {
  for (var i = 0; i < state.cards.length; i += 1) {
    if (state.cards[i].id === id) {
      return i;
    }
  }
  return -1;
}

function findCardById(id) {
  var index = findCardIndexById(id);
  return index === -1 ? null : state.cards[index];
}

/**
 * 連続重複回避で除外するインデックスを、抽選の直前に id から解決する。
 * インデックスはキャッシュしない。
 */
function resolveExcludedIndex() {
  if (state.study.currentCardId === null) {
    return null;
  }
  if (state.cards.length <= 1) {
    return null;
  }
  var index = findCardIndexById(state.study.currentCardId);
  if (index === -1) {
    return null;
  }
  return index;
}

/* --------------------------------------------------------------------------
   DOM参照
   -------------------------------------------------------------------------- */

var dom = {};

function cacheDom() {
  dom.notice = document.getElementById('notice');
  dom.noticeMessage = document.getElementById('notice-message');
  dom.noticeClose = document.getElementById('notice-close');

  dom.questionInput = document.getElementById('question-input');
  dom.questionError = document.getElementById('question-error');
  dom.answerInput = document.getElementById('answer-input');
  dom.answerError = document.getElementById('answer-error');
  dom.registerButton = document.getElementById('register-button');

  dom.startButton = document.getElementById('start-button');
  dom.studyFace = document.getElementById('study-face');
  dom.studyBody = document.getElementById('study-body');
  dom.flipButton = document.getElementById('flip-button');
  dom.correctButton = document.getElementById('correct-button');
  dom.incorrectButton = document.getElementById('incorrect-button');

  dom.statTotal = document.getElementById('stat-total');
  dom.statCorrect = document.getElementById('stat-correct');
  dom.statIncorrect = document.getElementById('stat-incorrect');
  dom.statAccuracy = document.getElementById('stat-accuracy');

  dom.listCount = document.getElementById('list-count');
  dom.listEmpty = document.getElementById('list-empty');
  dom.cardList = document.getElementById('card-list');

  dom.liveRegion = document.getElementById('live-region');
}

/* --------------------------------------------------------------------------
   aria-live 領域（アプリ内で唯一の live region）
   この関数は学習カードの内容が切り替わった5箇所からのみ呼ぶ。
   一覧・集計の再描画処理からは呼ばない（1操作＝1通知を守るため）。
   -------------------------------------------------------------------------- */

function announceFace(card, face) {
  var prefix = face === FACE_ANSWER ? LABEL_FACE_ANSWER : LABEL_FACE_QUESTION;
  var body = face === FACE_ANSWER ? card.answer : card.question;
  dom.liveRegion.textContent = prefix + '：' + body;
}

/* --------------------------------------------------------------------------
   通知エリア（live region ではない。フォーカス移動で読み上げさせる）
   -------------------------------------------------------------------------- */

function showNotice(message) {
  dom.noticeMessage.textContent = message;
  dom.notice.hidden = false;
  dom.notice.focus();
}

function hideNotice() {
  dom.notice.hidden = true;
  dom.noticeMessage.textContent = '';
}

/* --------------------------------------------------------------------------
   入力エラー表示
   -------------------------------------------------------------------------- */

function showFieldError(inputEl, errorEl, message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
  inputEl.setAttribute('aria-invalid', 'true');
  inputEl.setAttribute('aria-describedby', errorEl.id);
}

function clearFieldError(inputEl, errorEl) {
  errorEl.textContent = '';
  errorEl.hidden = true;
  inputEl.removeAttribute('aria-invalid');
  inputEl.removeAttribute('aria-describedby');
}

function clearAllFieldErrors() {
  clearFieldError(dom.questionInput, dom.questionError);
  clearFieldError(dom.answerInput, dom.answerError);
}

/* --------------------------------------------------------------------------
   描画：カード一覧
   -------------------------------------------------------------------------- */

function createCardListItem(card) {
  var item = document.createElement('li');
  item.className = 'card-item';

  var main = document.createElement('div');
  main.className = 'card-item__main';

  var questionLabel = document.createElement('p');
  questionLabel.className = 'card-item__label';
  questionLabel.textContent = LABEL_FACE_QUESTION;

  var questionText = document.createElement('p');
  questionText.className = 'card-item__text';
  questionText.textContent = card.question;

  var answerLabel = document.createElement('p');
  answerLabel.className = 'card-item__label';
  answerLabel.textContent = LABEL_FACE_ANSWER;

  var answerText = document.createElement('p');
  answerText.className = 'card-item__text';
  answerText.textContent = card.answer;

  var stats = document.createElement('p');
  stats.className = 'card-item__stats';

  var correctStat = document.createElement('span');
  correctStat.className = 'card-item__stat';
  correctStat.textContent = '正解 ' + card.correctCount;

  var incorrectStat = document.createElement('span');
  incorrectStat.className = 'card-item__stat';
  incorrectStat.textContent = '不正解 ' + card.incorrectCount;

  stats.appendChild(correctStat);
  stats.appendChild(incorrectStat);

  main.appendChild(questionLabel);
  main.appendChild(questionText);
  main.appendChild(answerLabel);
  main.appendChild(answerText);
  main.appendChild(stats);

  var deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'btn btn--danger card-item__delete';
  deleteButton.textContent = '削除';
  deleteButton.setAttribute(
    'aria-label',
    '「' + truncateForLabel(card.question, DELETE_LABEL_MAX) + '」を削除'
  );
  deleteButton.addEventListener('click', function () {
    handleDelete(card.id);
  });

  item.appendChild(main);
  item.appendChild(deleteButton);
  return item;
}

function renderList() {
  dom.listCount.textContent = String(state.cards.length);

  while (dom.cardList.firstChild !== null) {
    dom.cardList.removeChild(dom.cardList.firstChild);
  }

  if (state.cards.length === 0) {
    dom.listEmpty.hidden = false;
    return;
  }
  dom.listEmpty.hidden = true;

  // 登録順の新しいものを上に表示する（createdAt はソートに使わない）。
  var ordered = state.cards.slice().reverse();
  for (var i = 0; i < ordered.length; i += 1) {
    dom.cardList.appendChild(createCardListItem(ordered[i]));
  }
}

/* --------------------------------------------------------------------------
   描画：学習状況（全体集計）
   -------------------------------------------------------------------------- */

function renderStats() {
  var summary = summarize(state.cards);
  dom.statTotal.textContent = String(summary.total);
  dom.statCorrect.textContent = String(summary.correct);
  dom.statIncorrect.textContent = String(summary.incorrect);
  dom.statAccuracy.textContent = summary.accuracy;
}

/* --------------------------------------------------------------------------
   描画：学習エリア
   -------------------------------------------------------------------------- */

function renderStudy() {
  var hasCards = state.cards.length > 0;
  var active = state.study.active;
  var card = active ? findCardById(state.study.currentCardId) : null;

  if (active && card !== null) {
    var isAnswer = state.study.face === FACE_ANSWER;
    dom.studyFace.hidden = false;
    dom.studyFace.textContent = isAnswer ? LABEL_FACE_ANSWER : LABEL_FACE_QUESTION;
    dom.studyBody.textContent = isAnswer ? card.answer : card.question;
    dom.flipButton.textContent = isAnswer ? LABEL_FLIP_TO_QUESTION : LABEL_FLIP_TO_ANSWER;
    dom.flipButton.disabled = false;
    dom.correctButton.disabled = !isAnswer;
    dom.incorrectButton.disabled = !isAnswer;
  } else {
    dom.studyFace.hidden = true;
    dom.studyFace.textContent = '';
    dom.studyBody.textContent = hasCards ? MSG_IDLE_STUDY : MSG_EMPTY_STUDY;
    dom.flipButton.textContent = LABEL_FLIP_TO_ANSWER;
    dom.flipButton.disabled = true;
    dom.correctButton.disabled = true;
    dom.incorrectButton.disabled = true;
  }

  dom.startButton.disabled = !hasCards || active;
}

function renderAll() {
  renderList();
  renderStats();
  renderStudy();
}

/* --------------------------------------------------------------------------
   学習状態の終了（カードが0件になった場合）
   -------------------------------------------------------------------------- */

function endStudy() {
  state.study.active = false;
  state.study.currentCardId = null;
  state.study.face = FACE_QUESTION;
}

/* --------------------------------------------------------------------------
   操作：カード登録
   -------------------------------------------------------------------------- */

function handleRegister() {
  var questionRaw = dom.questionInput.value;
  var answerRaw = dom.answerInput.value;
  var question = questionRaw.trim();
  var answer = answerRaw.trim();

  clearAllFieldErrors();

  var firstInvalid = null;
  if (question.length === 0) {
    showFieldError(dom.questionInput, dom.questionError, MSG_QUESTION_REQUIRED);
    firstInvalid = dom.questionInput;
  }
  if (answer.length === 0) {
    showFieldError(dom.answerInput, dom.answerError, MSG_ANSWER_REQUIRED);
    if (firstInvalid === null) {
      firstInvalid = dom.answerInput;
    }
  }
  if (firstInvalid !== null) {
    firstInvalid.focus();
    return;
  }

  var newCard = {
    id: createId(),
    question: question,
    answer: answer,
    correctCount: 0,
    incorrectCount: 0,
    createdAt: Date.now()
  };

  var nextCards = state.cards.slice();
  nextCards.push(newCard);

  if (!commit(nextCards)) {
    // 入力値は維持する。一覧も変化させない。
    showNotice(MSG_SAVE_FAIL_REGISTER);
    return;
  }

  dom.questionInput.value = '';
  dom.answerInput.value = '';

  renderList();
  renderStats();
  // 学習中でも出題中カード・面は変更しない。
  // 開始ボタンの活性状態のみ変わり得るため renderStudy を呼ぶ。
  renderStudy();
}

/* --------------------------------------------------------------------------
   操作：カード削除
   -------------------------------------------------------------------------- */

function handleDelete(id) {
  if (findCardById(id) === null) {
    return;
  }
  if (!window.confirm(MSG_DELETE_CONFIRM)) {
    return;
  }

  var nextCards = [];
  for (var i = 0; i < state.cards.length; i += 1) {
    if (state.cards[i].id !== id) {
      nextCards.push(state.cards[i]);
    }
  }

  if (!commit(nextCards)) {
    // 一覧からカードを消さない。学習状態も変更しない。
    showNotice(MSG_SAVE_FAIL_DELETE);
    return;
  }

  var wasCurrent = state.study.active && state.study.currentCardId === id;

  renderList();
  renderStats();

  if (!wasCurrent) {
    renderStudy();
    return;
  }

  if (state.cards.length === 0) {
    endStudy();
    renderStudy();
    // 出題する問題が存在しないため live 領域は更新しない。
    return;
  }

  // 直前カードは削除済みで候補に存在しないため、除外はしない。
  var nextIndex = pickNextIndex(Math.random(), state.cards.length, null);
  var nextCard = state.cards[nextIndex];
  state.study.currentCardId = nextCard.id;
  state.study.face = FACE_QUESTION;
  renderStudy();
  announceFace(nextCard, FACE_QUESTION);
}

/* --------------------------------------------------------------------------
   操作：学習開始
   -------------------------------------------------------------------------- */

function handleStart() {
  if (state.cards.length === 0 || state.study.active) {
    return;
  }

  var index = pickNextIndex(Math.random(), state.cards.length, null);
  var card = state.cards[index];

  state.study.active = true;
  state.study.currentCardId = card.id;
  state.study.face = FACE_QUESTION;

  renderStudy();
  announceFace(card, FACE_QUESTION);
}

/* --------------------------------------------------------------------------
   操作：表面／裏面の切替
   -------------------------------------------------------------------------- */

function handleFlip() {
  if (!state.study.active) {
    return;
  }
  var card = findCardById(state.study.currentCardId);
  if (card === null) {
    return;
  }

  state.study.face =
    state.study.face === FACE_ANSWER ? FACE_QUESTION : FACE_ANSWER;

  // cards は変化しないため保存しない。
  renderStudy();
  announceFace(card, state.study.face);
}

/* --------------------------------------------------------------------------
   操作：採点
   -------------------------------------------------------------------------- */

function handleGrade(isCorrect) {
  if (!state.study.active || state.study.face !== FACE_ANSWER) {
    return;
  }
  var currentId = state.study.currentCardId;
  if (findCardById(currentId) === null) {
    return;
  }

  var nextCards = [];
  for (var i = 0; i < state.cards.length; i += 1) {
    var card = state.cards[i];
    if (card.id !== currentId) {
      nextCards.push(card);
      continue;
    }
    nextCards.push({
      id: card.id,
      question: card.question,
      answer: card.answer,
      correctCount: isCorrect ? card.correctCount + 1 : card.correctCount,
      incorrectCount: isCorrect ? card.incorrectCount : card.incorrectCount + 1,
      createdAt: card.createdAt
    });
  }

  if (!commit(nextCards)) {
    // 記録は増えず、現在カード・面も変更しない。次の問題へ進まない。
    // live 領域も更新しない。
    showNotice(MSG_SAVE_FAIL_GRADE);
    return;
  }

  renderList();
  renderStats();

  var excludedIndex = resolveExcludedIndex();
  var nextIndex = pickNextIndex(Math.random(), state.cards.length, excludedIndex);
  var nextCard = state.cards[nextIndex];

  state.study.currentCardId = nextCard.id;
  state.study.face = FACE_QUESTION;

  renderStudy();
  announceFace(nextCard, FACE_QUESTION);
}

/* --------------------------------------------------------------------------
   イベント登録
   -------------------------------------------------------------------------- */

function bindEvents() {
  dom.registerButton.addEventListener('click', handleRegister);
  dom.startButton.addEventListener('click', handleStart);
  dom.flipButton.addEventListener('click', handleFlip);
  dom.correctButton.addEventListener('click', function () {
    handleGrade(true);
  });
  dom.incorrectButton.addEventListener('click', function () {
    handleGrade(false);
  });
  dom.noticeClose.addEventListener('click', hideNotice);
}

/* --------------------------------------------------------------------------
   初期化
   -------------------------------------------------------------------------- */

function init() {
  cacheDom();
  bindEvents();

  var loaded = readStorage();
  state.cards = loaded.cards;

  renderAll();

  if (loaded.status === 'corrupted') {
    // 破損データは読み込まない。削除も上書きもしない。
    showNotice(MSG_CORRUPTED);
  }
}

init();
