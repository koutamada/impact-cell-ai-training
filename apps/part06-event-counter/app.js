"use strict";

const STORAGE_KEY = "part06-event-counter.events";
const DAY_MILLISECONDS = 86400000;

let events = [];
let mode = "create";
let editingId = null;
let today = getTodayEpochDay();

const form = document.getElementById("event-form");
const formTitle = document.getElementById("form-title");
const nameInput = document.getElementById("event-name");
const dateInput = document.getElementById("event-date");
const formError = document.getElementById("form-error");
const submitButton = document.getElementById("submit-button");
const cancelButton = document.getElementById("cancel-button");
const listTitle = document.getElementById("list-title");
const eventList = document.getElementById("event-list");
const emptyMessage = document.getElementById("empty-message");
const notification = document.getElementById("notification");

function epochDay(year, month, day) {
  return Date.UTC(year, month - 1, day) / DAY_MILLISECONDS;
}

function getTodayEpochDay() {
  const now = new Date();
  return epochDay(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function parseDateParts(dateString) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
}

function isValidDateString(dateString) {
  if (typeof dateString !== "string") return false;
  const parts = parseDateParts(dateString);
  if (!parts) return false;
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return date.getUTCFullYear() === parts.year
    && date.getUTCMonth() + 1 === parts.month
    && date.getUTCDate() === parts.day;
}

function dateToEpochDay(dateString) {
  const parts = parseDateParts(dateString);
  return epochDay(parts.year, parts.month, parts.day);
}

function formatTargetDate(dateString) {
  const parts = parseDateParts(dateString);
  return `${parts.year}年${parts.month}月${parts.day}日`;
}

function formatDayCount(diff) {
  if (diff > 0) return `あと${diff}日`;
  if (diff < 0) return `${Math.abs(diff)}日前`;
  return "今日";
}

function compareEvents(first, second) {
  const firstDiff = dateToEpochDay(first.date) - today;
  const secondDiff = dateToEpochDay(second.date) - today;
  const firstIsCurrentOrFuture = firstDiff >= 0;
  const secondIsCurrentOrFuture = secondDiff >= 0;

  if (firstIsCurrentOrFuture !== secondIsCurrentOrFuture) {
    return firstIsCurrentOrFuture ? -1 : 1;
  }

  const ascendingDateOrder = first.date === second.date ? 0 : (first.date < second.date ? -1 : 1);
  const dateOrder = firstIsCurrentOrFuture ? ascendingDateOrder : -ascendingDateOrder;
  if (dateOrder !== 0) return dateOrder;
  if (first.createdAt !== second.createdAt) return first.createdAt - second.createdAt;
  if (first.id === second.id) return 0;
  return first.id < second.id ? -1 : 1;
}

function isValidStoredEvent(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  if (typeof value.id !== "string" || value.id === "") return false;
  if (typeof value.name !== "string") return false;
  const trimmedName = value.name.trim();
  if (trimmedName.length < 1 || trimmedName.length > 50) return false;
  if (!isValidDateString(value.date)) return false;
  return typeof value.createdAt === "number" && Number.isFinite(value.createdAt);
}

function loadEvents() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) return;
    const data = JSON.parse(stored);
    if (typeof data !== "object" || data === null || Array.isArray(data)
      || data.version !== 1 || !Array.isArray(data.events)) {
      notification.textContent = "保存データを読み込めませんでした";
      return;
    }

    let skipped = false;
    events = data.events.flatMap((item) => {
      if (!isValidStoredEvent(item)) {
        skipped = true;
        return [];
      }
      return [{
        id: item.id,
        name: item.name.trim(),
        date: item.date,
        createdAt: item.createdAt
      }];
    });
    if (skipped) notification.textContent = "一部の保存データを読み込めませんでした";
  } catch (_error) {
    events = [];
    notification.textContent = "保存データを読み込めませんでした";
  }
}

function saveEvents() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, events }));
    notification.textContent = "";
  } catch (_error) {
    notification.textContent = "保存できませんでした";
  }
}

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function clearValidation() {
  formError.textContent = "";
  nameInput.setAttribute("aria-invalid", "false");
  dateInput.setAttribute("aria-invalid", "false");
}

function validateForm() {
  clearValidation();
  const name = nameInput.value.trim();
  if (name === "") {
    formError.textContent = "イベント名を入力してください";
    nameInput.setAttribute("aria-invalid", "true");
    return null;
  }
  if (name.length > 50) {
    formError.textContent = "イベント名は50文字以内で入力してください";
    nameInput.setAttribute("aria-invalid", "true");
    return null;
  }
  if (dateInput.value === "") {
    formError.textContent = "目標日を選択してください";
    dateInput.setAttribute("aria-invalid", "true");
    return null;
  }
  return { name, date: dateInput.value };
}

function resetForm() {
  mode = "create";
  editingId = null;
  form.reset();
  formTitle.textContent = "イベントを登録";
  submitButton.textContent = "登録する";
  cancelButton.hidden = true;
  clearValidation();
}

function startEditing(id) {
  const event = events.find((item) => item.id === id);
  if (!event) return;
  mode = "edit";
  editingId = id;
  nameInput.value = event.name;
  dateInput.value = event.date;
  formTitle.textContent = "イベントを編集";
  submitButton.textContent = "保存する";
  cancelButton.hidden = false;
  clearValidation();
  renderEvents();
}

function deleteEvent(id) {
  const event = events.find((item) => item.id === id);
  if (!event || !window.confirm(`「${event.name}」を削除しますか？`)) return;

  events = events.filter((item) => item.id !== id);
  if (mode === "edit" && editingId === id) resetForm();
  saveEvents();
  renderEvents();
}

function makeEventButton(text, className, accessibleName, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `button ${className}`;
  button.textContent = text;
  button.setAttribute("aria-label", accessibleName);
  button.addEventListener("click", handler);
  return button;
}

function renderEvents() {
  const sortedEvents = [...events].sort(compareEvents);
  listTitle.textContent = `登録したイベント（${events.length}件）`;
  eventList.replaceChildren();
  eventList.hidden = sortedEvents.length === 0;
  emptyMessage.hidden = sortedEvents.length !== 0;

  for (const event of sortedEvents) {
    const item = document.createElement("li");
    item.className = "event-item";
    if (mode === "edit" && editingId === event.id) item.setAttribute("aria-current", "true");

    const summary = document.createElement("div");
    summary.className = "event-summary";
    const name = document.createElement("p");
    name.className = "event-name";
    name.textContent = event.name;
    const dayCount = document.createElement("p");
    dayCount.className = "day-count";
    dayCount.textContent = formatDayCount(dateToEpochDay(event.date) - today);
    summary.append(name, dayCount);

    const details = document.createElement("div");
    details.className = "event-details";
    const targetDate = document.createElement("time");
    targetDate.className = "event-date";
    targetDate.dateTime = event.date;
    targetDate.textContent = formatTargetDate(event.date);
    const actions = document.createElement("div");
    actions.className = "event-actions";
    actions.append(
      makeEventButton("編集", "edit-button", `「${event.name}」を編集`, () => startEditing(event.id)),
      makeEventButton("削除", "delete-button", `「${event.name}」を削除`, () => deleteEvent(event.id))
    );
    details.append(targetDate, actions);
    item.append(summary, details);
    eventList.append(item);
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const values = validateForm();
  if (!values) return;

  if (mode === "create") {
    events.push({
      id: createId(),
      name: values.name,
      date: values.date,
      createdAt: Date.now()
    });
  } else {
    events = events.map((item) => item.id === editingId
      ? { ...item, name: values.name, date: values.date }
      : item);
  }

  resetForm();
  saveEvents();
  renderEvents();
  nameInput.focus();
});

cancelButton.addEventListener("click", () => {
  resetForm();
  renderEvents();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  const currentToday = getTodayEpochDay();
  if (currentToday !== today) {
    today = currentToday;
    renderEvents();
  }
});

loadEvents();
renderEvents();
