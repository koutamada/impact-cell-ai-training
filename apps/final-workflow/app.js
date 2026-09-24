(() => {
  "use strict";

  const ROLE_LABELS = {
    requester: "一般ユーザー",
    approver: "承認者",
    worker: "作業担当者",
    admin: "管理者"
  };
  const STATUS_LABELS = {
    draft: "下書き",
    pending_approval: "承認待ち",
    approved: "承認済み",
    in_progress: "対応中",
    completed: "完了",
    rejected: "却下",
    returned: "差し戻し"
  };
  const PRIORITY_LABELS = { low: "低", normal: "通常", high: "高", urgent: "緊急" };
  const ALLOWED_FILES = new Set(["image/jpeg", "image/png", "application/pdf"]);
  const MAX_FILE_SIZE = 10 * 1024 * 1024;
  const elements = Object.fromEntries(Array.from(document.querySelectorAll("[id]"), (node) => [node.id, node]));
  const state = {
    client: null,
    user: null,
    context: null,
    categories: [],
    users: [],
    requests: [],
    notifications: [],
    currentView: "dashboard",
    busy: false,
    detailId: null
  };

  const config = validateConfig(window.APP_CONFIG);
  if (!config || !window.supabase?.createClient) {
    elements["login-error"].textContent = "接続設定を確認してください。";
    elements["login-error"].hidden = false;
    elements["login-button"].disabled = true;
    return;
  }

  state.client = window.supabase.createClient(config.url, config.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  bindEvents();
  initialize();

  async function initialize() {
    const { data, error } = await state.client.auth.getSession();
    if (error || !data.session) {
      showAuth();
      return;
    }
    await applySession(data.session);
  }

  function bindEvents() {
    elements["login-form"].addEventListener("submit", login);
    elements["logout-button"].addEventListener("click", logout);
    elements["notification-button"].addEventListener("click", () => navigate("notifications"));
    elements["main-nav"].addEventListener("click", (event) => {
      const button = event.target.closest("[data-view]");
      if (button) navigate(button.dataset.view);
    });
    document.addEventListener("click", (event) => {
      const closer = event.target.closest("[data-close-dialog]");
      if (closer) elements[closer.dataset.closeDialog]?.close();
    });
    elements["request-form"].addEventListener("submit", saveRequest);
    elements["request-description"].addEventListener("input", updateDescriptionCount);
    window.addEventListener("hashchange", () => {
      const view = location.hash.replace(/^#/, "");
      if (view) navigate(view, false);
    });
    state.client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") showAuth();
      if (event === "SIGNED_IN" && session && !state.user) {
        window.setTimeout(() => applySession(session), 0);
      }
    });
  }

  async function login(event) {
    event.preventDefault();
    setBusy(true);
    setFormError(elements["login-error"], "");
    const email = elements["login-email"].value.trim();
    const password = elements["login-password"].value;
    if (!email || !password) {
      setFormError(elements["login-error"], "メールアドレスとパスワードを入力してください。");
      setBusy(false);
      return;
    }
    const { data, error } = await state.client.auth.signInWithPassword({ email, password });
    if (error) {
      setFormError(elements["login-error"], "ログインできませんでした。入力内容を確認してください。");
      setBusy(false);
      return;
    }
    await applySession(data.session);
    setBusy(false);
  }

  async function logout() {
    if (state.busy) return;
    setBusy(true);
    await state.client.auth.signOut();
    state.user = null;
    state.context = null;
    state.requests = [];
    showAuth();
    setBusy(false);
  }

  async function applySession(session) {
    if (!session?.user) {
      showAuth();
      return;
    }
    state.user = session.user;
    try {
      const { data, error } = await state.client.rpc("workflow_get_my_context");
      if (error) throw error;
      state.context = data;
      await Promise.all([loadReferenceData(), loadNotifications()]);
      configureNavigation();
      elements["header-user-name"].textContent = state.context.display_name;
      elements["header-user-role"].textContent = ROLE_LABELS[state.context.role] || state.context.role;
      elements["auth-view"].hidden = true;
      elements["system-view"].hidden = false;
      const requestedView = location.hash.replace(/^#/, "") || "dashboard";
      await navigate(requestedView, false);
    } catch (error) {
      console.error(error);
      await state.client.auth.signOut();
      showAuth();
      setFormError(elements["login-error"], "このアカウントは業務システムを利用できません。管理者へ確認してください。");
    }
  }

  function showAuth() {
    elements["system-view"].hidden = true;
    elements["auth-view"].hidden = false;
    elements["login-password"].value = "";
  }

  function configureNavigation() {
    document.querySelectorAll("[data-role]").forEach((node) => {
      node.hidden = node.dataset.role !== state.context.role;
    });
  }

  async function loadReferenceData() {
    const [categoriesResult, usersResult] = await Promise.all([
      state.client.from("workflow_categories").select("id,name,sort_order,is_active").order("sort_order"),
      state.client.from("workflow_users").select("id,display_name,role,department_id,is_active").order("display_name")
    ]);
    if (categoriesResult.error) throw categoriesResult.error;
    if (usersResult.error) throw usersResult.error;
    state.categories = categoriesResult.data || [];
    state.users = usersResult.data || [];
  }

  async function loadRequests() {
    const { data, error } = await state.client
      .from("workflow_requests")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1000);
    if (error) throw error;
    state.requests = data || [];
  }

  async function loadNotifications() {
    const { data, error } = await state.client
      .from("workflow_notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    state.notifications = data || [];
    updateNotificationBadge();
  }

  function updateNotificationBadge() {
    const count = state.notifications.filter((item) => !item.is_read).length;
    elements["notification-count"].textContent = String(count);
    elements["notification-count"].hidden = count === 0;
  }

  async function navigate(view, updateHash = true) {
    if (!state.context) return;
    const allowed = new Set(["dashboard", "requests", "notifications"]);
    if (state.context.role === "approver") allowed.add("approvals");
    if (state.context.role === "worker") allowed.add("assignments");
    if (state.context.role === "admin") allowed.add("admin");
    if (!allowed.has(view)) view = "dashboard";
    state.currentView = view;
    if (updateHash) history.replaceState(null, "", `#${view}`);
    document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
    elements["main-content"].replaceChildren(textNode("div", "読み込み中…", "loading-panel"));
    elements["main-content"].focus();
    try {
      if (view === "dashboard") await renderDashboard();
      else if (["requests", "approvals", "assignments"].includes(view)) await renderRequestList(view);
      else if (view === "notifications") await renderNotifications();
      else if (view === "admin") await renderAdminOverview();
    } catch (error) {
      console.error(error);
      renderError(elements["main-content"], errorMessage(error));
    }
  }

  async function renderDashboard() {
    const [{ data: stats, error }, requestsResult] = await Promise.all([
      state.client.rpc("workflow_get_dashboard_stats"),
      state.client.from("workflow_requests").select("*").order("updated_at", { ascending: false }).limit(6)
    ]);
    if (error) throw error;
    if (requestsResult.error) throw requestsResult.error;
    const definitions = dashboardDefinitions(state.context.role, stats || {});
    const main = elements["main-content"];
    main.textContent = "";
    main.append(pageHeader("ダッシュボード", `${state.context.display_name}さんに必要な情報を表示しています。`, state.context.role === "requester" ? createButton("新しい依頼", "primary", openCreateDialog) : null));
    const grid = node("div", "stat-grid");
    definitions.forEach((item) => {
      const card = node("article", "stat-card");
      card.append(textNode("span", item.label), textNode("strong", String(item.value ?? 0)));
      grid.append(card);
    });
    main.append(grid);
    const panel = node("section", "panel");
    const heading = node("div", "panel-header");
    heading.append(textNode("h2", "最近の案件"), createButton("一覧を見る", "ghost small", () => navigate("requests")));
    panel.append(heading);
    panel.append(buildRequestTable(requestsResult.data || []));
    main.append(panel);
  }

  function dashboardDefinitions(role, stats) {
    if (role === "requester") return [
      { label: "自分の申請", value: stats.total },
      { label: "承認待ち", value: stats.pending_approval },
      { label: "対応中", value: stats.in_progress },
      { label: "完了", value: stats.completed }
    ];
    if (role === "approver") return [
      { label: "承認待ち", value: stats.pending_approval },
      { label: "高・緊急", value: stats.high_priority },
      { label: "3日以内の期限", value: stats.due_within_3_days }
    ];
    if (role === "worker") return [
      { label: "未着手", value: stats.not_started },
      { label: "対応中", value: stats.in_progress },
      { label: "期限超過", value: stats.overdue }
    ];
    return [
      { label: "全案件", value: stats.total },
      { label: "承認待ち", value: stats.pending_approval },
      { label: "未割り当て", value: stats.unassigned },
      { label: "期限超過", value: stats.overdue }
    ];
  }

  async function renderRequestList(view) {
    await loadRequests();
    let title = "案件一覧";
    let description = "閲覧権限のある案件だけが表示されます。";
    if (view === "approvals") { title = "承認待ち"; description = "判断が必要な案件を確認します。"; }
    if (view === "assignments") { title = "担当案件"; description = "自分に割り当てられた案件を確認します。"; }
    const main = elements["main-content"];
    main.textContent = "";
    main.append(pageHeader(title, description, state.context.role === "requester" && view === "requests" ? createButton("新しい依頼", "primary", openCreateDialog) : null));
    const filters = buildFilters();
    const tableHost = node("div");
    main.append(filters.root, tableHost);
    const refresh = () => {
      let rows = filterRequests(state.requests, filters.values());
      if (view === "approvals") rows = rows.filter((item) => item.status === "pending_approval");
      if (view === "assignments") rows = rows.filter((item) => item.assignee_id === state.user.id);
      tableHost.replaceChildren(buildRequestTable(rows));
    };
    filters.root.addEventListener("input", refresh);
    filters.root.addEventListener("change", refresh);
    refresh();
  }

  function buildFilters() {
    const root = node("div", "filter-bar");
    const keyword = input("search", "キーワード検索");
    const status = selectWithOptions([{ value: "", label: "すべての状態" }, ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))]);
    const category = selectWithOptions([{ value: "", label: "すべてのカテゴリ" }, ...state.categories.map((item) => ({ value: item.id, label: item.name }))]);
    const priority = selectWithOptions([{ value: "", label: "すべての優先度" }, ...Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label }))]);
    const assignee = selectWithOptions([{ value: "", label: "すべての担当者" }, ...state.users.filter((item) => item.role === "worker").map((item) => ({ value: item.id, label: item.display_name }))]);
    const dueFrom = input("date", "");
    dueFrom.setAttribute("aria-label", "期限（開始）");
    dueFrom.title = "期限（開始）";
    const dueTo = input("date", "");
    dueTo.setAttribute("aria-label", "期限（終了）");
    dueTo.title = "期限（終了）";
    root.append(keyword, status, category, priority, assignee, dueFrom, dueTo);
    return { root, values: () => ({ keyword: keyword.value.trim().toLowerCase(), status: status.value, category: category.value, priority: priority.value, assignee: assignee.value, dueFrom: dueFrom.value, dueTo: dueTo.value }) };
  }

  function filterRequests(rows, filters) {
    return rows.filter((item) => {
      if (filters.keyword && !`${item.title} ${item.description}`.toLowerCase().includes(filters.keyword)) return false;
      if (filters.status && item.status !== filters.status) return false;
      if (filters.category && item.category_id !== filters.category) return false;
      if (filters.priority && item.priority !== filters.priority) return false;
      if (filters.assignee && item.assignee_id !== filters.assignee) return false;
      if (filters.dueFrom && item.desired_due_date < filters.dueFrom) return false;
      if (filters.dueTo && item.desired_due_date > filters.dueTo) return false;
      return true;
    });
  }

  function buildRequestTable(rows) {
    if (!rows.length) return textNode("div", "表示する案件はありません。", "empty-state");
    const wrap = node("div", "table-wrap");
    const table = document.createElement("table");
    const head = document.createElement("thead");
    const headerRow = document.createElement("tr");
    ["番号", "タイトル", "状態", "優先度", "期限", "申請者", "担当者"].forEach((label) => headerRow.append(textNode("th", label)));
    head.append(headerRow);
    const body = document.createElement("tbody");
    rows.forEach((item) => {
      const row = document.createElement("tr");
      row.append(textNode("td", `#${item.request_number}`));
      const titleCell = document.createElement("td");
      const button = textNode("button", item.title, "request-link");
      button.type = "button";
      button.addEventListener("click", () => openDetail(item.id));
      titleCell.append(button);
      row.append(titleCell);
      row.append(badgeCell(STATUS_LABELS[item.status], `status-${item.status}`));
      row.append(badgeCell(PRIORITY_LABELS[item.priority], `priority-${item.priority}`));
      row.append(textNode("td", formatDate(item.desired_due_date)));
      row.append(textNode("td", userName(item.requester_id)));
      row.append(textNode("td", item.assignee_id ? userName(item.assignee_id) : "未割り当て"));
      body.append(row);
    });
    table.append(head, body);
    wrap.append(table);
    return wrap;
  }

  function openCreateDialog() {
    elements["request-form"].reset();
    elements["request-id"].value = "";
    elements["request-version"].value = "";
    elements["request-dialog-title"].textContent = "新しい依頼";
    elements["request-save-button"].textContent = "下書きを保存";
    populateCategorySelect();
    setFormError(elements["request-form-error"], "");
    updateDescriptionCount();
    elements["request-dialog"].showModal();
    elements["request-title"].focus();
  }

  function openEditDialog(request) {
    elements["request-id"].value = request.id;
    elements["request-version"].value = String(request.version);
    elements["request-dialog-title"].textContent = "依頼を編集";
    elements["request-save-button"].textContent = "変更を保存";
    populateCategorySelect(request.category_id);
    elements["request-title"].value = request.title;
    elements["request-description"].value = request.description;
    elements["request-priority"].value = request.priority;
    elements["request-due-date"].value = request.desired_due_date;
    setFormError(elements["request-form-error"], "");
    updateDescriptionCount();
    elements["detail-dialog"].close();
    elements["request-dialog"].showModal();
  }

  function populateCategorySelect(selected = "") {
    elements["request-category"].textContent = "";
    state.categories.filter((item) => item.is_active).forEach((item) => {
      const option = new Option(item.name, item.id, false, item.id === selected);
      elements["request-category"].append(option);
    });
  }

  async function saveRequest(event) {
    event.preventDefault();
    if (state.busy) return;
    setBusy(true);
    setFormError(elements["request-form-error"], "");
    const requestId = elements["request-id"].value;
    const args = {
      p_title: elements["request-title"].value.trim(),
      p_description: elements["request-description"].value.trim(),
      p_category_id: elements["request-category"].value,
      p_priority: elements["request-priority"].value,
      p_desired_due_date: elements["request-due-date"].value
    };
    if (!args.p_title || !args.p_description || !args.p_category_id || !args.p_desired_due_date) {
      setFormError(elements["request-form-error"], "必須項目を入力してください。");
      setBusy(false);
      return;
    }
    if (requestId) {
      args.p_request_id = requestId;
      args.p_expected_version = Number(elements["request-version"].value);
    }
    const { data, error } = await state.client.rpc(requestId ? "workflow_update_request" : "workflow_create_request", args);
    setBusy(false);
    if (error) {
      setFormError(elements["request-form-error"], errorMessage(error));
      return;
    }
    elements["request-dialog"].close();
    showToast(requestId ? "依頼を更新しました。" : "下書きを作成しました。");
    await navigate("requests", false);
    if (data?.id) await openDetail(data.id);
  }

  async function openDetail(requestId) {
    state.detailId = requestId;
    elements["detail-content"].replaceChildren(textNode("div", "読み込み中…", "loading-panel"));
    elements["detail-dialog"].showModal();
    try {
      const [requestResult, commentsResult, approvalsResult, attachmentsResult, auditResult] = await Promise.all([
        state.client.from("workflow_requests").select("*").eq("id", requestId).maybeSingle(),
        state.client.from("workflow_comments").select("*").eq("request_id", requestId).order("created_at"),
        state.client.from("workflow_approval_records").select("*").eq("request_id", requestId).order("created_at"),
        state.client.from("workflow_attachments").select("*").eq("request_id", requestId).order("created_at"),
        state.client.from("workflow_audit_logs").select("*").eq("request_id", requestId).order("created_at", { ascending: false })
      ]);
      const error = requestResult.error || commentsResult.error || approvalsResult.error || attachmentsResult.error || auditResult.error;
      if (error) throw error;
      if (!requestResult.data) throw new Error("workflow_request_unavailable");
      renderDetail(requestResult.data, commentsResult.data || [], approvalsResult.data || [], attachmentsResult.data || [], auditResult.data || []);
    } catch (error) {
      console.error(error);
      renderError(elements["detail-content"], "案件が存在しないか、閲覧権限がありません。");
    }
  }

  function renderDetail(request, comments, approvals, attachments, audits) {
    elements["detail-number"].textContent = `REQUEST #${request.request_number}`;
    elements["detail-title"].textContent = request.title;
    const host = elements["detail-content"];
    host.textContent = "";
    const actions = buildActionRow(request);
    if (actions.childElementCount) host.append(actions);

    const overview = section("案件情報");
    const grid = node("div", "detail-grid");
    [
      ["状態", STATUS_LABELS[request.status]], ["優先度", PRIORITY_LABELS[request.priority]],
      ["カテゴリ", categoryName(request.category_id)], ["希望期限", formatDate(request.desired_due_date)],
      ["申請者", userName(request.requester_id)], ["担当者", request.assignee_id ? userName(request.assignee_id) : "未割り当て"]
    ].forEach(([label, value]) => {
      const field = node("div", "detail-field");
      field.append(textNode("span", label), textNode("strong", value));
      grid.append(field);
    });
    overview.append(grid, textNode("p", request.description, "detail-description"));
    host.append(overview);

    host.append(buildAttachmentSection(request, attachments));
    host.append(buildCommentSection(request, comments));
    if (approvals.length) host.append(buildApprovalSection(approvals));
    host.append(buildAuditSection(audits));
  }

  function buildActionRow(request) {
    const row = node("div", "action-row");
    const role = state.context.role;
    if (role === "requester" && request.requester_id === state.user.id && ["draft", "returned"].includes(request.status)) {
      row.append(createButton("編集", "ghost", () => openEditDialog(request)));
      row.append(createButton(request.status === "returned" ? "再申請" : "承認申請", "primary", () => runRequestAction("workflow_submit_request", request, {}, "申請しました。")));
      row.append(createButton("削除", "danger", () => deleteRequest(request)));
    }
    if (role === "approver" && request.approver_id === state.user.id && request.status === "pending_approval") {
      row.append(createButton("承認", "primary", () => runRequestAction("workflow_approve_request", request, {}, "承認しました。")));
      row.append(createButton("差し戻し", "ghost", () => reasonAction("workflow_return_request", request, "差し戻し理由")));
      row.append(createButton("却下", "danger", () => reasonAction("workflow_reject_request", request, "却下理由")));
    }
    if (role === "admin" && ["approved", "in_progress"].includes(request.status)) row.append(buildAssigneeControl(request));
    if (role === "worker" && request.assignee_id === state.user.id && request.status === "approved") {
      row.append(createButton("作業を開始", "primary", () => runRequestAction("workflow_start_request", request, {}, "対応を開始しました。")));
    }
    if (role === "worker" && request.assignee_id === state.user.id && request.status === "in_progress") {
      row.append(createButton("作業完了", "primary", () => runRequestAction("workflow_complete_request", request, {}, "完了にしました。")));
    }
    return row;
  }

  function buildAssigneeControl(request) {
    const select = selectWithOptions([{ value: "", label: "担当者を選択" }, ...state.users.filter((item) => item.role === "worker" && item.is_active).map((item) => ({ value: item.id, label: item.display_name }))]);
    select.value = request.assignee_id || "";
    select.setAttribute("aria-label", "担当者");
    const button = createButton(request.assignee_id ? "担当者を変更" : "担当者を設定", "primary", async () => {
      if (!select.value) { showToast("担当者を選択してください。", true); return; }
      await runRequestAction("workflow_assign_request", request, { p_assignee_id: select.value }, "担当者を設定しました。");
    });
    const group = node("div");
    group.style.display = "contents";
    group.append(select, button);
    return group;
  }

  async function runRequestAction(functionName, request, extra, successMessage) {
    if (state.busy) return;
    setBusy(true);
    const { error } = await state.client.rpc(functionName, { p_request_id: request.id, p_expected_version: request.version, ...extra });
    setBusy(false);
    if (error) { showToast(errorMessage(error), true); return; }
    showToast(successMessage);
    await Promise.all([loadNotifications(), openDetail(request.id)]);
  }

  async function reasonAction(functionName, request, label) {
    const reason = window.prompt(`${label}を入力してください。`);
    if (reason === null) return;
    if (!reason.trim()) { showToast(`${label}は必須です。`, true); return; }
    await runRequestAction(functionName, request, { p_reason: reason.trim() }, `${label.replace("理由", "")}処理を行いました。`);
  }

  async function deleteRequest(request) {
    if (!window.confirm("この案件を削除しますか？")) return;
    setBusy(true);
    const { error } = await state.client.rpc("workflow_delete_request", { p_request_id: request.id, p_expected_version: request.version });
    setBusy(false);
    if (error) { showToast(errorMessage(error), true); return; }
    elements["detail-dialog"].close();
    showToast("案件を削除しました。");
    await navigate("requests", false);
  }

  function buildAttachmentSection(request, attachments) {
    const block = section("添付ファイル");
    const list = node("div", "comment-list");
    if (!attachments.length) list.append(textNode("p", "添付ファイルはありません。", "muted"));
    attachments.forEach((attachment) => {
      const item = node("div", "comment");
      const name = textNode("strong", attachment.original_name);
      const download = createButton("ダウンロード", "ghost small", () => downloadAttachment(attachment));
      item.append(name, textNode("p", formatBytes(attachment.size_bytes), "muted"), download);
      if (state.context.role === "requester" && request.requester_id === state.user.id && ["draft", "returned"].includes(request.status)) {
        item.append(createButton("削除", "danger small", () => removeAttachment(attachment)));
      }
      list.append(item);
    });
    block.append(list);
    if (state.context.role === "requester" && request.requester_id === state.user.id && ["draft", "returned"].includes(request.status) && attachments.length < 5) {
      const file = document.createElement("input");
      file.type = "file";
      file.accept = "image/jpeg,image/png,application/pdf";
      file.addEventListener("change", () => { if (file.files[0]) uploadAttachment(request, file.files[0]); });
      block.append(file, textNode("p", "JPEG・PNG・PDF、1ファイル10MiB以下、最大5件", "muted"));
    }
    return block;
  }

  async function uploadAttachment(request, file) {
    if (!ALLOWED_FILES.has(file.type) || file.size < 1 || file.size > MAX_FILE_SIZE) {
      showToast("JPEG・PNG・PDFの10MiB以下のファイルを選択してください。", true);
      return;
    }
    setBusy(true);
    const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-120) || "file";
    const path = `${state.user.id}/${request.id}/${crypto.randomUUID()}-${safeName}`;
    const upload = await state.client.storage.from("workflow-request-attachments").upload(path, file, { contentType: file.type, upsert: false });
    if (upload.error) { setBusy(false); showToast(errorMessage(upload.error), true); return; }
    const { error } = await state.client.rpc("workflow_add_attachment", {
      p_request_id: request.id,
      p_storage_path: path,
      p_original_name: file.name,
      p_mime_type: file.type,
      p_size_bytes: file.size
    });
    if (error) {
      await state.client.storage.from("workflow-request-attachments").remove([path]);
      setBusy(false);
      showToast(errorMessage(error), true);
      return;
    }
    setBusy(false);
    showToast("ファイルを添付しました。");
    await openDetail(request.id);
  }

  async function downloadAttachment(attachment) {
    const { data, error } = await state.client.storage.from("workflow-request-attachments").download(attachment.storage_path);
    if (error) { showToast(errorMessage(error), true); return; }
    const url = URL.createObjectURL(data);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = attachment.original_name;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function removeAttachment(attachment) {
    if (!window.confirm("添付ファイルを削除しますか？")) return;
    setBusy(true);
    const storageResult = await state.client.storage.from("workflow-request-attachments").remove([attachment.storage_path]);
    if (storageResult.error) { setBusy(false); showToast(errorMessage(storageResult.error), true); return; }
    const { error } = await state.client.rpc("workflow_delete_attachment", { p_attachment_id: attachment.id });
    setBusy(false);
    if (error) { showToast("ファイルは削除されましたが、表示情報の更新に失敗しました。再読み込みしてください。", true); return; }
    showToast("添付ファイルを削除しました。");
    await openDetail(attachment.request_id);
  }

  function buildCommentSection(request, comments) {
    const block = section("コメント");
    const list = node("div", "comment-list");
    if (!comments.length) list.append(textNode("p", "コメントはありません。", "muted"));
    comments.forEach((comment) => {
      const item = node("article", "comment");
      const head = node("div", "comment-head");
      head.append(textNode("strong", userName(comment.author_id)), textNode("time", formatDateTime(comment.created_at)));
      item.append(head, textNode("p", comment.body));
      list.append(item);
    });
    const form = node("form", "comment-form");
    const inputElement = document.createElement("textarea");
    inputElement.rows = 2;
    inputElement.maxLength = 2000;
    inputElement.placeholder = "コメントを入力";
    const button = createButton("投稿", "primary", null);
    button.type = "submit";
    form.append(inputElement, button);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = inputElement.value.trim();
      if (!body || state.busy) return;
      setBusy(true);
      const { error } = await state.client.rpc("workflow_add_comment", { p_request_id: request.id, p_body: body });
      setBusy(false);
      if (error) { showToast(errorMessage(error), true); return; }
      showToast("コメントを追加しました。");
      await Promise.all([loadNotifications(), openDetail(request.id)]);
    });
    block.append(list, form);
    return block;
  }

  function buildApprovalSection(approvals) {
    const block = section("承認記録");
    const list = node("div", "timeline");
    approvals.forEach((record) => {
      const item = node("div", "timeline-item");
      const body = node("div");
      body.append(textNode("p", `${userName(record.approver_id)}：${approvalLabel(record.action)}`));
      if (record.reason) body.append(textNode("p", record.reason, "muted"));
      body.append(textNode("small", formatDateTime(record.created_at)));
      item.append(node("span", "timeline-dot"), body);
      list.append(item);
    });
    block.append(list);
    return block;
  }

  function buildAuditSection(audits) {
    const block = section("操作履歴");
    const list = node("div", "timeline");
    if (!audits.length) list.append(textNode("p", "履歴はありません。", "muted"));
    audits.forEach((audit) => {
      const item = node("div", "timeline-item");
      const body = node("div");
      body.append(textNode("p", `${userName(audit.actor_id)}：${audit.summary}`), textNode("small", formatDateTime(audit.created_at)));
      item.append(node("span", "timeline-dot"), body);
      list.append(item);
    });
    block.append(list);
    return block;
  }

  async function renderNotifications() {
    await loadNotifications();
    const main = elements["main-content"];
    main.textContent = "";
    const markAll = createButton("すべて既読", "ghost", markAllNotificationsRead);
    markAll.disabled = !state.notifications.some((item) => !item.is_read);
    main.append(pageHeader("通知", "自分に関係する更新を確認できます。", markAll));
    const list = node("div", "notification-list");
    if (!state.notifications.length) list.append(textNode("div", "通知はありません。", "empty-state"));
    state.notifications.forEach((notification) => {
      const item = node("article", `notification-item${notification.is_read ? "" : " unread"}`);
      item.append(node("span", notification.is_read ? "" : "unread-dot"));
      const body = node("div");
      body.append(textNode("h3", notification.title), textNode("p", notification.body), textNode("p", formatDateTime(notification.created_at)));
      item.append(body);
      const button = createButton(notification.is_read ? "案件を見る" : "確認する", "ghost small", async () => {
        if (!notification.is_read) await markNotificationRead(notification.id);
        if (notification.request_id) await openDetail(notification.request_id);
      });
      item.append(button);
      list.append(item);
    });
    main.append(list);
  }

  async function markNotificationRead(id) {
    const { error } = await state.client.rpc("workflow_mark_notification_read", { p_notification_id: id });
    if (error) { showToast(errorMessage(error), true); return; }
    await loadNotifications();
  }

  async function markAllNotificationsRead() {
    const { error } = await state.client.rpc("workflow_mark_all_notifications_read");
    if (error) { showToast(errorMessage(error), true); return; }
    showToast("すべて既読にしました。");
    await renderNotifications();
  }

  async function renderAdminOverview() {
    const data = await invokeAdmin({ action: "list" });
    const main = elements["main-content"];
    main.textContent = "";
    main.append(pageHeader("管理", "ユーザー・部署・カテゴリと全体状況を管理します。"));
    const grid = node("div", "admin-grid");
    grid.append(
      buildAdminPanel("ユーザー", `${data.users.length}名`, "ユーザーを追加", createAdminUser, buildAdminUsersTable(data)),
      buildAdminPanel("部署", `${data.departments.length}件`, "部署を追加", () => createAdminDepartment(data), buildAdminDepartmentsTable(data)),
      buildAdminPanel("カテゴリ", `${data.categories.length}件`, "カテゴリを追加", createAdminCategory, buildAdminCategoriesTable(data))
    );
    main.append(grid);
  }

  function buildAdminPanel(title, count, buttonLabel, handler, content) {
    const panel = node("section", "panel admin-panel");
    const heading = node("div", "panel-header");
    const copy = node("div");
    copy.append(textNode("h2", title), textNode("span", count, "muted"));
    heading.append(copy, createButton(buttonLabel, "primary small", handler));
    panel.append(heading, content);
    return panel;
  }

  function buildAdminUsersTable(data) {
    return buildAdminTable(["氏名", "メール", "権限", "部署", "状態", ""], data.users.map((user) => [
      user.display_name,
      user.email,
      ROLE_LABELS[user.role] || user.role,
      data.departments.find((item) => item.id === user.department_id)?.name || "—",
      user.is_active ? "有効" : "無効",
      createButton("編集", "ghost small", () => updateAdminUser(user, data))
    ]));
  }

  function buildAdminDepartmentsTable(data) {
    return buildAdminTable(["部署名", "承認者", "状態", ""], data.departments.map((department) => [
      department.name,
      data.users.find((item) => item.id === department.approver_id)?.display_name || "未設定",
      department.is_active ? "有効" : "無効",
      createButton("編集", "ghost small", () => updateAdminDepartment(department, data))
    ]));
  }

  function buildAdminCategoriesTable(data) {
    return buildAdminTable(["カテゴリ名", "並び順", "状態", ""], data.categories.map((category) => [
      category.name,
      String(category.sort_order),
      category.is_active ? "有効" : "無効",
      createButton("編集", "ghost small", () => updateAdminCategory(category))
    ]));
  }

  function buildAdminTable(headers, rows) {
    if (!rows.length) return textNode("div", "登録はありません。", "empty-state");
    const wrap = node("div", "table-wrap");
    const table = document.createElement("table");
    const head = document.createElement("thead");
    const headerRow = document.createElement("tr");
    headers.forEach((label) => headerRow.append(textNode("th", label)));
    head.append(headerRow);
    const body = document.createElement("tbody");
    rows.forEach((values) => {
      const row = document.createElement("tr");
      values.forEach((value) => {
        const cell = document.createElement("td");
        if (value instanceof Node) cell.append(value);
        else cell.textContent = value ?? "";
        row.append(cell);
      });
      body.append(row);
    });
    table.append(head, body);
    wrap.append(table);
    return wrap;
  }

  async function createAdminUser() {
    const email = promptValue("メールアドレス");
    if (email === null) return;
    const password = promptValue("初期パスワード（8文字以上）", "", false);
    if (password === null) return;
    const displayName = promptValue("表示名");
    if (displayName === null) return;
    const role = promptRole("requester");
    if (role === null) return;
    const departmentId = role === "admin" ? null : await chooseDepartmentId();
    if (role !== "admin" && departmentId === undefined) return;
    await runAdminAction({ action: "create_user", email, password, displayName, role, departmentId });
  }

  async function updateAdminUser(user, data) {
    const displayName = promptValue("表示名", user.display_name);
    if (displayName === null) return;
    const role = promptRole(user.role);
    if (role === null) return;
    const departmentId = role === "admin" ? null : chooseIdFromList("部署", data.departments.filter((item) => item.is_active), user.department_id);
    if (role !== "admin" && departmentId === undefined) return;
    const isActive = promptBoolean("有効状態（true / false）", user.is_active);
    if (isActive === null) return;
    await runAdminAction({ action: "update_user", userId: user.id, displayName, role, departmentId, isActive });
  }

  async function createAdminDepartment(data) {
    const name = promptValue("部署名");
    if (name === null) return;
    const approverId = chooseIdFromList("承認者（未設定は0）", data.users.filter((item) => item.role === "approver" && item.is_active), null, true);
    if (approverId === undefined) return;
    await runAdminAction({ action: "create_department", name, approverId });
  }

  async function updateAdminDepartment(department, data) {
    const name = promptValue("部署名", department.name);
    if (name === null) return;
    const approverId = chooseIdFromList("承認者（未設定は0）", data.users.filter((item) => item.role === "approver" && item.is_active), department.approver_id, true);
    if (approverId === undefined) return;
    const isActive = promptBoolean("有効状態（true / false）", department.is_active);
    if (isActive === null) return;
    await runAdminAction({ action: "update_department", departmentId: department.id, name, approverId, isActive });
  }

  async function createAdminCategory() {
    const name = promptValue("カテゴリ名");
    if (name === null) return;
    const sortOrder = promptInteger("並び順", 100);
    if (sortOrder === null) return;
    await runAdminAction({ action: "create_category", name, sortOrder });
  }

  async function updateAdminCategory(category) {
    const name = promptValue("カテゴリ名", category.name);
    if (name === null) return;
    const sortOrder = promptInteger("並び順", category.sort_order);
    if (sortOrder === null) return;
    const isActive = promptBoolean("有効状態（true / false）", category.is_active);
    if (isActive === null) return;
    await runAdminAction({ action: "update_category", categoryId: category.id, name, sortOrder, isActive });
  }

  async function chooseDepartmentId() {
    const data = await invokeAdmin({ action: "list" });
    return chooseIdFromList("部署", data.departments.filter((item) => item.is_active), null);
  }

  function chooseIdFromList(label, items, selectedId = null, allowNone = false) {
    const options = items.map((item, index) => `${index + 1}: ${item.name || item.display_name}`).join("\n");
    const selectedIndex = items.findIndex((item) => item.id === selectedId);
    const answer = window.prompt(`${label}を番号で選択してください。\n${allowNone ? "0: 未設定\n" : ""}${options}`, selectedIndex >= 0 ? String(selectedIndex + 1) : allowNone ? "0" : "1");
    if (answer === null) return undefined;
    if (allowNone && answer.trim() === "0") return null;
    const index = Number(answer) - 1;
    if (!Number.isInteger(index) || !items[index]) { showToast(`${label}の選択が正しくありません。`, true); return undefined; }
    return items[index].id;
  }

  function promptValue(label, initial = "", trim = true) {
    const value = window.prompt(label, initial);
    if (value === null) return null;
    return trim ? value.trim() : value;
  }

  function promptRole(initial) {
    const value = promptValue("権限（requester / approver / worker / admin）", initial);
    if (value === null) return null;
    if (!ROLE_LABELS[value]) { showToast("権限の入力が正しくありません。", true); return null; }
    return value;
  }

  function promptBoolean(label, initial) {
    const value = promptValue(label, String(initial));
    if (value === null) return null;
    if (value !== "true" && value !== "false") { showToast("true または false を入力してください。", true); return null; }
    return value === "true";
  }

  function promptInteger(label, initial) {
    const value = promptValue(label, String(initial));
    if (value === null) return null;
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0) { showToast("0以上の整数を入力してください。", true); return null; }
    return number;
  }

  async function runAdminAction(payload) {
    if (state.busy) return;
    setBusy(true);
    try {
      await invokeAdmin(payload);
      await loadReferenceData();
      showToast("管理情報を更新しました。");
      await renderAdminOverview();
    } catch (error) {
      console.error(error);
      showToast(errorMessage(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function invokeAdmin(payload) {
    const { data, error } = await state.client.functions.invoke("admin-users", { body: payload });
    if (!error) return data;
    let code = error.message;
    try {
      const body = await error.context?.json();
      if (body?.error) code = body.error;
    } catch { /* response body is not always available */ }
    throw new Error(code);
  }

  function pageHeader(title, description, action = null) {
    const header = node("header", "page-header");
    const copy = node("div");
    copy.append(textNode("p", "WORKFLOW", "eyebrow"), textNode("h1", title), textNode("p", description));
    header.append(copy);
    if (action) header.append(action);
    return header;
  }

  function section(title) {
    const block = node("section", "detail-section");
    block.append(textNode("h3", title));
    return block;
  }

  function createButton(label, classes = "", handler = null) {
    const button = textNode("button", label, `button ${classes}`.trim());
    button.type = "button";
    if (handler) button.addEventListener("click", handler);
    return button;
  }

  function node(tag, className = "") {
    const element = document.createElement(tag);
    if (className) element.className = className;
    return element;
  }

  function textNode(tag, text, className = "") {
    const element = node(tag, className);
    element.textContent = text ?? "";
    return element;
  }

  function input(type, placeholder) {
    const element = document.createElement("input");
    element.type = type;
    element.placeholder = placeholder;
    return element;
  }

  function selectWithOptions(options) {
    const select = document.createElement("select");
    options.forEach((item) => select.append(new Option(item.label, item.value)));
    return select;
  }

  function badgeCell(label, className) {
    const cell = document.createElement("td");
    cell.append(textNode("span", label, `badge ${className}`));
    return cell;
  }

  function categoryName(id) { return state.categories.find((item) => item.id === id)?.name || "不明"; }
  function userName(id) { return state.users.find((item) => item.id === id)?.display_name || "不明なユーザー"; }
  function approvalLabel(action) { return ({ approved: "承認", rejected: "却下", returned: "差し戻し" })[action] || action; }
  function formatDate(value) { return value ? new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium" }).format(new Date(`${value}T00:00:00`)) : "—"; }
  function formatDateTime(value) { return value ? new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—"; }
  function formatBytes(value) { return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MiB` : `${Math.ceil(value / 1024)} KiB`; }

  function updateDescriptionCount() {
    elements["description-count"].textContent = `${elements["request-description"].value.length} / 5000`;
  }

  function setBusy(value) {
    state.busy = value;
    document.querySelectorAll("button").forEach((button) => {
      if (button.id !== "logout-button") button.disabled = value;
    });
  }

  function setFormError(element, message) {
    element.textContent = message;
    element.hidden = !message;
  }

  function showToast(message, isError = false) {
    const toast = textNode("div", message, `toast${isError ? " error" : ""}`);
    elements["toast-region"].append(toast);
    window.setTimeout(() => toast.remove(), 5000);
  }

  function renderError(host, message) {
    host.replaceChildren(textNode("div", message, "error-panel"));
  }

  function errorMessage(error) {
    const raw = `${error?.message || error || ""}`;
    const map = {
      workflow_auth_required: "ログインし直してください。",
      workflow_user_unavailable: "このアカウントは利用できません。",
      workflow_role_forbidden: "この操作を行う権限がありません。",
      workflow_request_unavailable: "案件が存在しないか、閲覧権限がありません。",
      workflow_request_not_editable: "現在の状態では編集できません。",
      workflow_request_not_submittable: "現在の状態では申請できません。",
      workflow_request_not_pending: "この案件は承認待ちではありません。",
      workflow_request_not_assignable: "現在の状態では担当者を設定できません。",
      workflow_request_not_startable: "承認前または担当外の案件は開始できません。",
      workflow_request_not_completable: "対応中の担当案件だけを完了できます。",
      workflow_version_conflict: "他の操作により案件が更新されました。再読み込みしてください。",
      workflow_approver_unavailable: "所属部署の承認者が設定されていません。",
      workflow_assignee_invalid: "有効な作業担当者を選択してください。",
      workflow_reason_required: "理由を入力してください。",
      workflow_attachment_limit: "添付ファイルは最大5件です。",
      workflow_attachments_must_be_deleted_first: "添付ファイルを削除してから案件を削除してください。",
      email_already_exists: "このメールアドレスは登録済みです。",
      department_required: "管理者以外には部署の設定が必要です。",
      cannot_disable_self: "自分自身を無効化することはできません。",
      cannot_remove_own_admin: "自分自身の管理者権限は解除できません。",
      invalid_user: "ユーザー情報を確認してください。",
      invalid_department: "部署情報を確認してください。",
      invalid_approver: "有効な承認者を選択してください。",
      invalid_category: "カテゴリ情報を確認してください。",
      already_exists: "同じ名前のデータが登録済みです。",
      forbidden: "この操作を行う権限がありません。",
      service_unavailable: "管理APIの設定が完了していません。"
    };
    const key = Object.keys(map).find((item) => raw.includes(item));
    if (key) return map[key];
    if (/jwt|session|unauthorized/i.test(raw)) return "セッションが無効です。ログインし直してください。";
    return "処理に失敗しました。時間をおいて再試行してください。";
  }

  function validateConfig(value) {
    if (!value || typeof value !== "object") return null;
    const url = typeof value.SUPABASE_URL === "string" ? value.SUPABASE_URL.trim() : "";
    const key = typeof value.SUPABASE_PUBLISHABLE_KEY === "string" ? value.SUPABASE_PUBLISHABLE_KEY.trim() : "";
    if (!/^https:\/\/.+\.supabase\.co$/.test(url) || !key || key.startsWith("YOUR_")) return null;
    return { url, key };
  }
})();
