"use strict";

// Chart.js 4.5.1 — bundled locally at vendor/chart.umd.min.js.
// License: vendor/LICENSE.md

const LIMITS = Object.freeze({
  fileBytes: 5_242_880,
  dataRows: 10_000,
  columns: 100,
  previewRows: 100,
});

const ALL_FILTER_VALUE = "__ALL__";
const EMPTY_LABEL = "（空値）";
const NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const CHART_TYPES = new Set(["bar", "line", "pie"]);
const AGGREGATIONS = new Set(["sum", "average", "count"]);
const AVERAGE_FORMATTER = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 });
const NUMBER_FORMATTER = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 12 });

const CHART_COLORS = [
  "#287a80", "#d18a2d", "#4e7194", "#7b6aa2", "#4d8b62",
  "#b86058", "#598f9f", "#a77944", "#657a43", "#95647d",
  "#3e8580", "#b66e38",
];

const elements = {
  notification: document.querySelector("#notification"),
  notificationIcon: document.querySelector("#notification-icon"),
  notificationText: document.querySelector("#notification-text"),
  uploadZone: document.querySelector("#upload-zone"),
  fileInput: document.querySelector("#csv-file"),
  loadingText: document.querySelector("#loading-text"),
  fileName: document.querySelector("#file-name"),
  totalRows: document.querySelector("#total-rows"),
  filteredRows: document.querySelector("#filtered-rows"),
  columnCount: document.querySelector("#column-count"),
  settingsFieldset: document.querySelector("#settings-fieldset"),
  filterColumn: document.querySelector("#filter-column"),
  filterValue: document.querySelector("#filter-value"),
  filterColumnHelp: document.querySelector("#filter-column-help"),
  chartType: document.querySelector("#chart-type"),
  aggregation: document.querySelector("#aggregation"),
  xColumn: document.querySelector("#x-column"),
  yColumn: document.querySelector("#y-column"),
  chartTitle: document.querySelector("#chart-title"),
  showLegend: document.querySelector("#show-legend"),
  createChart: document.querySelector("#create-chart"),
  savePng: document.querySelector("#save-png"),
  xColumnError: document.querySelector("#x-column-error"),
  yColumnError: document.querySelector("#y-column-error"),
  chartWrap: document.querySelector("#chart-wrap"),
  chartMessage: document.querySelector("#chart-message"),
  canvas: document.querySelector("#chart-canvas"),
  resultSummary: document.querySelector("#result-summary"),
  resultTableWrap: document.querySelector("#result-table-wrap"),
  previewMessage: document.querySelector("#preview-message"),
  previewLimit: document.querySelector("#preview-limit"),
  previewToggle: document.querySelector("#preview-toggle"),
  previewContent: document.querySelector("#preview-content"),
  previewTableWrap: document.querySelector("#preview-table-wrap"),
};

const state = {
  dataset: null,
  config: defaultConfig(),
  filteredRows: [],
  aggregateRows: [],
  chartInstance: null,
  isChartCurrent: false,
  isLoading: false,
  loadStatus: "idle",
  chartLibraryReady: typeof window.Chart === "function" && window.Chart.version === "4.5.1",
  filterOptions: [],
};

let titleUpdateTimer = null;
let isTitleComposing = false;

function defaultConfig() {
  return {
    chartType: "bar",
    xColumn: "",
    yColumn: "",
    aggregation: "sum",
    showLegend: true,
    title: "",
    filterColumn: "",
    filterValue: ALL_FILTER_VALUE,
  };
}

function setNotification(type, message) {
  const symbols = { info: "i", success: "✓", warning: "!", error: "!" };
  elements.notification.className = `notification notification-${type}`;
  elements.notificationIcon.textContent = symbols[type] || "i";
  elements.notificationText.textContent = message;
  elements.notification.setAttribute("role", type === "error" ? "alert" : "status");
  elements.notification.setAttribute("aria-live", type === "error" ? "assertive" : "polite");
}

function setLoading(isLoading) {
  state.isLoading = isLoading;
  elements.uploadZone.setAttribute("aria-busy", String(isLoading));
  elements.fileInput.disabled = isLoading;
  elements.loadingText.hidden = !isLoading;
  updateControlAvailability();
}

function updateControlAvailability() {
  const hasDataset = Boolean(state.dataset);
  const hasNumbers = hasDataset && getColumnsByType("number").length > 0;
  elements.settingsFieldset.disabled = !hasDataset || !hasNumbers || state.isLoading;

  if (hasDataset && hasNumbers && !state.isLoading) {
    const textColumns = getColumnsByType("text");
    elements.filterColumn.disabled = textColumns.length === 0;
    elements.filterValue.disabled = !state.config.filterColumn;
  }

  const canCreate = hasDataset
    && hasNumbers
    && state.filteredRows.length > 0
    && state.chartLibraryReady
    && !state.isLoading;
  elements.createChart.disabled = !canCreate;
  elements.savePng.disabled = !state.isChartCurrent || !state.chartInstance || state.isLoading;
}

function getColumnsByType(type) {
  if (!state.dataset) return [];
  return state.dataset.headers.filter((header) => state.dataset.columnTypes[header] === type);
}

function readConfigFromControls() {
  state.config = {
    chartType: elements.chartType.value,
    xColumn: elements.xColumn.value,
    yColumn: elements.yColumn.value,
    aggregation: elements.aggregation.value,
    showLegend: elements.showLegend.checked,
    title: elements.chartTitle.value,
    filterColumn: elements.filterColumn.value,
    filterValue: elements.filterValue.value,
  };
}

function appendOption(select, value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.append(option);
}

function replaceOptions(select, options) {
  select.replaceChildren();
  options.forEach(({ value, label }) => appendOption(select, value, label));
}

function initializeSettings(dataset) {
  const numericColumns = dataset.headers.filter((header) => dataset.columnTypes[header] === "number");
  const textColumns = dataset.headers.filter((header) => dataset.columnTypes[header] === "text");
  state.config = defaultConfig();
  state.config.xColumn = dataset.headers[0] || "";
  state.config.yColumn = numericColumns[0] || "";

  replaceOptions(elements.xColumn, dataset.headers.map((header) => ({ value: header, label: header })));
  replaceOptions(elements.yColumn, numericColumns.map((header) => ({ value: header, label: header })));
  replaceOptions(elements.filterColumn, [
    { value: "", label: "絞り込みなし" },
    ...textColumns.map((header) => ({ value: header, label: header })),
  ]);
  replaceOptions(elements.filterValue, [{ value: ALL_FILTER_VALUE, label: "すべて" }]);

  elements.xColumn.value = state.config.xColumn;
  elements.yColumn.value = state.config.yColumn;
  elements.filterColumn.value = "";
  elements.filterValue.value = ALL_FILTER_VALUE;
  elements.chartType.value = "bar";
  elements.aggregation.value = "sum";
  elements.showLegend.checked = true;
  elements.chartTitle.value = "";
  elements.filterColumnHelp.textContent = textColumns.length
    ? "文字列列を1つ選択できます。"
    : "文字列列がないため絞り込みは利用できません。";
}

function normalizeCategory(value) {
  return value.trim();
}

function displayCategory(value) {
  return value === "" ? EMPTY_LABEL : value;
}

function applyFilter() {
  if (!state.dataset) {
    state.filteredRows = [];
    return;
  }

  if (!state.config.filterColumn || state.config.filterValue === ALL_FILTER_VALUE) {
    state.filteredRows = state.dataset.rows.slice();
  } else {
    const columnIndex = state.dataset.headers.indexOf(state.config.filterColumn);
    const selectedOption = state.filterOptions.find((option) => option.key === state.config.filterValue);
    if (columnIndex < 0 || !selectedOption) {
      state.filteredRows = [];
    } else {
      state.filteredRows = state.dataset.rows.filter(
        (row) => normalizeCategory(row[columnIndex]) === selectedOption.normalizedValue,
      );
    }
  }

  renderStats();
  if (state.filteredRows.length === 0) {
    setNotification("warning", "絞り込み結果が0件です。条件を変更してください。");
  }
  updateControlAvailability();
}

function rebuildFilterValues() {
  state.filterOptions = [];
  replaceOptions(elements.filterValue, [{ value: ALL_FILTER_VALUE, label: "すべて" }]);

  if (!state.dataset || !state.config.filterColumn) {
    elements.filterValue.value = ALL_FILTER_VALUE;
    elements.filterValue.disabled = true;
    return;
  }

  const columnIndex = state.dataset.headers.indexOf(state.config.filterColumn);
  const seen = new Set();
  state.dataset.rows.forEach((row) => {
    const normalizedValue = normalizeCategory(row[columnIndex]);
    if (seen.has(normalizedValue)) return;
    seen.add(normalizedValue);
    const key = `value-${state.filterOptions.length}`;
    state.filterOptions.push({ key, normalizedValue });
    appendOption(elements.filterValue, key, displayCategory(normalizedValue));
  });

  state.config.filterValue = ALL_FILTER_VALUE;
  elements.filterValue.value = ALL_FILTER_VALUE;
  elements.filterValue.disabled = false;
}

function renderStats() {
  if (!state.dataset) {
    elements.fileName.textContent = "未読込";
    elements.fileName.title = "";
    elements.totalRows.textContent = "—";
    elements.filteredRows.textContent = "—";
    elements.columnCount.textContent = "—";
    return;
  }
  elements.fileName.textContent = state.dataset.fileName;
  elements.fileName.title = state.dataset.fileName;
  elements.totalRows.textContent = NUMBER_FORMATTER.format(state.dataset.rows.length);
  elements.filteredRows.textContent = NUMBER_FORMATTER.format(state.filteredRows.length);
  elements.columnCount.textContent = NUMBER_FORMATTER.format(state.dataset.headers.length);
}

function makeTable(headers, rows, emptyColumns = new Set()) {
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  headers.forEach((header) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = header;
    headRow.append(th);
  });
  thead.append(headRow);
  table.append(thead);

  const tbody = document.createElement("tbody");
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    row.forEach((value, index) => {
      const td = document.createElement("td");
      if (emptyColumns.has(index) && value.trim() === "") {
        td.textContent = EMPTY_LABEL;
        td.className = "empty-cell";
      } else {
        td.textContent = value;
      }
      tr.append(td);
    });
    tbody.append(tr);
  });
  table.append(tbody);
  return table;
}

function renderPreview() {
  if (!state.dataset) {
    setPreviewExpanded(false);
    elements.previewToggle.disabled = true;
    elements.previewMessage.hidden = false;
    elements.previewTableWrap.hidden = true;
    elements.previewTableWrap.replaceChildren();
    elements.previewLimit.textContent = "未読込";
    return;
  }

  elements.previewToggle.disabled = false;
  const previewRows = state.dataset.rows.slice(0, LIMITS.previewRows);
  const emptyColumns = new Set(state.dataset.headers.map((_, index) => index));
  elements.previewTableWrap.replaceChildren(makeTable(state.dataset.headers, previewRows, emptyColumns));
  elements.previewTableWrap.hidden = false;
  elements.previewMessage.hidden = true;
  elements.previewLimit.textContent = state.dataset.rows.length > LIMITS.previewRows
    ? `先頭${LIMITS.previewRows}件を表示（全${state.dataset.rows.length}件）`
    : `${state.dataset.rows.length}件を表示`;
}

function setPreviewExpanded(expanded) {
  const canExpand = Boolean(state.dataset);
  const isExpanded = canExpand && expanded;
  elements.previewContent.hidden = !isExpanded;
  elements.previewToggle.setAttribute("aria-expanded", String(isExpanded));
  elements.previewToggle.textContent = isExpanded ? "閉じる" : "表示する";
}

function togglePreview() {
  const isExpanded = elements.previewToggle.getAttribute("aria-expanded") === "true";
  setPreviewExpanded(!isExpanded);
}

function clearFieldErrors() {
  [
    [elements.xColumn, elements.xColumnError],
    [elements.yColumn, elements.yColumnError],
  ].forEach(([control, error]) => {
    control.removeAttribute("aria-invalid");
    error.hidden = true;
    error.textContent = "";
  });
}

function showFieldError(control, errorElement, message) {
  control.setAttribute("aria-invalid", "true");
  errorElement.textContent = message;
  errorElement.hidden = false;
}

function invalidateChart(message = "現在の条件ではグラフを表示できません。") {
  if (state.chartInstance) {
    state.chartInstance.destroy();
    state.chartInstance = null;
  }
  state.aggregateRows = [];
  state.isChartCurrent = false;
  elements.canvas.hidden = true;
  elements.chartMessage.hidden = false;
  elements.chartMessage.textContent = message;
  elements.canvas.removeAttribute("aria-describedby");
  elements.canvas.setAttribute("aria-label", "グラフは未作成です");
  elements.resultTableWrap.replaceChildren();
  elements.resultTableWrap.hidden = true;
  elements.resultSummary.textContent = "有効な条件になると、グラフと同じ集計結果を表で確認できます。";
  updateControlAvailability();
}

function markChartPending() {
  state.isChartCurrent = false;
  updateControlAvailability();
}

function validateChartConfig() {
  clearFieldErrors();
  if (!state.dataset) return "CSVファイルを読み込んでください。";
  if (!state.chartLibraryReady || typeof window.Chart !== "function") {
    state.chartLibraryReady = false;
    return "グラフ機能を読み込めませんでした。ページを再読み込みしてください。";
  }
  if (!CHART_TYPES.has(state.config.chartType)) return "グラフ種類を選択してください。";
  if (!AGGREGATIONS.has(state.config.aggregation)) return "集計方法を選択してください。";
  if (!state.dataset.headers.includes(state.config.xColumn)) {
    showFieldError(elements.xColumn, elements.xColumnError, "X軸／カテゴリ項目を選択してください。");
    return "X軸／カテゴリ項目を確認してください。";
  }
  if (state.dataset.columnTypes[state.config.yColumn] !== "number") {
    showFieldError(elements.yColumn, elements.yColumnError, "数値列を選択してください。");
    return "Y軸／数値項目を確認してください。";
  }
  if (state.filteredRows.length === 0) return "絞り込み結果が0件です。条件を変更してください。";
  return "";
}

function parseFiniteNumber(rawValue) {
  const value = rawValue.trim();
  if (value === "" || !NUMBER_PATTERN.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function aggregateData() {
  const xIndex = state.dataset.headers.indexOf(state.config.xColumn);
  const yIndex = state.dataset.headers.indexOf(state.config.yColumn);
  const groups = new Map();

  state.filteredRows.forEach((row) => {
    const normalizedLabel = normalizeCategory(row[xIndex]);
    if (!groups.has(normalizedLabel)) {
      groups.set(normalizedLabel, {
        label: displayCategory(normalizedLabel),
        sum: 0,
        sourceRowCount: 0,
        validNumberCount: 0,
      });
    }
    const group = groups.get(normalizedLabel);
    group.sourceRowCount += 1;
    const numericValue = parseFiniteNumber(row[yIndex]);
    if (numericValue !== null) {
      group.sum += numericValue;
      group.validNumberCount += 1;
    }
  });

  return Array.from(groups.values()).map((group) => {
    let value;
    if (state.config.aggregation === "count") {
      value = group.sourceRowCount;
      group.validNumberCount = group.sourceRowCount;
    } else if (group.validNumberCount === 0) {
      value = null;
    } else if (state.config.aggregation === "average") {
      value = group.sum / group.validNumberCount;
    } else {
      value = group.sum;
    }

    if (value !== null && !Number.isFinite(value)) {
      throw new Error("集計結果が有限数ではありません。値を確認してください。");
    }
    return {
      label: group.label,
      value,
      sourceRowCount: group.sourceRowCount,
      validNumberCount: group.validNumberCount,
    };
  });
}

function validateAggregateRows(rows) {
  const validValues = rows.filter((row) => row.value !== null);
  if (validValues.length === 0) {
    return "選択した条件には集計できる数値がありません。";
  }
  if (state.config.chartType === "pie") {
    if (rows.some((row) => row.value === null)) {
      return "円グラフにはデータなしの区分を使用できません。設定を変更するか、棒・折れ線グラフを選択してください。";
    }
    if (rows.some((row) => row.value < 0)) {
      return "円グラフには負の値を使用できません。設定を変更するか、棒・折れ線グラフを選択してください。";
    }
    if (!rows.some((row) => row.value > 0)) {
      return "円グラフには少なくとも1つ、0より大きい値が必要です。";
    }
  }
  return "";
}

function aggregationLabel() {
  return { sum: "合計", average: "平均", count: "件数" }[state.config.aggregation];
}

function chartTypeLabel() {
  return { bar: "棒グラフ", line: "折れ線グラフ", pie: "円グラフ" }[state.config.chartType];
}

function formatAggregateValue(value) {
  if (value === null) return "データなし";
  return state.config.aggregation === "average"
    ? AVERAGE_FORMATTER.format(value)
    : NUMBER_FORMATTER.format(value);
}

const opaqueBackgroundPlugin = {
  id: "opaqueBackground",
  beforeDraw(chart) {
    const { ctx, width, height } = chart;
    ctx.save();
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  },
};

function buildChartConfiguration(rows) {
  const isPie = state.config.chartType === "pie";
  const title = state.config.title.trim();
  const datasetLabel = state.config.aggregation === "count"
    ? `${state.config.xColumn}の件数`
    : `${state.config.yColumn}（${aggregationLabel()}）`;
  const colors = rows.map((_, index) => CHART_COLORS[index % CHART_COLORS.length]);

  const dataset = {
    label: datasetLabel,
    data: rows.map((row) => row.value),
    backgroundColor: isPie ? colors : "rgba(40, 122, 128, 0.72)",
    borderColor: isPie ? "#ffffff" : "#176b78",
    borderWidth: isPie ? 2 : 2,
  };

  if (state.config.chartType === "line") {
    dataset.backgroundColor = "rgba(40, 122, 128, 0.18)";
    dataset.pointBackgroundColor = "#ffffff";
    dataset.pointBorderColor = "#176b78";
    dataset.pointRadius = 4;
    dataset.pointHoverRadius = 6;
    dataset.tension = 0;
    dataset.fill = false;
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    normalized: true,
    plugins: {
      legend: {
        display: state.config.showLegend,
        position: "bottom",
        labels: { color: "#334e5a", boxWidth: 14, padding: 16 },
      },
      title: {
        display: Boolean(title),
        text: title,
        color: "#172b36",
        font: { size: 17, weight: "bold" },
        padding: { bottom: 18 },
      },
      tooltip: {
        callbacks: {
          label(context) {
            const label = isPie && context.label ? `${context.label}: ` : `${datasetLabel}: `;
            return `${label}${formatAggregateValue(context.raw)}`;
          },
        },
      },
    },
  };

  if (!isPie) {
    options.scales = {
      x: {
        title: { display: true, text: state.config.xColumn, color: "#425e69" },
        ticks: { color: "#526b76", maxRotation: 45, minRotation: 0 },
        grid: { display: false },
      },
      y: {
        beginAtZero: false,
        title: {
          display: true,
          text: state.config.aggregation === "count"
            ? "件数"
            : `${state.config.yColumn}（${aggregationLabel()}）`,
          color: "#425e69",
        },
        ticks: {
          color: "#526b76",
          callback(value) { return NUMBER_FORMATTER.format(value); },
        },
        grid: { color: "#e5ecef" },
      },
    };
  }

  return {
    type: state.config.chartType,
    data: { labels: rows.map((row) => row.label), datasets: [dataset] },
    options,
    plugins: [opaqueBackgroundPlugin],
  };
}

function renderAggregateTable(rows) {
  const headers = [state.config.xColumn, aggregationLabel(), "対象行数", "有効数値件数"];
  const tableRows = rows.map((row) => [
    row.label,
    formatAggregateValue(row.value),
    NUMBER_FORMATTER.format(row.sourceRowCount),
    NUMBER_FORMATTER.format(row.validNumberCount),
  ]);
  elements.resultTableWrap.replaceChildren(makeTable(headers, tableRows));
  elements.resultTableWrap.hidden = false;
  const yDescription = state.config.aggregation === "count"
    ? "件数ではY軸の値を計算に使用しません。"
    : `Y軸「${state.config.yColumn}」の有効な数値を使用します。`;
  elements.resultSummary.textContent = `${aggregationLabel()} / 対象${state.filteredRows.length}行。${yDescription}`;
}

function buildCanvasLabel() {
  const title = state.config.title.trim() || "無題のグラフ";
  const common = `${title}。${chartTypeLabel()}、X軸は${state.config.xColumn}`;
  if (state.config.aggregation === "count") return `${common}、件数集計です。`;
  return `${common}、Y軸は${state.config.yColumn}、集計方法は${aggregationLabel()}です。`;
}

function createChart({ announceSuccess = true } = {}) {
  if (state.isLoading) return false;
  readConfigFromControls();
  const configError = validateChartConfig();
  if (configError) {
    invalidateChart(configError);
    setNotification("error", configError);
    updateControlAvailability();
    return false;
  }

  let aggregateRows;
  try {
    aggregateRows = aggregateData();
  } catch (error) {
    invalidateChart("集計中にエラーが発生しました。");
    setNotification("error", error instanceof Error ? error.message : "集計に失敗しました。");
    return false;
  }

  const aggregateError = validateAggregateRows(aggregateRows);
  if (aggregateError) {
    invalidateChart("現在の条件ではグラフを作成できません。");
    setNotification("error", aggregateError);
    return false;
  }

  try {
    if (state.chartInstance) {
      state.chartInstance.destroy();
      state.chartInstance = null;
    }
    elements.chartMessage.hidden = true;
    elements.canvas.hidden = false;
    const context = elements.canvas.getContext("2d");
    if (!context) throw new Error("グラフの描画領域を利用できません。");
    state.chartInstance = new window.Chart(context, buildChartConfiguration(aggregateRows));
    state.aggregateRows = aggregateRows;
    state.isChartCurrent = true;
    elements.canvas.setAttribute("aria-label", buildCanvasLabel());
    renderAggregateTable(aggregateRows);
    updateControlAvailability();
    if (announceSuccess) setNotification("success", `${chartTypeLabel()}を更新しました。`);
    return true;
  } catch (error) {
    if (state.chartInstance) state.chartInstance.destroy();
    state.chartInstance = null;
    state.aggregateRows = [];
    state.isChartCurrent = false;
    elements.canvas.hidden = true;
    elements.chartMessage.hidden = false;
    elements.chartMessage.textContent = "グラフを作成できませんでした。";
    updateControlAvailability();
    setNotification("error", error instanceof Error ? error.message : "グラフの作成に失敗しました。");
    return false;
  }
}

function sanitizeFileName(title) {
  let base = title.trim() || "data-visualizer";
  base = base.replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, "_");
  base = base.replace(/[ .]+$/g, "");
  base = Array.from(base).slice(0, 80).join("");
  return `${base || "data-visualizer"}.png`;
}

function savePng() {
  if (!state.isChartCurrent || !state.chartInstance || state.isLoading) {
    setNotification("warning", "現在の設定でグラフを正常に更新してからPNGを保存してください。");
    return;
  }

  try {
    elements.canvas.toBlob((blob) => {
      if (!blob) {
        setNotification("error", "PNG画像を生成できませんでした。もう一度お試しください。");
        return;
      }
      let objectUrl = "";
      try {
        objectUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = sanitizeFileName(state.config.title);
        link.hidden = true;
        document.body.append(link);
        link.click();
        link.remove();
        setNotification("success", `${link.download} を保存しました。`);
      } catch (_error) {
        setNotification("error", "PNGを保存できませんでした。グラフを維持したまま再試行できます。");
      } finally {
        if (objectUrl) window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      }
    }, "image/png");
  } catch (_error) {
    setNotification("error", "PNGを保存できませんでした。グラフを維持したまま再試行できます。");
  }
}

function determineColumnTypes(headers, rows) {
  const types = Object.create(null);
  headers.forEach((header, columnIndex) => {
    let hasValue = false;
    let allNumeric = true;
    for (const row of rows) {
      const trimmed = row[columnIndex].trim();
      if (trimmed === "") continue;
      hasValue = true;
      if (parseFiniteNumber(trimmed) === null) {
        allNumeric = false;
        break;
      }
    }
    types[header] = hasValue && allNumeric ? "number" : "text";
  });
  return types;
}

function csvError(message, lineNumber = null) {
  const suffix = lineNumber === null ? "" : `（${lineNumber}行目）`;
  return new Error(`${message}${suffix}`);
}

function parseCsv(text) {
  const records = [];
  let row = [];
  let field = "";
  let mode = "start";
  let lineNumber = 1;
  let rowLineNumber = 1;

  function finishField() {
    row.push(field);
    field = "";
    mode = "start";
  }

  function finishRow() {
    finishField();
    records.push({ fields: row, lineNumber: rowLineNumber });
    row = [];
    rowLineNumber = lineNumber + 1;
  }

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (mode === "quoted") {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          mode = "afterQuote";
        }
      } else if (character === "\r" || character === "\n") {
        throw csvError("ダブルクォート内の改行には対応していません。", lineNumber);
      } else {
        field += character;
      }
      continue;
    }

    if (mode === "afterQuote") {
      if (character === ",") {
        finishField();
      } else if (character === "\n") {
        finishRow();
        lineNumber += 1;
        rowLineNumber = lineNumber;
      } else if (character === "\r") {
        if (text[index + 1] !== "\n") throw csvError("CR単独の改行は使用できません。", lineNumber);
        finishRow();
        index += 1;
        lineNumber += 1;
        rowLineNumber = lineNumber;
      } else {
        throw csvError("閉じダブルクォートの後に使用できない文字があります。", lineNumber);
      }
      continue;
    }

    if (character === '"') {
      if (mode !== "start") throw csvError("ダブルクォートの位置が不正です。", lineNumber);
      mode = "quoted";
    } else if (character === ",") {
      finishField();
    } else if (character === "\n") {
      finishRow();
      lineNumber += 1;
      rowLineNumber = lineNumber;
    } else if (character === "\r") {
      if (text[index + 1] !== "\n") throw csvError("CR単独の改行は使用できません。", lineNumber);
      finishRow();
      index += 1;
      lineNumber += 1;
      rowLineNumber = lineNumber;
    } else {
      field += character;
      mode = "unquoted";
    }
  }

  if (mode === "quoted") throw csvError("閉じられていないダブルクォートがあります。", lineNumber);
  finishRow();

  const nonBlankRecords = records.filter(({ fields }) => !fields.every((value) => value.trim() === ""));
  if (nonBlankRecords.length === 0) throw new Error("CSVファイルが空です。");

  const headerRecord = nonBlankRecords[0];
  const headers = headerRecord.fields.map((header) => header.trim());
  if (headers.length > LIMITS.columns) throw new Error(`列数が上限の${LIMITS.columns}列を超えています。`);
  if (headers.some((header) => header === "")) throw csvError("空のヘッダー名があります。", headerRecord.lineNumber);
  if (new Set(headers).size !== headers.length) throw csvError("重複するヘッダー名があります。", headerRecord.lineNumber);

  const dataRecords = nonBlankRecords.slice(1);
  if (dataRecords.length === 0) throw new Error("データ行がありません。");
  if (dataRecords.length > LIMITS.dataRows) {
    throw new Error(`データ行数が上限の${LIMITS.dataRows.toLocaleString("ja-JP")}行を超えています。`);
  }

  dataRecords.forEach((record) => {
    if (record.fields.length !== headers.length) {
      throw csvError(`列数が一致しません。期待値は${headers.length}列、実際は${record.fields.length}列です。`, record.lineNumber);
    }
  });

  return { headers, rows: dataRecords.map((record) => record.fields) };
}

async function loadCsvFile(file) {
  if (state.isLoading || !file) return;
  if (!/\.csv$/i.test(file.name)) {
    state.loadStatus = "error";
    setNotification("error", "拡張子が.csvのファイルを選択してください。");
    elements.fileInput.value = "";
    return;
  }
  if (file.size === 0) {
    state.loadStatus = "error";
    setNotification("error", "CSVファイルが空です。");
    elements.fileInput.value = "";
    return;
  }
  if (file.size > LIMITS.fileBytes) {
    state.loadStatus = "error";
    setNotification("error", "ファイルサイズが上限の5 MiBを超えています。");
    elements.fileInput.value = "";
    return;
  }

  setLoading(true);
  state.loadStatus = "loading";
  setNotification("info", `${file.name} を読み込んでいます。`);

  try {
    const bytes = await file.arrayBuffer();
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (_error) {
      throw new Error("UTF-8として読み取れないファイルです。");
    }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const parsed = parseCsv(text);
    const dataset = {
      fileName: file.name,
      fileSize: file.size,
      headers: parsed.headers,
      rows: parsed.rows,
      columnTypes: determineColumnTypes(parsed.headers, parsed.rows),
    };

    invalidateChart("読み込んだデータからグラフを準備しています。");
    state.dataset = dataset;
    state.filteredRows = dataset.rows.slice();
    state.loadStatus = "loaded";
    setPreviewExpanded(false);
    initializeSettings(dataset);
    renderStats();
    renderPreview();
    applyFilter();
    setLoading(false);

    const numericColumns = getColumnsByType("number");
    if (numericColumns.length === 0) {
      setNotification("error", "数値として扱える列がありません。データはプレビューできますが、グラフは作成できません。");
    } else if (!state.chartLibraryReady) {
      setNotification("error", "CSVは読み込みましたが、グラフ機能を読み込めませんでした。");
    } else {
      const created = createChart({ announceSuccess: false });
      if (created) setNotification("success", `${file.name} を読み込み、初期グラフを表示しました。`);
    }
  } catch (error) {
    state.loadStatus = "error";
    setNotification("error", error instanceof Error ? error.message : "CSVファイルを読み込めませんでした。");
  } finally {
    setLoading(false);
    elements.fileInput.value = "";
    renderStats();
  }
}

function handleFilterColumnChange() {
  readConfigFromControls();
  state.config.filterValue = ALL_FILTER_VALUE;
  rebuildFilterValues();
  applyFilter();
  createChart({ announceSuccess: false });
}

function handleFilterValueChange() {
  readConfigFromControls();
  applyFilter();
  createChart({ announceSuccess: false });
}

function handleGraphSettingChange() {
  readConfigFromControls();
  clearFieldErrors();
  createChart({ announceSuccess: false });
}

function cancelTitleUpdate() {
  if (titleUpdateTimer !== null) {
    window.clearTimeout(titleUpdateTimer);
    titleUpdateTimer = null;
  }
}

function scheduleTitleUpdate() {
  readConfigFromControls();
  markChartPending();
  cancelTitleUpdate();
  titleUpdateTimer = window.setTimeout(() => {
    titleUpdateTimer = null;
    createChart({ announceSuccess: false });
  }, 300);
}

function handleTitleInput() {
  if (!isTitleComposing) scheduleTitleUpdate();
}

elements.fileInput.addEventListener("change", (event) => {
  const [file] = event.target.files;
  loadCsvFile(file);
});
elements.filterColumn.addEventListener("change", handleFilterColumnChange);
elements.filterValue.addEventListener("change", handleFilterValueChange);
[elements.chartType, elements.aggregation, elements.xColumn, elements.yColumn, elements.showLegend]
  .forEach((control) => control.addEventListener("change", handleGraphSettingChange));
elements.chartTitle.addEventListener("compositionstart", () => {
  isTitleComposing = true;
  cancelTitleUpdate();
  readConfigFromControls();
  markChartPending();
});
elements.chartTitle.addEventListener("compositionend", () => {
  isTitleComposing = false;
  scheduleTitleUpdate();
});
elements.chartTitle.addEventListener("input", handleTitleInput);
elements.createChart.addEventListener("click", () => {
  cancelTitleUpdate();
  createChart({ announceSuccess: true });
});
elements.savePng.addEventListener("click", savePng);
elements.previewToggle.addEventListener("click", togglePreview);

renderStats();
renderPreview();
updateControlAvailability();
if (!state.chartLibraryReady) {
  setNotification("error", "グラフ機能を読み込めませんでした。CSVのプレビューは引き続き利用できます。");
}
