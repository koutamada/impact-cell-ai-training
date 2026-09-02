"use strict";

const STORAGE_KEY = "part03-memo.notes";
const ui = Object.fromEntries([
  "export", "import", "import-button", "error", "storage-error", "new-note", "search", "sort", "mode",
  "workspace", "list-heading", "list-empty", "note-list", "back", "editor-empty",
  "note-detail", "editor-tabs", "edit-tab", "preview-tab", "save-status", "edit-view",
  "preview-view", "trash-view", "trash-title", "trash-tags", "trash-body",
  "title", "tags", "body", "delete", "restore", "purge"
].map((id) => [id, document.getElementById(id)]));

let notes = [];
let selectedId = null;
let mode = "normal";
let query = "";
let sort = "updated-desc";
let editorTab = "edit";
let saveState = "saved";
let dirty = false;
let saveTimer = null;
let composingSearch = false;
let importing = false;
// 入力中のソート移動を避けるため、一覧のID順は保存確定時に更新する。
let orderedIds = [];

function showError(message) {
  ui.error.textContent = message;
  ui.error.hidden = !message;
}

function showStorageError(message) {
  ui["storage-error"].textContent = message;
  ui["storage-error"].hidden = !message;
}

function currentNote() {
  return notes.find((note) => note.id === selectedId) || null;
}

function normalizeTags(value) {
  return [...new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean))];
}

// 読み込みとインポートは候補全体を検証してから採用する。補正は行わない。
function validateData(data) {
  const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  if (!object(data)) throw new Error("ファイルの内容が正しくありません");
  if (data.version !== 1) throw new Error("対応していないファイル形式です");
  if (!Array.isArray(data.notes)) throw new Error("ファイルの内容が正しくありません");
  const ids = new Set();
  return data.notes.map((note) => {
    if (!object(note) || typeof note.id !== "string" || note.id === "" || ids.has(note.id)
      || typeof note.title !== "string" || typeof note.body !== "string"
      || !Array.isArray(note.tags)
      || !note.tags.every((tag) => typeof tag === "string" && tag !== "" && tag === tag.trim())
      || new Set(note.tags).size !== note.tags.length
      || typeof note.pinned !== "boolean" || typeof note.trashed !== "boolean"
      || typeof note.createdAt !== "number" || !Number.isFinite(note.createdAt)
      || typeof note.updatedAt !== "number" || !Number.isFinite(note.updatedAt)) {
      throw new Error("ファイルの内容が正しくありません");
    }
    ids.add(note.id);
    // 未知のプロパティをコピーしない。IDもDOM属性には埋め込まない。
    return {
      id: note.id, title: note.title, body: note.body, tags: [...note.tags],
      pinned: note.pinned, trashed: note.trashed,
      createdAt: note.createdAt, updatedAt: note.updatedAt
    };
  });
}

function loadNotes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) notes = validateData(JSON.parse(raw));
  } catch {
    notes = [];
    showError("保存データを読み込めませんでした");
  }
}

function renderSaveState() {
  ui["save-status"].textContent = {
    pending: "保存中…", saved: "保存しました", failed: "保存できませんでした"
  }[saveState];
}

function saveNotes() {
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = null;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, notes }));
    dirty = false;
    saveState = "saved";
    showStorageError("");
  } catch {
    dirty = true;
    saveState = "failed";
    showStorageError("保存できませんでした。現在の変更は保存されていません。");
  }
  renderSaveState();
  refreshOrder();
  renderList();
}

function flushSave() {
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = null;
  if (dirty) saveNotes();
}

function scheduleSave() {
  dirty = true;
  saveState = "pending";
  renderSaveState();
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveNotes, 500);
}

function compareNotes(a, b) {
  if (mode === "normal" && a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  let result = 0;
  if (sort === "updated-desc") result = b.updatedAt - a.updatedAt;
  if (sort === "updated-asc") result = a.updatedAt - b.updatedAt;
  if (sort === "created-desc") result = b.createdAt - a.createdAt;
  if (sort === "title-asc") {
    if ((a.title === "") !== (b.title === "")) result = a.title === "" ? 1 : -1;
    else result = a.title.localeCompare(b.title, "ja");
  }
  return result || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function refreshOrder() {
  orderedIds = notes.filter((note) => note.trashed === (mode === "trash"))
    .sort(compareNotes).map((note) => note.id);
}

function renderTags(container, tags) {
  container.replaceChildren();
  for (const tag of tags) {
    const chip = document.createElement("span");
    chip.className = "tag";
    chip.textContent = tag;
    container.append(chip);
  }
}

function renderList() {
  const needle = query.trim().toLowerCase();
  const byId = new Map(notes.map((note) => [note.id, note]));
  const visible = orderedIds.map((id) => byId.get(id)).filter((note) => note
    && (mode === "trash" || [note.title, note.body, ...note.tags].join("\n").toLowerCase().includes(needle)));
  // 一覧のボタンを再生成するときは、キーボード操作中のフォーカスを復元する。
  const focusedIndex = [...ui["note-list"].querySelectorAll("button")].indexOf(document.activeElement);
  const focusedButton = document.activeElement;
  const focusedId = focusedButton?.noteId;
  const focusedKind = focusedButton?.noteAction;
  ui["note-list"].replaceChildren();
  let focusTarget = null;
  for (const note of visible) {
    const row = document.createElement("li");
    row.className = note.id === selectedId ? "note-row selected" : "note-row";
    const select = document.createElement("button");
    select.type = "button";
    select.className = "note-select";
    select.noteId = note.id;
    select.noteAction = "select";
    if (note.id === selectedId) {
      select.setAttribute("aria-current", "true");
      const marker = document.createElement("span");
      marker.className = "selection-marker";
      marker.textContent = "選択中";
      select.append(marker);
    }
    const title = document.createElement("span");
    title.className = "note-title";
    title.textContent = note.title === "" ? "無題" : note.title;
    const excerpt = document.createElement("span");
    excerpt.className = "excerpt";
    excerpt.textContent = note.body.slice(0, 160);
    const tags = document.createElement("span");
    tags.className = "tags";
    renderTags(tags, note.tags);
    select.append(title, excerpt, tags);
    select.addEventListener("click", () => selectNote(note.id));
    row.append(select);
    if (focusedId === note.id && focusedKind === "select") focusTarget = select;
    if (mode === "normal") {
      const pin = document.createElement("button");
      pin.type = "button";
      pin.className = "pin";
      pin.noteId = note.id;
      pin.noteAction = "pin";
      pin.textContent = note.pinned ? "📌" : "○";
      pin.setAttribute("aria-label", note.pinned ? "ピン留めを解除" : "ピン留めする");
      pin.setAttribute("aria-pressed", String(note.pinned));
      pin.addEventListener("click", () => {
        flushSave();
        if (note.trashed || mode !== "normal") return;
        note.pinned = !note.pinned;
        saveNotes();
      });
      row.append(pin);
      if (focusedId === note.id && focusedKind === "pin") focusTarget = pin;
    }
    ui["note-list"].append(row);
  }
  ui["list-empty"].hidden = visible.length !== 0;
  ui["list-empty"].textContent = mode === "trash" ? "ゴミ箱は空です"
    : needle ? "該当するメモがありません" : "メモがありません";
  if (focusedIndex >= 0) (focusTarget || ui["mode"]).focus();
}

function renderEditor() {
  const note = currentNote();
  if (!note) selectedId = null;
  ui["editor-empty"].hidden = Boolean(note);
  ui["note-detail"].hidden = !note;
  if (!note) return;
  const trash = mode === "trash";
  ui["editor-tabs"].hidden = trash;
  ui["edit-view"].hidden = trash || editorTab !== "edit";
  ui["preview-view"].hidden = trash || editorTab !== "preview";
  ui["trash-view"].hidden = !trash;
  ui.delete.hidden = trash;
  ui.restore.hidden = !trash;
  ui.purge.hidden = !trash;
  ui["edit-tab"].setAttribute("aria-pressed", String(editorTab === "edit"));
  ui["preview-tab"].setAttribute("aria-pressed", String(editorTab === "preview"));
  if (trash) {
    ui["trash-title"].textContent = note.title === "" ? "無題" : note.title;
    renderTags(ui["trash-tags"], note.tags);
    ui["trash-body"].textContent = note.body;
  } else if (editorTab === "preview") {
    ui["preview-view"].innerHTML = renderMarkdown(note.body);
  }
  renderSaveState();
}

function fillEditor(note) {
  ui.title.value = note.title;
  ui.body.value = note.body;
  ui.tags.value = note.tags.join(", ");
}

function renderMode() {
  const trash = mode === "trash";
  ui["list-heading"].textContent = trash ? "ゴミ箱" : "メモ一覧";
  ui.mode.textContent = trash ? "メモ一覧へ戻る" : "ゴミ箱";
  ui.mode.setAttribute("aria-pressed", String(trash));
  ui.search.disabled = trash;
  ui["new-note"].disabled = trash;
  refreshOrder();
  renderList();
  renderEditor();
}

function selectNote(id) {
  flushSave();
  const note = notes.find((item) => item.id === id);
  if (!note || note.trashed !== (mode === "trash")) return;
  selectedId = id;
  editorTab = "edit";
  fillEditor(note);
  ui.workspace.dataset.screen = "editor";
  renderList();
  renderEditor();
  if (mode === "normal") ui.title.focus();
  else ui.restore.focus();
}

function createNote() {
  if (mode !== "normal") return;
  flushSave();
  let id;
  do {
    id = typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2);
  } while (notes.some((note) => note.id === id));
  const now = Date.now();
  const note = { id, title: "", body: "", tags: [], pinned: false, trashed: false, createdAt: now, updatedAt: now };
  notes.push(note);
  // 新規メモを一覧で確認できるよう、作成時には検索を解除する。
  query = "";
  ui.search.value = "";
  selectedId = id;
  editorTab = "edit";
  fillEditor(note);
  ui.workspace.dataset.screen = "editor";
  saveNotes();
  renderEditor();
  ui.title.focus();
}

function editNote(field) {
  const note = currentNote();
  if (!note || note.trashed || mode !== "normal") return;
  const value = field === "tags" ? normalizeTags(ui.tags.value) : ui[field].value;
  const unchanged = field === "tags" ? JSON.stringify(note.tags) === JSON.stringify(value) : note[field] === value;
  if (unchanged) return;
  note[field] = value;
  note.updatedAt = Date.now();
  scheduleSave();
  // 一覧の内容も保存確定時に反映。入力欄の再生成はしない。
}

function removeOrRestore(action) {
  const note = currentNote();
  if (!note) return;
  if (action === "delete" && (mode !== "normal" || note.trashed)) return;
  if (action !== "delete" && (mode !== "trash" || !note.trashed)) return;
  if (action === "delete" && !window.confirm("このメモを削除してゴミ箱へ移動しますか？")) return;
  if (action === "purge" && !window.confirm("完全に削除しますか？この操作は取り消せません。")) return;
  flushSave();
  if (action === "delete") note.trashed = true;
  if (action === "restore") { note.trashed = false; note.updatedAt = Date.now(); }
  if (action === "purge") notes = notes.filter((item) => item.id !== note.id);
  selectedId = null;
  ui.workspace.dataset.screen = "list";
  saveNotes();
  renderEditor();
  ui.mode.focus();
}

// Markdown: 生入力を最初にエスケープし、以降は固定タグだけを生成する。
function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function inlineHtml(escapedLine) {
  // オブジェクトのトークンは解析済み領域。文字列の置換用マーカーは使わない。
  const tokens = [];
  for (let i = 0; i < escapedLine.length;) {
    if (escapedLine[i] === "`") {
      const end = escapedLine.indexOf("`", i + 1);
      if (end !== -1) {
        tokens.push({ html: `<code>${escapedLine.slice(i + 1, end)}</code>` });
        i = end + 1;
        continue;
      }
    }
    tokens.push(escapedLine[i++]);
  }
  const serialize = (items) => items.map((item) => typeof item === "string" ? item : item.html).join("");
  function emphasis(items, double) {
    const output = [];
    const width = double ? 2 : 1;
    for (let i = 0; i < items.length;) {
      const match = (at) => items[at] === "*" && (!double || items[at + 1] === "*");
      if (!match(i)) { output.push(items[i++]); continue; }
      let end = i + width;
      while (end < items.length && !match(end)) end++;
      if (end < items.length && end > i + width) {
        const content = items.slice(i + width, end);
        const tag = double ? "strong" : "em";
        output.push({ html: `<${tag}>${serialize(double ? emphasis(content, false) : content)}</${tag}>` });
        i = end + width;
      } else {
        // 閉じていない ** を斜体の開始・終了として再解釈しない。
        output.push({ html: "*".repeat(width) });
        i += width;
      }
    }
    return output;
  }
  return serialize(emphasis(emphasis(tokens, true), false));
}

function renderMarkdown(body) {
  const escaped = escapeHtml(body);
  const lines = escaped.replace(/\r\n?/g, "\n").split("\n");
  const result = [];
  const kind = (line) => line === "```" ? "code" : /^(#{1,3}) /.test(line) ? "heading"
    : /^- /.test(line) ? "ul" : /^\d+\. /.test(line) ? "ol" : line.trim() === "" ? "blank" : "paragraph";
  for (let i = 0; i < lines.length;) {
    const type = kind(lines[i]);
    if (type === "blank") { i++; continue; }
    if (type === "code") {
      const content = [];
      i++;
      while (i < lines.length && lines[i] !== "```") content.push(lines[i++]);
      if (i < lines.length) i++;
      result.push(`<pre><code>${content.join("\n")}</code></pre>`);
    } else if (type === "heading") {
      const match = /^(#{1,3}) (.*)$/.exec(lines[i++]);
      result.push(`<h${match[1].length}>${inlineHtml(match[2])}</h${match[1].length}>`);
    } else if (type === "ul" || type === "ol") {
      const items = [];
      while (i < lines.length && kind(lines[i]) === type) {
        const content = lines[i++].replace(type === "ul" ? /^- / : /^\d+\. /, "");
        items.push(`<li>${inlineHtml(content)}</li>`);
      }
      result.push(`<${type}>${items.join("")}</${type}>`);
    } else {
      const content = [];
      while (i < lines.length && kind(lines[i]) === "paragraph") content.push(inlineHtml(lines[i++]));
      result.push(`<p>${content.join("<br>")}</p>`);
    }
  }
  return result.join("\n");
}

function exportNotes() {
  flushSave();
  let url;
  let link;
  try {
    const blob = new Blob([JSON.stringify({ version: 1, notes }, null, 2)], { type: "application/json" });
    url = URL.createObjectURL(blob);
    const date = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
    link = document.createElement("a");
    link.href = url;
    link.download = `part03-memo-export-${stamp}.json`;
    document.body.append(link);
    link.click();
    showError("");
  } catch {
    showError("エクスポートできませんでした");
  } finally {
    link?.remove();
    if (url) window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

async function importNotes() {
  const file = ui.import.files[0];
  if (!file || importing) return;
  importing = true;
  ui.import.disabled = true;
  ui["import-button"].disabled = true;
  try {
    let text;
    try { text = await file.text(); }
    catch { throw new Error("ファイルを読み込めませんでした"); }
    let parsed;
    try { parsed = JSON.parse(text); }
    catch { throw new Error("ファイルを読み込めませんでした。JSON形式ではありません"); }
    const candidate = validateData(parsed);
    if (!window.confirm("現在のメモをすべて置き換えます。よろしいですか？")) return;
    // 不正・キャンセル時はここに到達しない。旧保存タイマーを置換後に残さない。
    flushSave();
    notes = candidate;
    selectedId = null;
    mode = "normal";
    query = "";
    sort = "updated-desc";
    editorTab = "edit";
    composingSearch = false;
    ui.search.value = "";
    ui.sort.value = sort;
    ui.workspace.dataset.screen = "list";
    saveNotes();
    renderMode();
    showError("");
  } catch (error) {
    showError(error.message || "ファイルの内容が正しくありません");
  } finally {
    ui.import.value = "";
    ui.import.disabled = false;
    ui["import-button"].disabled = false;
    importing = false;
  }
}

ui["new-note"].addEventListener("click", createNote);
for (const field of ["title", "body", "tags"]) ui[field].addEventListener("input", () => editNote(field));
ui.search.addEventListener("compositionstart", () => { composingSearch = true; });
function searchNotes() {
  if (composingSearch || mode !== "normal") return;
  query = ui.search.value;
  renderList();
}
ui.search.addEventListener("compositionend", () => { composingSearch = false; searchNotes(); });
ui.search.addEventListener("input", (event) => { if (!event.isComposing) searchNotes(); });
ui.sort.addEventListener("change", () => {
  flushSave();
  sort = ui.sort.value;
  refreshOrder();
  renderList();
});
ui.mode.addEventListener("click", () => {
  flushSave();
  mode = mode === "normal" ? "trash" : "normal";
  selectedId = null;
  query = "";
  composingSearch = false;
  ui.search.value = "";
  ui.workspace.dataset.screen = "list";
  renderMode();
});
ui.back.addEventListener("click", () => {
  flushSave();
  ui.workspace.dataset.screen = "list";
  const selectedButton = [...ui["note-list"].querySelectorAll("button")]
    .find((button) => button.noteId === selectedId && button.noteAction === "select");
  (selectedButton || ui.mode).focus();
});
ui["edit-tab"].addEventListener("click", () => { editorTab = "edit"; renderEditor(); });
ui["preview-tab"].addEventListener("click", () => { editorTab = "preview"; renderEditor(); });
for (const action of ["delete", "restore", "purge"]) ui[action].addEventListener("click", () => removeOrRestore(action));
ui.export.addEventListener("click", exportNotes);
ui["import-button"].addEventListener("click", () => ui.import.click());
ui.import.addEventListener("change", importNotes);
document.addEventListener("visibilitychange", () => { if (document.hidden) flushSave(); });
window.addEventListener("pagehide", flushSave);

ui.search.value = "";
ui.sort.value = sort;
loadNotes();
renderMode();
