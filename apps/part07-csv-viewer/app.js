"use strict";

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const PAGE_SIZE = 100;
const SEARCH_SEPARATOR = "\u001f";
const NUMBER_PATTERN = /^[+-]?(\d+(\.\d+)?|\.\d+)$/;

let data = null;
let query = "";
let sortColumn = null;
let sortDirection = "asc";
let page = 1;
let viewOrder = [];
let composing = false;
let searchTimer = null;

const fileInput = document.getElementById("csv-file");
const selectedFile = document.getElementById("selected-file");
const messageArea = document.getElementById("message-area");
const initialGuide = document.getElementById("initial-guide");
const viewer = document.getElementById("viewer");
const searchInput = document.getElementById("search");
const status = document.getElementById("status");
const tableContainer = document.getElementById("table-container");
const headerRow = document.getElementById("header-row");
const tableBody = document.getElementById("table-body");
const noRows = document.getElementById("no-rows");
const firstPageButton = document.getElementById("first-page");
const previousPageButton = document.getElementById("previous-page");
const nextPageButton = document.getElementById("next-page");
const lastPageButton = document.getElementById("last-page");
const pageStatus = document.getElementById("page-status");

function parseCsv(text) {
  const parsedRows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let justEndedRow = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else if (character === "\r") {
        field += "\n";
        if (text[index + 1] === "\n") index += 1;
      } else {
        field += character;
      }
      justEndedRow = false;
      continue;
    }

    if (character === '"' && field === "") {
      inQuotes = true;
      justEndedRow = false;
    } else if (character === '"') {
      field += character;
      justEndedRow = false;
    } else if (character === ",") {
      row.push(field);
      field = "";
      justEndedRow = false;
    } else if (character === "\r" || character === "\n") {
      row.push(field);
      parsedRows.push(row);
      row = [];
      field = "";
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      justEndedRow = true;
    } else {
      field += character;
      justEndedRow = false;
    }
  }

  if (!justEndedRow) {
    row.push(field);
    parsedRows.push(row);
  }

  return { rows: parsedRows, unclosedQuote: inQuotes };
}

function isNumericCell(value) {
  return NUMBER_PATTERN.test(value.trim());
}

function determineNumericColumns(rows, columnCount) {
  const numericColumns = [];
  for (let column = 0; column < columnCount; column += 1) {
    let hasValue = false;
    let numeric = true;
    for (const row of rows) {
      if (row[column] === "") continue;
      hasValue = true;
      if (!isNumericCell(row[column])) {
        numeric = false;
        break;
      }
    }
    numericColumns.push(hasValue && numeric);
  }
  return numericColumns;
}

function prepareData(text, fileName) {
  const warnings = [];
  let source = text;
  if (source.startsWith("\ufeff")) source = source.slice(1);
  if (source.includes("\ufffd")) {
    warnings.push("UTF-8として読み取れない文字が含まれています。ファイルの文字コードをご確認ください");
  }

  const parsed = parseCsv(source);
  const allRows = parsed.rows;
  const headerSource = allRows[0];
  const rawRows = allRows.slice(1);
  const headerColumnCount = headerSource.length;
  const columnCount = allRows.reduce((maximum, current) => Math.max(maximum, current.length), 0);
  const mismatchedRows = rawRows.reduce(
    (count, current) => count + (current.length === headerColumnCount ? 0 : 1),
    0
  );

  if (mismatchedRows > 0) {
    warnings.push(`${mismatchedRows}行で列数がヘッダー行と一致しませんでした`);
  }
  if (parsed.unclosedQuote) {
    warnings.push("閉じられていない引用符があります。解析結果をご確認ください");
  }
  if (headerColumnCount < columnCount) {
    warnings.push(`ヘッダーの列数が不足していたため、列${headerColumnCount + 1}以降を自動で補いました`);
  }

  const headers = Array.from({ length: columnCount }, (_unused, column) => {
    const value = column < headerColumnCount ? headerSource[column] : "";
    return value === "" ? `列${column + 1}` : value;
  });
  const rows = rawRows.map((rawRow) => Array.from(
    { length: columnCount },
    (_unused, column) => column < rawRow.length ? rawRow[column] : ""
  ));
  const searchIndex = rows.map((current) => current.join(SEARCH_SEPARATOR).toLowerCase());
  const numericColumns = determineNumericColumns(rows, columnCount);

  return { fileName, headers, rows, searchIndex, numericColumns, warnings };
}

function clearApplication() {
  if (searchTimer !== null) clearTimeout(searchTimer);
  searchTimer = null;
  data = null;
  query = "";
  sortColumn = null;
  sortDirection = "asc";
  page = 1;
  viewOrder = [];
  composing = false;
  searchInput.value = "";
  selectedFile.textContent = "選択されていません";
  messageArea.replaceChildren();
  headerRow.replaceChildren();
  tableBody.replaceChildren();
  viewer.hidden = true;
  initialGuide.hidden = false;
}

function showError(message) {
  const box = document.createElement("div");
  box.className = "message-box error-box";
  const heading = document.createElement("h2");
  heading.textContent = "エラー";
  const detail = document.createElement("p");
  detail.textContent = `× ${message}`;
  box.append(heading, detail);
  messageArea.replaceChildren(box);
}

function showWarnings(warnings) {
  if (warnings.length === 0) {
    messageArea.replaceChildren();
    return;
  }
  const box = document.createElement("div");
  box.className = "message-box warning-box";
  const heading = document.createElement("h2");
  heading.textContent = "警告";
  const list = document.createElement("ul");
  for (const warning of warnings) {
    const item = document.createElement("li");
    item.textContent = warning;
    list.append(item);
  }
  box.append(heading, list);
  messageArea.replaceChildren(box);
}

function renderHeaders() {
  const fragment = document.createDocumentFragment();
  const rowNumberHeader = document.createElement("th");
  rowNumberHeader.scope = "col";
  rowNumberHeader.className = "row-number";
  rowNumberHeader.textContent = "#";
  fragment.append(rowNumberHeader);

  data.headers.forEach((header, column) => {
    const cell = document.createElement("th");
    cell.scope = "col";
    const isSorted = sortColumn === column;
    cell.setAttribute("aria-sort", isSorted
      ? (sortDirection === "asc" ? "ascending" : "descending")
      : "none");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sort-button";
    button.textContent = `${header}${isSorted ? (sortDirection === "asc" ? " ▲" : " ▼") : ""}`;
    button.setAttribute("title", header);
    button.addEventListener("click", () => sortByColumn(column));
    cell.append(button);
    fragment.append(cell);
  });
  headerRow.replaceChildren(fragment);
}

function compareRowIndexes(firstIndex, secondIndex) {
  const firstValue = data.rows[firstIndex][sortColumn];
  const secondValue = data.rows[secondIndex][sortColumn];
  const firstEmpty = firstValue === "";
  const secondEmpty = secondValue === "";
  if (firstEmpty || secondEmpty) {
    if (firstEmpty && secondEmpty) return firstIndex - secondIndex;
    return firstEmpty ? 1 : -1;
  }

  let comparison;
  if (data.numericColumns[sortColumn]) {
    const firstNumber = Number(firstValue.trim());
    const secondNumber = Number(secondValue.trim());
    comparison = firstNumber === secondNumber ? 0 : firstNumber - secondNumber;
  } else {
    comparison = firstValue.localeCompare(secondValue, "ja");
  }
  if (comparison === 0) return firstIndex - secondIndex;
  return sortDirection === "asc" ? comparison : -comparison;
}

function rebuildViewOrder() {
  const filtered = [];
  for (let index = 0; index < data.rows.length; index += 1) {
    if (query === "" || data.searchIndex[index].includes(query)) filtered.push(index);
  }
  if (sortColumn !== null) filtered.sort(compareRowIndexes);
  viewOrder = filtered;
}

function getTotalPages() {
  return Math.max(1, Math.ceil(viewOrder.length / PAGE_SIZE));
}

function renderBody() {
  const fragment = document.createDocumentFragment();
  const start = (page - 1) * PAGE_SIZE;
  const visibleIndexes = viewOrder.slice(start, start + PAGE_SIZE);

  for (const rowIndex of visibleIndexes) {
    const tableRow = document.createElement("tr");
    const rowNumber = document.createElement("td");
    rowNumber.className = "row-number";
    rowNumber.textContent = String(rowIndex + 1);
    tableRow.append(rowNumber);

    for (const value of data.rows[rowIndex]) {
      const cell = document.createElement("td");
      cell.textContent = value.replace(/\n/g, " ");
      cell.setAttribute("title", value);
      tableRow.append(cell);
    }
    fragment.append(tableRow);
  }
  tableBody.replaceChildren(fragment);

  const hasNoRows = viewOrder.length === 0;
  noRows.hidden = !hasNoRows;
  noRows.textContent = data.rows.length === 0 ? "データ行がありません" : "該当する行がありません";
}

function renderStatus() {
  const base = `${data.fileName} ／ ${data.rows.length.toLocaleString("ja-JP")}行 ${data.headers.length}列`;
  status.textContent = query === "" ? base : `${base} ／ 該当 ${viewOrder.length.toLocaleString("ja-JP")}行`;
}

function renderPagination() {
  const totalPages = getTotalPages();
  pageStatus.textContent = `${page} / ${totalPages} ページ`;
  firstPageButton.disabled = page === 1;
  previousPageButton.disabled = page === 1;
  nextPageButton.disabled = page === totalPages;
  lastPageButton.disabled = page === totalPages;
}

function renderView() {
  renderHeaders();
  renderBody();
  renderStatus();
  renderPagination();
}

function sortByColumn(column) {
  if (sortColumn === column) {
    sortDirection = sortDirection === "asc" ? "desc" : "asc";
  } else {
    sortColumn = column;
    sortDirection = "asc";
  }
  page = 1;
  rebuildViewOrder();
  renderView();
  tableContainer.scrollTop = 0;
}

function applySearch() {
  if (composing || data === null) return;
  query = searchInput.value.trim().toLowerCase();
  page = 1;
  rebuildViewOrder();
  renderView();
  tableContainer.scrollTop = 0;
}

function moveToPage(targetPage) {
  page = targetPage;
  renderBody();
  renderPagination();
  tableContainer.scrollTop = 0;
}

async function handleFile(file) {
  clearApplication();
  if (!/\.csv$/i.test(file.name)) {
    showError("CSVファイル（.csv）を選択してください");
    return;
  }
  if (file.size > MAX_FILE_SIZE) {
    showError("ファイルが大きすぎます（20MBまで）");
    return;
  }
  if (file.size === 0) {
    showError("ファイルが空です");
    return;
  }

  try {
    const text = await file.text();
    const sourceWithoutBom = text.startsWith("\ufeff") ? text.slice(1) : text;
    if (/^[\r\n]*$/.test(sourceWithoutBom)) {
      showError("CSVの内容が空です");
      return;
    }
    data = prepareData(text, file.name);
    selectedFile.textContent = data.fileName;
    showWarnings(data.warnings);
    rebuildViewOrder();
    initialGuide.hidden = true;
    viewer.hidden = false;
    renderView();
  } catch (_error) {
    clearApplication();
    showError("ファイルを読み込めませんでした");
  }
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;
  try {
    await handleFile(file);
  } finally {
    fileInput.value = "";
  }
});

searchInput.addEventListener("compositionstart", () => {
  composing = true;
  if (searchTimer !== null) clearTimeout(searchTimer);
  searchTimer = null;
});

searchInput.addEventListener("compositionend", () => {
  composing = false;
  if (searchTimer !== null) clearTimeout(searchTimer);
  searchTimer = null;
  applySearch();
});

searchInput.addEventListener("input", (event) => {
  if (composing || event.isComposing) return;
  if (searchTimer !== null) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchTimer = null;
    applySearch();
  }, 200);
});

firstPageButton.addEventListener("click", () => moveToPage(1));
previousPageButton.addEventListener("click", () => moveToPage(page - 1));
nextPageButton.addEventListener("click", () => moveToPage(page + 1));
lastPageButton.addEventListener("click", () => moveToPage(getTotalPages()));

clearApplication();
