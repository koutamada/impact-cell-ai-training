"use strict";

const STORAGE_KEY = "part01-todo.tasks";
const input = document.getElementById("task-input");
const addButton = document.getElementById("add-button");
const list = document.getElementById("task-list");
const emptyMessage = document.getElementById("empty-message");

function createId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function loadTasks() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!Array.isArray(stored)) return [];

    const ids = new Set();
    const restored = [];
    for (const task of stored) {
      if (!task || typeof task.title !== "string") continue;
      const title = task.title.trim();
      if (!title) continue;

      let id = typeof task.id === "string" ? task.id : "";
      if (!id.trim() || ids.has(id)) {
        do {
          id = createId();
        } while (ids.has(id));
      }
      ids.add(id);
      restored.push({ id, title, completed: Boolean(task.completed) });
    }
    return restored;
  } catch {
    return [];
  }
}

let tasks = loadTasks();

function saveTasks() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch {
    // 保存できない環境でも、現在の画面では操作を継続する。
  }
}

function render() {
  list.replaceChildren();
  emptyMessage.hidden = tasks.length !== 0;

  for (const task of tasks) {
    const row = document.createElement("li");
    row.className = task.completed ? "task-row completed" : "task-row";

    const label = document.createElement("label");
    label.className = "task-label";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "task-checkbox";
    checkbox.checked = task.completed;
    checkbox.addEventListener("change", () => {
      toggleTask(task.id);
      // 全体再描画後もキーボードで続けて操作できるようにする。
      const index = tasks.findIndex((item) => item.id === task.id);
      list.children[index]?.querySelector("input").focus();
    });

    const title = document.createElement("span");
    title.className = "task-title";
    title.textContent = task.title;
    label.append(checkbox, title);

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete-button";
    deleteButton.textContent = "削除";
    deleteButton.setAttribute("aria-label", `${task.title}を削除`);
    deleteButton.addEventListener("click", () => {
      const index = tasks.findIndex((item) => item.id === task.id);
      deleteTask(task.id);
      const nextRow = list.children[Math.min(index, tasks.length - 1)];
      if (nextRow) nextRow.querySelector("button").focus();
      else input.focus();
    });

    row.append(label, deleteButton);
    list.append(row);
  }
}

function addTask(title) {
  const trimmed = title.trim();
  if (!trimmed) return;
  let id;
  do {
    id = createId();
  } while (tasks.some((task) => task.id === id));
  tasks.push({ id, title: trimmed, completed: false });
  saveTasks();
  render();
  input.value = "";
  input.focus();
}

function toggleTask(id) {
  const task = tasks.find((item) => item.id === id);
  if (!task) return;
  task.completed = !task.completed;
  saveTasks();
  render();
}

function deleteTask(id) {
  tasks = tasks.filter((task) => task.id !== id);
  saveTasks();
  render();
}

addButton.addEventListener("click", () => addTask(input.value));
input.addEventListener("keydown", (event) => {
  // keyCode 229 は一部ブラウザのIME確定時の補助判定。
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === "Enter") {
    event.preventDefault();
    addTask(input.value);
  }
});

render();
