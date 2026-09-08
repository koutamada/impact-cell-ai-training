"use strict";

const STORAGE_KEY = "intermediate-part01-kanban";
const STORAGE_VERSION = 1;
const STATUSES = ["todo", "doing", "done"];
const STATUS_LABELS = {
  todo: "未着手",
  doing: "作業中",
  done: "完了",
};
const LOAD_ERROR_MESSAGE = "保存データを読み込めなかったため、空の状態で起動しました。";
const SAVE_ERROR_MESSAGE = "変更を保存できませんでした。ブラウザの保存設定または空き容量を確認してください。";

const elements = {
  notice: document.querySelector("#app-notice"),
  addButton: document.querySelector("#add-task-button"),
  dialog: document.querySelector("#task-dialog"),
  form: document.querySelector("#task-form"),
  dialogTitle: document.querySelector("#dialog-title"),
  closeButton: document.querySelector("#close-dialog-button"),
  cancelButton: document.querySelector("#cancel-dialog-button"),
  title: document.querySelector("#task-title"),
  description: document.querySelector("#task-description"),
  dueDate: document.querySelector("#task-due-date"),
  assignee: document.querySelector("#task-assignee"),
  status: document.querySelector("#task-status"),
  titleError: document.querySelector("#title-error"),
  dateError: document.querySelector("#date-error"),
  statusError: document.querySelector("#status-error"),
  lists: Object.fromEntries(
    STATUSES.map((status) => [status, document.querySelector(`#${status}-list`)]),
  ),
  counts: Object.fromEntries(
    STATUSES.map((status) => [status, document.querySelector(`#${status}-count`)]),
  ),
};

let state = createEmptyState();
let returnFocusTarget = null;
let dragOriginAllowed = true;
let dropTarget = null;
let descriptionMeasureFrame = 0;
let descriptionElementSequence = 0;
const dropPlaceholder = createElement("div", "drop-placeholder", "ここに移動");

function createEmptyState() {
  return {
    tasks: [],
    columnOrder: { todo: [], doing: [], done: [] },
    initialized: true,
    modal: { open: false, mode: null, editingTaskId: null },
    draggingTaskId: null,
    expandedDescriptionIds: new Set(),
  };
}

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function createId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function offsetLocalDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localDateString(date);
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidDateString(value) {
  if (value === "") return true;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function isValidTask(task) {
  return (
    isPlainObject(task) &&
    typeof task.id === "string" &&
    task.id.length > 0 &&
    typeof task.title === "string" &&
    task.title.trim().length > 0 &&
    typeof task.description === "string" &&
    typeof task.dueDate === "string" &&
    isValidDateString(task.dueDate) &&
    typeof task.assignee === "string" &&
    STATUSES.includes(task.status) &&
    Number.isFinite(task.createdAt) &&
    Number.isFinite(task.updatedAt)
  );
}

function normalizeStoredData(value) {
  if (!isPlainObject(value) || value.version !== STORAGE_VERSION || value.initialized !== true) {
    return null;
  }
  if (!Array.isArray(value.tasks) || !isPlainObject(value.columnOrder)) return null;
  const orderKeys = Object.keys(value.columnOrder);
  if (orderKeys.length !== STATUSES.length || !STATUSES.every((status) => orderKeys.includes(status))) {
    return null;
  }
  if (!STATUSES.every((status) => Array.isArray(value.columnOrder[status]))) return null;
  if (!value.tasks.every(isValidTask)) return null;

  const taskIds = new Set();
  for (const task of value.tasks) {
    if (taskIds.has(task.id)) return null;
    taskIds.add(task.id);
  }

  const orderedIds = new Set();
  for (const status of STATUSES) {
    for (const id of value.columnOrder[status]) {
      if (typeof id !== "string" || orderedIds.has(id) || !taskIds.has(id)) return null;
      const task = value.tasks.find((item) => item.id === id);
      if (!task || task.status !== status) return null;
      orderedIds.add(id);
    }
  }
  if (orderedIds.size !== taskIds.size) return null;

  return {
    tasks: value.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      dueDate: task.dueDate,
      assignee: task.assignee,
      status: task.status,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    })),
    columnOrder: Object.fromEntries(
      STATUSES.map((status) => [status, [...value.columnOrder[status]]]),
    ),
    initialized: true,
  };
}

function createSampleState() {
  const now = Date.now();
  const tasks = [
    {
      id: createId(),
      title: "要件を確認する",
      description: "カードをクリックすると内容を編集できます。",
      dueDate: offsetLocalDate(2),
      assignee: "佐藤",
      status: "todo",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: createId(),
      title: "画面デザインを整える",
      description: "カードはドラッグして別の列へ移動できます。",
      dueDate: localDateString(),
      assignee: "鈴木",
      status: "doing",
      createdAt: now + 1,
      updatedAt: now + 1,
    },
    {
      id: createId(),
      title: "プロジェクトを準備する",
      description: "完了したタスクも編集や削除ができます。",
      dueDate: offsetLocalDate(-1),
      assignee: "高橋",
      status: "done",
      createdAt: now + 2,
      updatedAt: now + 2,
    },
  ];
  return {
    tasks,
    columnOrder: {
      todo: [tasks[0].id],
      doing: [tasks[1].id],
      done: [tasks[2].id],
    },
    initialized: true,
  };
}

function persistentSnapshot(source) {
  return {
    version: STORAGE_VERSION,
    initialized: true,
    tasks: source.tasks,
    columnOrder: source.columnOrder,
  };
}

function savePersistentState(candidate) {
  try {
    const serialized = JSON.stringify(persistentSnapshot(candidate));
    localStorage.setItem(STORAGE_KEY, serialized);
    return true;
  } catch (_error) {
    return false;
  }
}

function loadInitialState() {
  let serialized;
  try {
    serialized = localStorage.getItem(STORAGE_KEY);
  } catch (_error) {
    showNotice(LOAD_ERROR_MESSAGE);
    return createEmptyState();
  }

  if (serialized === null) {
    const samples = createSampleState();
    if (!savePersistentState(samples)) showNotice(SAVE_ERROR_MESSAGE);
    return { ...createEmptyState(), ...samples };
  }

  try {
    const normalized = normalizeStoredData(JSON.parse(serialized));
    if (!normalized) throw new Error("Invalid saved data");
    return { ...createEmptyState(), ...normalized };
  } catch (_error) {
    showNotice(LOAD_ERROR_MESSAGE);
    return createEmptyState();
  }
}

function clonePersistentState() {
  return {
    tasks: state.tasks.map((task) => ({ ...task })),
    columnOrder: Object.fromEntries(
      STATUSES.map((status) => [status, [...state.columnOrder[status]]]),
    ),
    initialized: true,
  };
}

function commit(candidate) {
  if (!savePersistentState(candidate)) {
    showNotice(SAVE_ERROR_MESSAGE);
    return false;
  }
  state.tasks = candidate.tasks;
  state.columnOrder = candidate.columnOrder;
  state.initialized = true;
  clearNotice();
  renderBoard();
  return true;
}

function showNotice(message) {
  elements.notice.textContent = message;
  elements.notice.hidden = false;
}

function clearNotice() {
  elements.notice.textContent = "";
  elements.notice.hidden = true;
}

function getTask(taskId) {
  return state.tasks.find((task) => task.id === taskId) || null;
}

function renderBoard() {
  for (const status of STATUSES) {
    const list = elements.lists[status];
    const fragment = document.createDocumentFragment();
    const ids = state.columnOrder[status];
    elements.counts[status].textContent = String(ids.length);
    elements.counts[status].setAttribute("aria-label", `${STATUS_LABELS[status]}のタスク件数 ${ids.length}件`);

    for (const taskId of ids) {
      const task = getTask(taskId);
      if (task) fragment.append(createTaskCard(task));
    }
    if (ids.length === 0) {
      fragment.append(createElement("p", "empty-state", "タスクはありません\nここへドロップできます"));
    }
    list.replaceChildren(fragment);
  }
  scheduleDescriptionMeasurement();
}

function createTaskCard(task) {
  const card = createElement("article", "task-card");
  card.dataset.taskId = task.id;
  card.draggable = true;
  card.tabIndex = 0;
  card.setAttribute("aria-label", `${task.title}を編集`);

  const heading = createElement("div", "card-heading");
  const title = createElement("h3", "card-title", task.title);
  const actions = createElement("div", "card-actions");
  const editButton = createElement("button", "card-action card-action-edit", "編集");
  editButton.type = "button";
  editButton.draggable = false;
  editButton.setAttribute("aria-label", `${task.title}を編集`);
  const deleteButton = createElement("button", "card-action card-action-delete", "削除");
  deleteButton.type = "button";
  deleteButton.draggable = false;
  deleteButton.setAttribute("aria-label", `${task.title}を削除`);
  actions.append(editButton, deleteButton);
  heading.append(title, actions);
  card.append(heading);

  if (task.description) {
    const description = createElement("p", "card-description is-collapsed", task.description);
    description.id = `card-description-${descriptionElementSequence += 1}`;
    description.dataset.taskId = task.id;
    const toggle = createElement("button", "description-toggle", "全文を表示");
    toggle.type = "button";
    toggle.draggable = false;
    toggle.hidden = true;
    toggle.dataset.taskId = task.id;
    toggle.setAttribute("aria-controls", description.id);
    updateDescriptionToggle(description, toggle, state.expandedDescriptionIds.has(task.id));
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      const willExpand = !state.expandedDescriptionIds.has(task.id);
      if (willExpand) state.expandedDescriptionIds.add(task.id);
      else state.expandedDescriptionIds.delete(task.id);
      updateDescriptionToggle(description, toggle, willExpand);
    });
    toggle.addEventListener("dragstart", (event) => event.preventDefault());
    card.append(description, toggle);
  }

  const meta = createElement("div", "card-meta");
  if (task.dueDate) meta.append(createDueDateChip(task));
  if (task.assignee) meta.append(createElement("span", "meta-chip", `担当：${task.assignee}`));
  if (meta.childElementCount > 0) card.append(meta);

  card.addEventListener("click", (event) => {
    if (!event.target.closest("button")) openEditDialog(task.id, card);
  });
  card.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && event.target === card) {
      event.preventDefault();
      openEditDialog(task.id, card);
    }
  });
  editButton.addEventListener("click", () => openEditDialog(task.id, editButton));
  deleteButton.addEventListener("click", () => deleteTask(task.id));

  card.addEventListener("pointerdown", (event) => {
    dragOriginAllowed = !event.target.closest("button");
  });
  card.addEventListener("pointerup", () => {
    dragOriginAllowed = true;
  });
  card.addEventListener("dragstart", handleDragStart);
  card.addEventListener("dragend", cleanupDragState);
  editButton.addEventListener("dragstart", (event) => event.preventDefault());
  deleteButton.addEventListener("dragstart", (event) => event.preventDefault());
  return card;
}

function updateDescriptionToggle(description, toggle, expanded) {
  description.classList.toggle("is-collapsed", !expanded);
  toggle.textContent = expanded ? "折りたたむ" : "全文を表示";
  toggle.setAttribute("aria-expanded", String(expanded));
  const task = getTask(toggle.dataset.taskId);
  const taskTitle = task ? task.title : "タスク";
  toggle.setAttribute(
    "aria-label",
    expanded ? `${taskTitle}の説明を折りたたむ` : `${taskTitle}の説明全文を表示`,
  );
}

function scheduleDescriptionMeasurement() {
  if (descriptionMeasureFrame) cancelAnimationFrame(descriptionMeasureFrame);
  descriptionMeasureFrame = requestAnimationFrame(() => {
    descriptionMeasureFrame = 0;
    measureDescriptionOverflow();
  });
}

function measureDescriptionOverflow() {
  document.querySelectorAll(".card-description").forEach((description) => {
    const taskId = description.dataset.taskId;
    const toggle = description.nextElementSibling;
    if (!(toggle instanceof HTMLButtonElement) || !toggle.matches(".description-toggle")) return;

    const wasExpanded = state.expandedDescriptionIds.has(taskId);
    description.classList.add("is-collapsed");
    const isOverflowing = description.scrollHeight > description.clientHeight + 1;

    if (!isOverflowing) state.expandedDescriptionIds.delete(taskId);
    updateDescriptionToggle(description, toggle, isOverflowing && wasExpanded);
    toggle.hidden = !isOverflowing;
  });
}

function createDueDateChip(task) {
  const today = localDateString();
  let className = "meta-chip";
  let suffix = "";
  if (task.status !== "done" && task.dueDate === today) {
    className += " due-today";
    suffix = "（今日）";
  } else if (task.status !== "done" && task.dueDate < today) {
    className += " due-overdue";
    suffix = "（期限超過）";
  }
  return createElement("span", className, `期限：${task.dueDate}${suffix}`);
}

function openCreateDialog() {
  state.modal = { open: true, mode: "create", editingTaskId: null };
  returnFocusTarget = { element: elements.addButton, taskId: null, action: "add" };
  elements.dialogTitle.textContent = "タスクを追加";
  elements.form.reset();
  elements.status.value = "todo";
  clearFormErrors();
  elements.dialog.showModal();
  elements.title.focus();
}

function openEditDialog(taskId, trigger) {
  const task = getTask(taskId);
  if (!task) {
    renderBoard();
    return;
  }
  state.modal = { open: true, mode: "edit", editingTaskId: taskId };
  returnFocusTarget = {
    element: trigger,
    taskId,
    action: trigger.matches(".card-action-edit") ? "edit" : "card",
  };
  elements.dialogTitle.textContent = "タスクを編集";
  elements.title.value = task.title;
  elements.description.value = task.description;
  elements.dueDate.value = task.dueDate;
  elements.assignee.value = task.assignee;
  elements.status.value = task.status;
  clearFormErrors();
  elements.dialog.showModal();
  elements.title.focus();
}

function closeDialog() {
  const focusTarget = returnFocusTarget;
  state.modal = { open: false, mode: null, editingTaskId: null };
  returnFocusTarget = null;
  elements.dialog.close();
  elements.form.reset();
  clearFormErrors();
  if (focusTarget?.element?.isConnected) {
    focusTarget.element.focus();
    return;
  }
  if (focusTarget?.taskId) {
    const card = document.querySelector(`.task-card[data-task-id="${CSS.escape(focusTarget.taskId)}"]`);
    const replacement = focusTarget.action === "edit" ? card?.querySelector(".card-action-edit") : card;
    if (replacement) {
      replacement.focus();
      return;
    }
  }
  elements.addButton.focus();
}

function clearFormErrors() {
  for (const [input, error] of [
    [elements.title, elements.titleError],
    [elements.dueDate, elements.dateError],
    [elements.status, elements.statusError],
  ]) {
    input.removeAttribute("aria-invalid");
    error.hidden = true;
  }
}

function validateForm(values) {
  clearFormErrors();
  const invalid = [];
  if (!values.title) {
    elements.title.setAttribute("aria-invalid", "true");
    elements.titleError.hidden = false;
    invalid.push(elements.title);
  }
  if (!isValidDateString(values.dueDate)) {
    elements.dueDate.setAttribute("aria-invalid", "true");
    elements.dateError.hidden = false;
    invalid.push(elements.dueDate);
  }
  if (!STATUSES.includes(values.status)) {
    elements.status.setAttribute("aria-invalid", "true");
    elements.statusError.hidden = false;
    invalid.push(elements.status);
  }
  if (invalid.length > 0) invalid[0].focus();
  return invalid.length === 0;
}

function readFormValues() {
  return {
    title: elements.title.value.trim(),
    description: elements.description.value.trim(),
    dueDate: elements.dueDate.value,
    assignee: elements.assignee.value.trim(),
    status: elements.status.value,
  };
}

function handleFormSubmit(event) {
  event.preventDefault();
  const values = readFormValues();
  if (!validateForm(values)) return;

  const candidate = clonePersistentState();
  const now = Date.now();
  if (state.modal.mode === "create") {
    const task = { id: createId(), ...values, createdAt: now, updatedAt: now };
    candidate.tasks.push(task);
    candidate.columnOrder[task.status].push(task.id);
  } else if (state.modal.mode === "edit") {
    const taskId = state.modal.editingTaskId;
    const taskIndex = candidate.tasks.findIndex((task) => task.id === taskId);
    if (taskIndex < 0) {
      closeDialog();
      renderBoard();
      return;
    }
    const previous = candidate.tasks[taskIndex];
    candidate.tasks[taskIndex] = { ...previous, ...values, updatedAt: now };
    if (previous.status !== values.status) {
      candidate.columnOrder[previous.status] = candidate.columnOrder[previous.status].filter((id) => id !== taskId);
      candidate.columnOrder[values.status].push(taskId);
    }
  } else {
    return;
  }

  if (commit(candidate)) closeDialog();
}

function deleteTask(taskId) {
  const task = getTask(taskId);
  if (!task) {
    renderBoard();
    return;
  }
  if (!window.confirm(`「${task.title}」を削除しますか？`)) return;

  const candidate = clonePersistentState();
  candidate.tasks = candidate.tasks.filter((item) => item.id !== taskId);
  candidate.columnOrder[task.status] = candidate.columnOrder[task.status].filter((id) => id !== taskId);
  commit(candidate);
}

function handleDragStart(event) {
  if (!dragOriginAllowed || event.target.closest("button")) {
    event.preventDefault();
    dragOriginAllowed = true;
    return;
  }
  const card = event.currentTarget;
  state.draggingTaskId = card.dataset.taskId;
  card.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", state.draggingTaskId);
  requestAnimationFrame(() => {
    for (const list of Object.values(elements.lists)) list.classList.add("drop-active");
  });
}

function handleDragOver(event) {
  if (!state.draggingTaskId) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  const list = event.currentTarget;
  const status = list.dataset.status;
  const cards = [...list.querySelectorAll(".task-card:not(.is-dragging)")];
  const nextCard = cards.find((card) => event.clientY < card.getBoundingClientRect().top + card.offsetHeight / 2);
  const index = nextCard ? cards.indexOf(nextCard) : cards.length;
  dropTarget = { status, index };
  if (nextCard) list.insertBefore(dropPlaceholder, nextCard);
  else list.append(dropPlaceholder);
}

function handleDrop(event) {
  event.preventDefault();
  const taskId = state.draggingTaskId;
  const target = dropTarget;
  if (!taskId || !target || !getTask(taskId) || !STATUSES.includes(target.status)) {
    cleanupDragState();
    renderBoard();
    return;
  }

  const task = getTask(taskId);
  const candidate = clonePersistentState();
  candidate.columnOrder[task.status] = candidate.columnOrder[task.status].filter((id) => id !== taskId);
  candidate.columnOrder[target.status].splice(target.index, 0, taskId);

  const orderChanged = STATUSES.some((status) => {
    const nextOrder = candidate.columnOrder[status];
    const currentOrder = state.columnOrder[status];
    return nextOrder.length !== currentOrder.length || nextOrder.some((id, index) => id !== currentOrder[index]);
  });
  if (!orderChanged) {
    cleanupDragState();
    renderBoard();
    return;
  }

  const taskIndex = candidate.tasks.findIndex((item) => item.id === taskId);
  candidate.tasks[taskIndex] = {
    ...candidate.tasks[taskIndex],
    status: target.status,
    updatedAt: Date.now(),
  };
  cleanupDragState();
  if (!commit(candidate)) renderBoard();
}

function cleanupDragState() {
  state.draggingTaskId = null;
  dropTarget = null;
  dragOriginAllowed = true;
  dropPlaceholder.remove();
  document.querySelectorAll(".task-card.is-dragging").forEach((card) => card.classList.remove("is-dragging"));
  for (const list of Object.values(elements.lists)) list.classList.remove("drop-active");
}

function trapDialogFocus(event) {
  if (event.key !== "Tab" || !elements.dialog.open) return;
  const focusable = [...elements.dialog.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => element.getClientRects().length > 0);
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

elements.addButton.addEventListener("click", openCreateDialog);
elements.closeButton.addEventListener("click", closeDialog);
elements.cancelButton.addEventListener("click", closeDialog);
elements.form.addEventListener("submit", handleFormSubmit);
elements.dialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeDialog();
});
elements.dialog.addEventListener("click", (event) => {
  if (event.target === elements.dialog) event.preventDefault();
});
elements.dialog.addEventListener("keydown", trapDialogFocus);
elements.title.addEventListener("input", () => {
  if (elements.title.value.trim()) {
    elements.title.removeAttribute("aria-invalid");
    elements.titleError.hidden = true;
  }
});
for (const list of Object.values(elements.lists)) {
  list.addEventListener("dragover", handleDragOver);
  list.addEventListener("drop", handleDrop);
}
document.addEventListener("dragend", cleanupDragState);
document.addEventListener("drop", (event) => {
  if (!event.target.closest(".task-list")) cleanupDragState();
});
window.addEventListener("resize", scheduleDescriptionMeasurement);

state = loadInitialState();
renderBoard();
