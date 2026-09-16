(() => {
  "use strict";

  const DIRECT_MAX = 100000;
  const TEXT_FILE_MAX = 1024 * 1024;
  const BINARY_FILE_MAX = 6 * 1024 * 1024;
  const SEGMENT_MAX = 1000;
  const SEGMENT_LENGTH = 1000;
  const HISTORY_PAGE_SIZE = 20;
  const LANGUAGE_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const HASH_PATTERN = /^[0-9a-f]{64}$/;
  const CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
  const CANDIDATE_FORMATS = new Set(["pdf", "doc", "docx", "ppt", "pptx"]);
  const COVERAGE_LABELS = { key_points: "重要点のみ", comprehensive: "全体を網羅" };
  const DETAIL_LABELS = { brief: "短く", standard: "標準", detailed: "詳しく" };
  const MOBILE_MEDIA = window.matchMedia("(max-width: 760px)");
  const SAFE_ERRORS = {
    unauthorized: "セッションが無効です。ログインし直してください。",
    forbidden: "この操作は許可されていません。",
    invalid_input: "入力内容を確認してください。",
    unsupported_file_type: "対応していない、または形式が一致しないファイルです。",
    input_too_large: "入力が上限を超えています。内容を切り捨てず処理を中止しました。",
    file_read_failed: "ファイルを読み取れませんでした。TXTとMarkdownはUTF-8へ変換してください。",
    document_unreadable: "AIが文書を読み取れませんでした。破損や暗号化、内容を確認してください。",
    busy: "すでに要約を処理中です。完了後に再試行してください。",
    rate_limited: "直近1時間の利用上限に達しました。時間をおいてください。",
    history_limit_reached: "保存履歴が100件です。履歴を削除してから生成してください。",
    upstream_timeout: "AIの処理が時間上限を超えました。手動で再試行してください。",
    upstream_rate_limited: "AIサービスの利用上限に達しました。時間をおいてください。",
    upstream_unavailable: "AIサービスへ接続できませんでした。時間をおいてください。",
    invalid_ai_response: "AIの要約結果を安全に確認できませんでした。",
    database_error: "データベース処理に失敗しました。時間をおいてください。"
  };
  const VIEWS = ["loading-view", "config-view", "auth-view", "confirmation-view", "reset-request-view", "recovery-view", "workspace-view"];
  const elements = Object.fromEntries(Array.from(document.querySelectorAll("[id]"), (node) => [node.id, node]));
  const state = {
    client: null, user: null, authMode: "login", recovery: false, authGeneration: 0,
    inputMode: "direct", selectedFile: null, prepared: null, inputGeneration: 0,
    requestGeneration: 0, generating: false, result: null, resultOrigin: null, sourceAvailable: false, unsavedPayload: null,
    histories: [], historyCursor: null, hasMoreHistory: false, loadingHistory: false, historyLoadState: "idle",
    selectedHistoryId: null, deleteId: null, deleteReturnFocus: null, noticeTimer: null
  };

  const config = validateConfig(window.APP_CONFIG);
  if (!config || !window.supabase?.createClient) {
    showView("config-view");
    return;
  }
  state.client = window.supabase.createClient(config.url, config.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  state.client.auth.onAuthStateChange((event, session) => {
    const generation = ++state.authGeneration;
    if (event === "PASSWORD_RECOVERY") {
      state.recovery = true;
      state.user = session?.user || null;
      window.setTimeout(() => showView("recovery-view"), 0);
      return;
    }
    window.setTimeout(() => handleAuthEvent(event, session, generation), 0);
  });
  bindEvents();
  initialize();

  async function initialize() {
    showView("loading-view");
    const { data, error } = await state.client.auth.getSession();
    if (state.recovery) return;
    if (error) {
      showAuth("login");
      showNotice("認証状態を確認できませんでした。ログインしてください。", "error");
      return;
    }
    await applySession(data.session, state.authGeneration);
  }

  function bindEvents() {
    elements["login-tab"].addEventListener("click", () => showAuth("login"));
    elements["signup-tab"].addEventListener("click", () => showAuth("signup"));
    elements["auth-form"].addEventListener("submit", submitAuth);
    elements["forgot-password-button"].addEventListener("click", () => showView("reset-request-view"));
    elements["reset-back"].addEventListener("click", () => showAuth("login"));
    elements["reset-request-form"].addEventListener("submit", requestReset);
    elements["recovery-form"].addEventListener("submit", updatePassword);
    elements["confirmation-back"].addEventListener("click", () => showAuth("login"));
    elements["logout-button"].addEventListener("click", logout);
    elements["direct-mode-button"].addEventListener("click", () => setInputMode("direct"));
    elements["file-mode-button"].addEventListener("click", () => setInputMode("file"));
    elements["direct-input"].addEventListener("input", updateDirectCount);
    elements["file-input"].addEventListener("change", selectFile);
    elements["clear-file-button"].addEventListener("click", clearFile);
    elements["generate-button"].addEventListener("click", generateSummary);
    elements["retry-save-button"].addEventListener("click", retrySave);
    elements["new-summary-button"].addEventListener("click", startNewSummary);
    elements["history-toggle"].addEventListener("click", toggleHistory);
    elements["load-more-history"].addEventListener("click", loadMoreHistory);
    elements["copy-button"].addEventListener("click", copyResult);
    elements["markdown-button"].addEventListener("click", () => downloadResult("md"));
    elements["txt-button"].addEventListener("click", () => downloadResult("txt"));
    elements["delete-dialog"].addEventListener("close", finishDeleteDialog);
    MOBILE_MEDIA.addEventListener("change", syncEvidenceDisclosureMode);
  }

  async function handleAuthEvent(event, session, generation) {
    if (generation !== state.authGeneration || state.recovery) return;
    if (event === "SIGNED_OUT") {
      clearSensitiveState();
      showAuth("login");
      return;
    }
    if (["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED", "USER_UPDATED"].includes(event)) {
      await applySession(session, generation);
    }
  }

  async function applySession(session, generation) {
    if (generation !== state.authGeneration || state.recovery) return;
    if (!session?.user?.id) {
      clearSensitiveState();
      showAuth("login");
      return;
    }
    const changed = state.user?.id !== session.user.id;
    state.user = session.user;
    elements["signed-in-user"].textContent = session.user.email ? `ログイン中：${session.user.email}` : "ログイン中";
    elements["account-actions"].hidden = false;
    showView("workspace-view");
    if (changed) {
      resetWorkspace();
      await loadInitialHistory(generation);
    }
  }

  async function submitAuth(event) {
    event.preventDefault();
    clearError("auth-error", "auth-email", "auth-password");
    const email = elements["auth-email"].value.trim();
    const password = elements["auth-password"].value;
    if (!email || !password || (state.authMode === "signup" && password.length < 6)) {
      setError("auth-error", "メールアドレスと有効なパスワードを入力してください。", "auth-email", "auth-password");
      return;
    }
    elements["auth-submit"].disabled = true;
    try {
      if (state.authMode === "signup") {
        const { data, error } = await state.client.auth.signUp({ email, password, options: { emailRedirectTo: cleanPageUrl() } });
        if (error) throw error;
        if (!data.session) showView("confirmation-view");
      } else {
        const { error } = await state.client.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch {
      setError("auth-error", "認証できませんでした。入力内容を確認してください。", "auth-email", "auth-password");
    } finally {
      elements["auth-submit"].disabled = false;
    }
  }

  async function requestReset(event) {
    event.preventDefault();
    const email = elements["reset-email"].value.trim();
    if (!email) return setError("reset-error", "メールアドレスを入力してください。", "reset-email");
    const { error } = await state.client.auth.resetPasswordForEmail(email, { redirectTo: cleanPageUrl() });
    if (error) return setError("reset-error", "再設定メールを送信できませんでした。", "reset-email");
    showAuth("login");
    showNotice("再設定メールを送信しました。", "success");
  }

  async function updatePassword(event) {
    event.preventDefault();
    const first = elements["new-password"].value;
    const second = elements["confirm-password"].value;
    if (first.length < 6 || first !== second) return setError("recovery-error", "6文字以上の同じパスワードを入力してください。", "new-password", "confirm-password");
    const { error } = await state.client.auth.updateUser({ password: first });
    if (error) return setError("recovery-error", "パスワードを変更できませんでした。", "new-password", "confirm-password");
    state.recovery = false;
    window.history.replaceState({}, document.title, cleanPageUrl());
    showNotice("パスワードを変更しました。", "success");
    const { data } = await state.client.auth.getSession();
    await applySession(data.session, state.authGeneration);
  }

  async function logout() {
    ++state.authGeneration;
    ++state.requestGeneration;
    elements["logout-button"].disabled = true;
    await state.client.auth.signOut();
    clearSensitiveState();
    showAuth("login");
    elements["logout-button"].disabled = false;
  }

  function showAuth(mode) {
    state.authMode = mode;
    elements["account-actions"].hidden = true;
    showView("auth-view");
    const signup = mode === "signup";
    elements["auth-title"].textContent = signup ? "アカウント作成" : "ログイン";
    elements["auth-description"].textContent = signup ? "登録後、確認メールが届く場合はリンクを開いてください。" : "保存済みの要約を開くにはログインしてください。";
    elements["auth-submit"].textContent = signup ? "アカウントを作成" : "ログイン";
    elements["auth-password"].autocomplete = signup ? "new-password" : "current-password";
    elements["auth-password-hint"].textContent = signup ? "6文字以上で入力してください。" : "登録済みのパスワードを入力してください。";
    elements["login-tab"].classList.toggle("is-active", !signup);
    elements["signup-tab"].classList.toggle("is-active", signup);
    elements["login-tab"].setAttribute("aria-selected", String(!signup));
    elements["signup-tab"].setAttribute("aria-selected", String(signup));
    clearError("auth-error", "auth-email", "auth-password");
  }

  function setInputMode(mode) {
    if (state.generating || state.inputMode === mode) return;
    if (state.unsavedPayload && !window.confirm("未保存の結果は失われます。入力方法を変更しますか？")) return;
    ++state.inputGeneration;
    ++state.requestGeneration;
    clearResult();
    state.inputMode = mode;
    elements["direct-input-panel"].hidden = mode !== "direct";
    elements["file-input-panel"].hidden = mode !== "file";
    elements["direct-mode-button"].classList.toggle("is-active", mode === "direct");
    elements["file-mode-button"].classList.toggle("is-active", mode === "file");
    elements["direct-mode-button"].setAttribute("aria-checked", String(mode === "direct"));
    elements["file-mode-button"].setAttribute("aria-checked", String(mode === "file"));
    clearError("input-error", mode === "direct" ? "direct-input" : "file-input");
  }

  function updateDirectCount() {
    const length = codePointLength(elements["direct-input"].value);
    elements["direct-count"].textContent = `${length.toLocaleString("ja-JP")} / 100,000`;
    if (length > DIRECT_MAX) setError("input-error", "直接入力は100,000文字以内にしてください。", "direct-input");
    else clearError("input-error", "direct-input");
  }

  async function selectFile() {
    ++state.inputGeneration;
    const generation = state.inputGeneration;
    state.prepared = null;
    state.selectedFile = elements["file-input"].files?.[0] || null;
    if (!state.selectedFile) return renderFileSummary();
    setGenerationStatus("ファイルを読み込んでいます…", true);
    try {
      const prepared = await prepareFile(state.selectedFile);
      if (generation !== state.inputGeneration) return;
      state.prepared = prepared;
      renderFileSummary();
      clearError("input-error", "file-input");
    } catch (error) {
      if (generation !== state.inputGeneration) return;
      state.prepared = null;
      renderFileSummary();
      setError("input-error", SAFE_ERRORS[error.code] || SAFE_ERRORS.file_read_failed, "file-input");
    } finally {
      if (generation === state.inputGeneration) setGenerationStatus("", false);
    }
  }

  function clearFile() {
    if (state.generating) return;
    ++state.inputGeneration;
    state.selectedFile = null;
    state.prepared = null;
    elements["file-input"].value = "";
    renderFileSummary();
    clearError("input-error", "file-input");
  }

  function renderFileSummary() {
    const file = state.selectedFile;
    elements["file-summary"].hidden = !file;
    elements["clear-file-button"].hidden = !file;
    elements["file-summary"].textContent = file ? `${file.name}（${formatBytes(file.size)}）${state.prepared ? "・読込済み" : ""}` : "";
  }

  async function prepareFile(file) {
    const format = extensionOf(file.name);
    if (!format) throw safeFailure("unsupported_file_type");
    const textFormat = format === "txt" || format === "markdown";
    const limit = textFormat ? TEXT_FILE_MAX : BINARY_FILE_MAX;
    if (file.size < 1) throw safeFailure("document_unreadable");
    if (file.size > limit) throw safeFailure("input_too_large");
    const bytes = new Uint8Array(await file.arrayBuffer());
    validateFileSignature(format, file.type, bytes);
    const documentHash = await sha256Hex(bytes);
    if (!textFormat) return { format, fileName: file.name, mimeType: file.type || mimeFor(format), documentHash, fileData: bytesToBase64(bytes), originalText: null, segments: null };
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/u, ""); }
    catch { throw safeFailure("file_read_failed"); }
    if (codePointLength(text) > DIRECT_MAX) throw safeFailure("input_too_large");
    const normalized = normalizeText(text);
    const segments = segmentText(normalized, format === "markdown");
    if (!segments.length) throw safeFailure("document_unreadable");
    const hash = await sha256Hex(new TextEncoder().encode(segments.map((item) => item.text).join("\n\n")));
    return { format, fileName: file.name, mimeType: file.type || mimeFor(format), documentHash: hash, originalText: text, segments, fileData: null };
  }

  async function prepareDirect() {
    const text = elements["direct-input"].value;
    const length = codePointLength(text);
    if (length < 1 || !text.trim()) throw safeFailure("invalid_input");
    if (length > DIRECT_MAX) throw safeFailure("input_too_large");
    const normalized = normalizeText(text);
    const segments = segmentText(normalized, false);
    if (!segments.length) throw safeFailure("invalid_input");
    const documentHash = await sha256Hex(new TextEncoder().encode(segments.map((item) => item.text).join("\n\n")));
    return { format: "direct", fileName: null, mimeType: null, documentHash, originalText: text, segments, fileData: null };
  }

  async function generateSummary() {
    if (state.generating) return;
    clearError("input-error", state.inputMode === "direct" ? "direct-input" : "file-input");
    if (state.unsavedPayload && !window.confirm("未保存の結果は失われます。新しい要約を開始しますか？")) return;
    clearResult();
    let prepared;
    try {
      setGenerationStatus("入力を確認しています…", true);
      prepared = state.inputMode === "direct" ? await prepareDirect() : state.prepared;
      if (!prepared) throw safeFailure("invalid_input");
    } catch (error) {
      setGenerationStatus("", false);
      return setError("input-error", SAFE_ERRORS[error.code] || SAFE_ERRORS.invalid_input, state.inputMode === "direct" ? "direct-input" : "file-input");
    }
    const requestId = crypto.randomUUID();
    const generation = ++state.requestGeneration;
    state.generating = true;
    setInputsDisabled(true);
    setGenerationStatus("文書を送信しています… AIが要約を生成しています…", true);
    const payload = buildGeneratePayload(prepared, requestId);
    let data;
    let error;
    try {
      ({ data, error } = await state.client.functions.invoke("summarize-document", { body: payload }));
    } catch {
      if (generation === state.requestGeneration) {
        setError("input-error", SAFE_ERRORS.upstream_unavailable, state.inputMode === "direct" ? "direct-input" : "file-input");
      }
      return;
    } finally {
      if (generation === state.requestGeneration) {
        state.generating = false;
        setInputsDisabled(false);
        elements["retry-save-button"].disabled = false;
        setGenerationStatus("", false);
      }
    }
    if (generation !== state.requestGeneration) return;
    if (error || !data || (data.saved !== true && data.saved !== false) || !validateResult(data.result, prepared.segments, data.saved)) {
      const code = await functionErrorCode(error, data);
      return setError("input-error", SAFE_ERRORS[code] || SAFE_ERRORS.upstream_unavailable, state.inputMode === "direct" ? "direct-input" : "file-input");
    }
    state.result = data.result;
    state.result.originalText = prepared.originalText;
    state.result.segments = prepared.segments;
    state.result.saved = data.saved;
    state.resultOrigin = "generated";
    state.sourceAvailable = Array.isArray(prepared.segments) && prepared.segments.length > 0;
    state.unsavedPayload = data.saved ? null : { requestId, result: stripClientFields(data.result) };
    renderResult();
    if (data.saved) {
      showNotice("要約を生成して保存しました。", "success");
      await loadInitialHistory(state.authGeneration);
    } else showNotice("要約は生成できましたが保存できませんでした。結果は一時表示です。", "error");
  }

  function buildGeneratePayload(prepared, requestId) {
    const textInput = ["direct", "txt", "markdown"].includes(prepared.format);
    return {
      action: "generate", requestId, inputFormat: prepared.format, sourceName: prepared.fileName,
      mimeType: prepared.mimeType, documentHash: prepared.documentHash,
      coverage: selectedValue("coverage"), detail: selectedValue("detail"),
      segments: textInput ? prepared.segments : null,
      fileData: textInput ? null : prepared.fileData
    };
  }

  async function retrySave() {
    if (!state.unsavedPayload || state.generating) return;
    state.generating = true;
    elements["retry-save-button"].disabled = true;
    setInputsDisabled(true);
    setGenerationStatus("同じ要約結果の保存だけを再試行しています…", true);
    const generation = state.requestGeneration;
    let data;
    let error;
    try {
      ({ data, error } = await state.client.functions.invoke("summarize-document", { body: { action: "save", ...state.unsavedPayload } }));
    } catch {
      if (generation === state.requestGeneration) showNotice(SAFE_ERRORS.upstream_unavailable, "error");
      return;
    } finally {
      if (generation === state.requestGeneration) {
        state.generating = false;
        setInputsDisabled(false);
        elements["retry-save-button"].disabled = false;
        setGenerationStatus("", false);
      }
    }
    if (generation !== state.requestGeneration) return;
    if (error || data?.saved !== true || !validateResult(data.result, state.result?.segments || null, true)) {
      const code = await functionErrorCode(error, data);
      showNotice(SAFE_ERRORS[code] || SAFE_ERRORS.database_error, "error");
      return;
    }
    state.result = { ...state.result, ...data.result, saved: true };
    state.unsavedPayload = null;
    renderResult();
    showNotice("要約を保存しました。", "success");
    await loadInitialHistory(state.authGeneration);
  }

  function renderResult() {
    const result = state.result;
    elements["result-section"].hidden = !result;
    if (!result) return;
    elements["result-meta"].textContent = `${result.source_name}・${COVERAGE_LABELS[result.coverage]}・${DETAIL_LABELS[result.detail]}・${formatDate(result.created_at)}`;
    elements["save-badge"].textContent = result.saved ? "保存済み" : "未保存";
    elements["save-badge"].classList.toggle("is-unsaved", !result.saved);
    elements["unsaved-warning"].hidden = result.saved;
    const historyResult = state.resultOrigin === "history";
    elements["history-source-note"].hidden = !historyResult;
    const candidate = CANDIDATE_FORMATS.has(result.input_format);
    elements["evidence-warning"].hidden = !candidate;
    elements["source-panel"].hidden = !state.sourceAvailable;
    elements["comparison-grid"].classList.toggle("is-summary-only", !state.sourceAvailable);
    elements["summary-list"].replaceChildren();
    elements["source-list"].replaceChildren();
    result.summary_items.forEach((item) => elements["summary-list"].append(makeSummaryItem(item, candidate, state.sourceAvailable)));
    if (state.sourceAvailable) result.segments.forEach((segment) => elements["source-list"].append(makeSourceSegment(segment, result.summary_items)));
    elements["result-section"].scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  }

  function makeSummaryItem(item, candidate, canNavigate) {
    const li = document.createElement("li");
    li.className = "summary-card";
    li.id = `summary-${item.id}`;
    li.dataset.itemId = item.id;
    const text = document.createElement("div");
    text.className = "summary-text";
    text.textContent = item.summary;
    li.append(text);
    const evidenceList = document.createElement("div");
    evidenceList.className = "evidence-list";
    const sourceSegments = canNavigate && Array.isArray(state.result?.segments) ? state.result.segments : [];
    const segmentsById = new Map(sourceSegments.map((segment) => [segment.id, segment]));
    item.evidence.forEach((evidence) => {
      if (!candidate) {
        if (canNavigate) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "evidence-button desktop-evidence-control";
          button.textContent = `根拠 ${evidence.segmentId}`;
          button.addEventListener("click", () => focusSegment(evidence.segmentId, item.id));
          evidenceList.append(button);
          const segment = segmentsById.get(evidence.segmentId);
          if (segment) evidenceList.append(makeInlineSourceEvidence(segment));
        } else {
          const label = document.createElement("span");
          label.className = "evidence-label";
          label.textContent = `根拠 ${evidence.segmentId}`;
          evidenceList.append(label);
        }
      } else {
        const box = document.createElement("div");
        box.className = "evidence-candidate";
        const excerpt = document.createElement("p");
        excerpt.textContent = `根拠候補：${evidence.excerpt}`;
        box.append(excerpt);
        const location = locationText(evidence.location);
        if (location) {
          const where = document.createElement("p");
          where.textContent = `位置候補：${location}`;
          box.append(where);
        }
        evidenceList.append(box);
      }
    });
    const evidenceDisclosure = document.createElement("details");
    evidenceDisclosure.className = "evidence-disclosure";
    evidenceDisclosure.open = !MOBILE_MEDIA.matches;
    const evidenceLabel = document.createElement("summary");
    evidenceLabel.textContent = `根拠を確認（${item.evidence.length}件）`;
    evidenceDisclosure.append(evidenceLabel, evidenceList);
    evidenceDisclosure.addEventListener("toggle", () => {
      if (evidenceDisclosure.open && MOBILE_MEDIA.matches) {
        evidenceDisclosure.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "nearest" });
      }
    });
    li.append(evidenceDisclosure);
    return li;
  }

  function makeInlineSourceEvidence(segment) {
    const block = document.createElement("div");
    block.className = "inline-source-evidence";
    const id = document.createElement("span");
    id.className = "inline-source-id";
    id.textContent = segment.id;
    const text = document.createElement("p");
    text.className = "inline-source-text";
    text.textContent = segment.text;
    block.append(id, text);
    return block;
  }

  function syncEvidenceDisclosureMode() {
    document.querySelectorAll(".evidence-disclosure").forEach((details) => {
      details.open = !MOBILE_MEDIA.matches;
    });
  }

  function makeSourceSegment(segment, items) {
    const article = document.createElement("article");
    article.className = "source-segment";
    article.id = `source-${segment.id}`;
    article.tabIndex = -1;
    const header = document.createElement("header");
    const strong = document.createElement("strong");
    strong.textContent = segment.id;
    header.append(strong);
    article.append(header);
    const pre = document.createElement("pre");
    pre.textContent = segment.text;
    article.append(pre);
    const references = items.filter((item) => item.evidence.some((evidence) => evidence.segmentId === segment.id));
    references.forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "segment-reference";
      button.textContent = `${item.id}から参照`;
      button.addEventListener("click", () => focusSummary(item.id, segment.id));
      article.append(button);
    });
    return article;
  }

  function focusSegment(segmentId, itemId) {
    clearHighlights();
    const source = document.getElementById(`source-${segmentId}`);
    const summary = document.getElementById(`summary-${itemId}`);
    source?.classList.add("is-highlighted");
    summary?.classList.add("is-highlighted");
    source?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" });
    source?.focus({ preventScroll: true });
  }

  function focusSummary(itemId, segmentId) {
    clearHighlights();
    const source = document.getElementById(`source-${segmentId}`);
    const summary = document.getElementById(`summary-${itemId}`);
    source?.classList.add("is-highlighted");
    summary?.classList.add("is-highlighted");
    summary?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" });
    summary?.setAttribute("tabindex", "-1");
    summary?.focus({ preventScroll: true });
  }

  function clearHighlights() {
    document.querySelectorAll(".is-highlighted").forEach((node) => node.classList.remove("is-highlighted"));
  }

  async function loadInitialHistory(generation) {
    state.histories = [];
    state.historyCursor = null;
    state.hasMoreHistory = false;
    await loadHistory(null, generation);
  }

  async function loadMoreHistory() { await loadHistory(state.historyCursor, state.authGeneration); }

  async function loadHistory(cursor, authGeneration) {
    if (state.loadingHistory || !state.user) return;
    const appending = Boolean(cursor);
    state.loadingHistory = true;
    state.historyLoadState = "loading";
    if (!appending) elements["history-list"].replaceChildren();
    elements["load-more-history"].hidden = true;
    elements["history-status"].hidden = false;
    elements["history-status"].textContent = appending ? "過去の履歴を読み込んでいます…" : "履歴を読み込んでいます…";
    let query = state.client.from("document_summaries")
      .select("id,request_id,source_name,document_hash,input_format,coverage,detail,document_language,summary_items,created_at")
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(HISTORY_PAGE_SIZE + 1);
    if (cursor) query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
    let data;
    let error;
    try { ({ data, error } = await query); }
    catch { error = true; }
    state.loadingHistory = false;
    if (authGeneration !== state.authGeneration || !state.user) return;
    if (error || !Array.isArray(data)) {
      state.historyLoadState = "error";
      elements["history-status"].textContent = appending ? "過去の履歴を追加で読み込めませんでした。" : "履歴を読み込めませんでした。";
      if (!appending) {
        state.histories = [];
        state.historyCursor = null;
        state.hasMoreHistory = false;
        elements["history-list"].replaceChildren();
      }
      elements["load-more-history"].hidden = !appending || !state.hasMoreHistory;
      return;
    }
    state.historyLoadState = "ready";
    const rows = data.slice(0, HISTORY_PAGE_SIZE).filter(validateHistoryRow);
    state.histories = cursor ? [...state.histories, ...rows] : rows;
    state.hasMoreHistory = data.length > HISTORY_PAGE_SIZE;
    const last = rows.at?.(-1) || rows[rows.length - 1];
    state.historyCursor = last ? { createdAt: last.created_at, id: last.id } : null;
    elements["history-status"].hidden = true;
    renderHistory();
  }

  function renderHistory() {
    elements["history-list"].replaceChildren();
    if (state.historyLoadState === "ready" && !state.histories.length) {
      const empty = document.createElement("p");
      empty.className = "empty-history";
      empty.textContent = "保存済みの要約はありません。";
      elements["history-list"].append(empty);
    }
    state.histories.forEach((row) => {
      const wrapper = document.createElement("div");
      wrapper.className = "history-entry";
      const open = document.createElement("button");
      open.type = "button";
      open.className = "history-open";
      const title = document.createElement("strong");
      title.textContent = row.source_name;
      const meta = document.createElement("span");
      meta.textContent = `${formatDate(row.created_at)}・${COVERAGE_LABELS[row.coverage]}・${DETAIL_LABELS[row.detail]}`;
      open.append(title, meta);
      open.addEventListener("click", () => openHistory(row));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "history-delete";
      remove.textContent = "削除";
      remove.setAttribute("aria-label", `${row.source_name}を削除`);
      remove.addEventListener("click", () => openDelete(row, remove));
      wrapper.append(open, remove);
      elements["history-list"].append(wrapper);
    });
    elements["load-more-history"].hidden = !state.hasMoreHistory;
  }

  function openHistory(row) {
    if (state.generating) return;
    if (state.unsavedPayload && !window.confirm("未保存の結果は失われます。履歴を開きますか？")) return;
    ++state.requestGeneration;
    state.selectedHistoryId = row.id;
    state.unsavedPayload = null;
    state.result = { ...row, saved: true, originalText: null, segments: null };
    state.resultOrigin = "history";
    state.sourceAvailable = false;
    renderResult();
    if (window.matchMedia("(max-width: 760px)").matches) toggleHistory(false);
  }

  function startNewSummary() {
    if (state.generating) return;
    if (state.unsavedPayload && !window.confirm("未保存の結果は失われます。新しい入力を開始しますか？")) return;
    ++state.requestGeneration;
    clearResult();
    elements["direct-input"].focus();
  }

  function openDelete(row, button) {
    if (state.generating) return;
    state.deleteId = row.id;
    state.deleteReturnFocus = button;
    elements["delete-description"].textContent = `「${row.source_name}」を削除します。`;
    elements["delete-dialog"].showModal();
  }

  async function finishDeleteDialog() {
    const returnFocus = state.deleteReturnFocus;
    try {
      if (elements["delete-dialog"].returnValue === "confirm" && state.deleteId) {
        const id = state.deleteId;
        let error;
        try { ({ error } = await state.client.from("document_summaries").delete().eq("id", id)); }
        catch { error = true; }
        if (error) showNotice("保存済み要約を削除できませんでした。", "error");
        else {
          state.histories = state.histories.filter((row) => row.id !== id);
          if (state.selectedHistoryId === id) clearResult();
          renderHistory();
          showNotice("保存済み要約を削除しました。", "success");
        }
      }
    } finally {
      state.deleteId = null;
      if (returnFocus?.isConnected) returnFocus.focus();
      else (elements["history-list"].querySelector("button") || elements["new-summary-button"]).focus();
      state.deleteReturnFocus = null;
    }
  }

  function toggleHistory(force) {
    const open = typeof force === "boolean" ? force : !elements["history-drawer"].classList.contains("is-open");
    elements["history-drawer"].classList.toggle("is-open", open);
    elements["history-toggle"].setAttribute("aria-expanded", String(open));
    elements["history-toggle"].textContent = open ? "履歴を閉じる" : "履歴を表示";
  }

  async function copyResult() {
    if (!state.result) return;
    try {
      await navigator.clipboard.writeText(resultText(state.result, false));
      showNotice("要約をコピーしました。", "success");
    } catch { showNotice("要約をコピーできませんでした。", "error"); }
  }

  function downloadResult(extension) {
    if (!state.result) return;
    const markdown = extension === "md";
    const blob = new Blob([resultText(state.result, markdown)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeFileName(state.result.source_name)}-summary.${extension}`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function resultText(result, markdown) {
    const lines = markdown ? [`# ${result.source_name}`, ""] : [result.source_name, ""];
    lines.push(`要約範囲：${COVERAGE_LABELS[result.coverage]}`, `説明の詳しさ：${DETAIL_LABELS[result.detail]}`, `生成日時：${formatDate(result.created_at)}`, "");
    if (CANDIDATE_FORMATS.has(result.input_format)) lines.push("根拠はAIが選定した候補であり、原文上の位置や内容を保証するものではありません", "");
    result.summary_items.forEach((item, index) => {
      lines.push(markdown ? `## ${index + 1}. ${item.summary}` : `${index + 1}. ${item.summary}`);
      item.evidence.forEach((evidence) => {
        if (evidence.segmentId) lines.push(`- 根拠：${evidence.segmentId}`);
        else lines.push(`- 根拠候補：${evidence.excerpt}${locationText(evidence.location) ? `（${locationText(evidence.location)}）` : ""}`);
      });
      lines.push("");
    });
    return lines.join("\n");
  }

  function segmentText(normalized, markdown) {
    const blocks = markdown ? markdownBlocks(normalized) : normalized.split(/\n[ \t]*\n+/u).map((text) => text.trim()).filter(Boolean);
    const chunks = [];
    blocks.forEach((block) => splitLongSegment(block, SEGMENT_LENGTH).forEach((part) => { if (part.trim()) chunks.push(part.trim()); }));
    if (chunks.length > SEGMENT_MAX) throw safeFailure("input_too_large");
    return chunks.map((text, index) => ({ id: `S${String(index + 1).padStart(4, "0")}`, text }));
  }

  function markdownBlocks(text) {
    const lines = text.split("\n");
    const blocks = [];
    let current = [];
    let mode = "paragraph";
    const flush = () => { const value = current.join("\n").trim(); if (value) blocks.push(value); current = []; mode = "paragraph"; };
    for (const line of lines) {
      if (/^\s*```/u.test(line)) {
        if (mode !== "code") { flush(); mode = "code"; current.push(line); }
        else { current.push(line); flush(); }
        continue;
      }
      if (mode === "code") { current.push(line); continue; }
      if (/^\s{0,3}#{1,6}\s+/u.test(line) || /^\s*(?:[-+*]|\d+[.)])\s+/u.test(line)) { flush(); blocks.push(line.trim()); continue; }
      if (/^\s*>/u.test(line)) { if (mode !== "quote") { flush(); mode = "quote"; } current.push(line); continue; }
      if (/^\s*\|.*\|\s*$/u.test(line)) { if (mode !== "table") { flush(); mode = "table"; } current.push(line); continue; }
      if (!line.trim()) { flush(); continue; }
      if (mode === "quote" || mode === "table") flush();
      current.push(line);
    }
    flush();
    return blocks;
  }

  function splitLongSegment(text, max) {
    if (codePointLength(text) <= max) return [text];
    const points = Array.from(text);
    const result = [];
    let start = 0;
    while (start < points.length) {
      let end = Math.min(start + max, points.length);
      if (end < points.length) {
        const slice = points.slice(start, end).join("");
        const matches = Array.from(slice.matchAll(/[。！？.!?\n](?=\s|$|[^\s])/gu));
        const last = matches[matches.length - 1];
        if (last && last.index !== undefined && last.index + last[0].length >= Math.floor(max * 0.5)) end = start + codePointLength(slice.slice(0, last.index + last[0].length));
      }
      result.push(points.slice(start, end).join("").trim());
      start = end;
    }
    return result.filter(Boolean);
  }

  function validateFileSignature(format, mime, bytes) {
    const allowedMimes = {
      txt: ["", "text/plain"], markdown: ["", "text/markdown", "text/plain", "text/x-markdown"],
      pdf: ["", "application/pdf"], doc: ["", "application/msword"],
      docx: ["", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      ppt: ["", "application/vnd.ms-powerpoint"],
      pptx: ["", "application/vnd.openxmlformats-officedocument.presentationml.presentation"]
    };
    if (!allowedMimes[format]?.includes((mime || "").toLowerCase())) throw safeFailure("unsupported_file_type");
    const starts = (signature) => signature.every((value, index) => bytes[index] === value);
    if (format === "pdf" && !starts([0x25, 0x50, 0x44, 0x46, 0x2d])) throw safeFailure("unsupported_file_type");
    if (["doc", "ppt"].includes(format) && !starts([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) throw safeFailure("unsupported_file_type");
    if (["docx", "pptx"].includes(format) && !(starts([0x50, 0x4b, 0x03, 0x04]) || starts([0x50, 0x4b, 0x05, 0x06]) || starts([0x50, 0x4b, 0x07, 0x08]))) throw safeFailure("unsupported_file_type");
  }

  function validateResult(result, segmentOverride, expectedSaved = false) {
    if (!result || typeof result !== "object" || !UUID_PATTERN.test(String(result.request_id)) || !UUID_PATTERN.test(String(result.id || "00000000-0000-4000-8000-000000000000"))) return false;
    const resultKeys = ["request_id", "source_name", "document_hash", "input_format", "coverage", "detail", "document_language", "summary_items", "created_at"];
    if (expectedSaved) resultKeys.push("id");
    if (Object.keys(result).length !== resultKeys.length || Object.keys(result).some((key) => !resultKeys.includes(key))) return false;
    if (typeof result.source_name !== "string" || result.source_name !== result.source_name.trim() || codePointLength(result.source_name) < 1 || codePointLength(result.source_name) > 255 || CONTROL_PATTERN.test(result.source_name) || !HASH_PATTERN.test(result.document_hash)) return false;
    if (!LANGUAGE_PATTERN.test(result.document_language) || result.document_language.length > 16) return false;
    if (!COVERAGE_LABELS[result.coverage] || !DETAIL_LABELS[result.detail] || !["direct", "txt", "markdown", "pdf", "doc", "docx", "ppt", "pptx"].includes(result.input_format)) return false;
    if (!Array.isArray(result.summary_items) || result.summary_items.length < 1 || result.summary_items.length > 30 || !validDate(result.created_at)) return false;
    const segmentIds = new Set((segmentOverride || result.segments || []).map((segment) => segment.id));
    return result.summary_items.every((item, index) => validateItem(item, index, result.input_format, segmentIds));
  }

  function validateHistoryRow(row) { return validateResult(row, null, true); }

  function validateItem(item, index, format, segmentIds) {
    if (!item || Object.keys(item).length !== 3 || Object.keys(item).some((key) => !["id", "summary", "evidence"].includes(key)) || item.id !== `I${String(index + 1).padStart(3, "0")}` || typeof item.summary !== "string" || item.summary !== item.summary.trim() || codePointLength(item.summary) < 1 || codePointLength(item.summary) > 1200 || CONTROL_PATTERN.test(item.summary)) return false;
    if (!Array.isArray(item.evidence) || item.evidence.length < 1 || item.evidence.length > 3) return false;
    const text = ["direct", "txt", "markdown"].includes(format);
    return item.evidence.every((evidence) => {
      if (!evidence || typeof evidence !== "object" || Object.keys(evidence).length !== 3 || Object.keys(evidence).some((key) => !["segmentId", "excerpt", "location"].includes(key))) return false;
      if (text) return /^S\d{4}$/u.test(evidence.segmentId) && (segmentIds.size === 0 || segmentIds.has(evidence.segmentId)) && evidence.excerpt === null && evidence.location === null;
      return evidence.segmentId === null && typeof evidence.excerpt === "string" && evidence.excerpt === evidence.excerpt.trim() && codePointLength(evidence.excerpt) >= 1 && codePointLength(evidence.excerpt) <= 400 && !CONTROL_PATTERN.test(evidence.excerpt) && validLocation(evidence.location, format);
    });
  }

  function validLocation(location, format) {
    if (location === null) return true;
    if (!location || typeof location !== "object" || Array.isArray(location) || Object.keys(location).length !== 3 || Object.keys(location).some((key) => !["pageNumber", "slideNumber", "sectionLabel"].includes(key))) return false;
    const page = location.pageNumber;
    const slide = location.slideNumber;
    const section = location.sectionLabel;
    if (page !== null && (!Number.isInteger(page) || page < 1 || format !== "pdf")) return false;
    if (slide !== null && (!Number.isInteger(slide) || slide < 1 || !["ppt", "pptx"].includes(format))) return false;
    return section === null || (typeof section === "string" && codePointLength(section) >= 1 && codePointLength(section) <= 200 && !CONTROL_PATTERN.test(section));
  }

  function stripClientFields(result) {
    const clone = { ...result };
    delete clone.originalText;
    delete clone.segments;
    delete clone.saved;
    return clone;
  }

  function resetWorkspace() {
    state.histories = [];
    state.historyCursor = null;
    state.hasMoreHistory = false;
    state.loadingHistory = false;
    state.historyLoadState = "idle";
    state.selectedHistoryId = null;
    elements["direct-input"].value = "";
    updateDirectCount();
    clearFile();
    clearResult();
    elements["history-list"].replaceChildren();
    elements["history-status"].hidden = true;
    elements["history-status"].textContent = "";
    elements["load-more-history"].hidden = true;
  }

  function clearSensitiveState() {
    ++state.requestGeneration;
    state.user = null;
    state.generating = false;
    setInputsDisabled(false);
    elements["retry-save-button"].disabled = false;
    setGenerationStatus("", false);
    elements["account-actions"].hidden = true;
    resetWorkspace();
  }

  function clearResult() {
    state.result = null;
    state.resultOrigin = null;
    state.sourceAvailable = false;
    state.unsavedPayload = null;
    state.selectedHistoryId = null;
    elements["result-section"].hidden = true;
    elements["summary-list"].replaceChildren();
    elements["source-list"].replaceChildren();
  }

  function setInputsDisabled(disabled) {
    ["direct-mode-button", "file-mode-button", "direct-input", "file-input", "clear-file-button", "generate-button", "new-summary-button", "load-more-history", "copy-button", "markdown-button", "txt-button", "retry-save-button"]
      .forEach((id) => { elements[id].disabled = disabled; });
    document.querySelectorAll(".history-open, .history-delete").forEach((button) => { button.disabled = disabled; });
    document.querySelectorAll('input[name="coverage"], input[name="detail"]').forEach((input) => { input.disabled = disabled; });
  }

  function setGenerationStatus(message, busy) {
    elements["generation-status"].hidden = !message;
    elements["generation-status"].textContent = message;
    elements["input-section"].setAttribute("aria-busy", String(Boolean(busy)));
  }

  function setError(id, message, ...fieldIds) {
    elements[id].textContent = message;
    elements[id].hidden = false;
    fieldIds.forEach((fieldId) => elements[fieldId]?.setAttribute("aria-invalid", "true"));
  }

  function clearError(id, ...fieldIds) {
    elements[id].textContent = "";
    elements[id].hidden = true;
    fieldIds.forEach((fieldId) => elements[fieldId]?.removeAttribute("aria-invalid"));
  }

  function showNotice(message, type = "info") {
    if (state.noticeTimer !== null) {
      window.clearTimeout(state.noticeTimer);
      state.noticeTimer = null;
    }
    elements["global-notice"].textContent = message;
    elements["global-notice"].dataset.type = type;
    elements["global-notice"].hidden = !message;
    if (message && type === "success") {
      state.noticeTimer = window.setTimeout(() => {
        elements["global-notice"].textContent = "";
        elements["global-notice"].hidden = true;
        state.noticeTimer = null;
      }, 4500);
    }
  }

  function showView(id) { VIEWS.forEach((view) => { elements[view].hidden = view !== id; }); }
  function validateConfig(value) {
    if (!value || typeof value !== "object") return null;
    const url = String(value.SUPABASE_URL || "").trim();
    const key = String(value.SUPABASE_PUBLISHABLE_KEY || "").trim();
    return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) && key && !/YOUR_|PLACEHOLDER|CHANGE_ME/i.test(key) ? { url, key } : null;
  }
  function selectedValue(name) { return document.querySelector(`input[name="${name}"]:checked`)?.value || ""; }
  function normalizeText(text) { return text.replace(/\r\n?/gu, "\n").replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/gu, ""); }
  function extensionOf(name) { const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/u)?.[1] || ""; return ext === "md" ? "markdown" : ["txt", "markdown", "pdf", "doc", "docx", "ppt", "pptx"].includes(ext) ? ext : ""; }
  function mimeFor(format) { return { pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", txt: "text/plain", markdown: "text/markdown" }[format] || "application/octet-stream"; }
  function codePointLength(value) { return Array.from(String(value)).length; }
  function safeFailure(code) { return Object.assign(new Error(code), { code }); }
  async function sha256Hex(bytes) { const digest = await crypto.subtle.digest("SHA-256", bytes); return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""); }
  function bytesToBase64(bytes) { let binary = ""; const size = 0x8000; for (let i = 0; i < bytes.length; i += size) binary += String.fromCharCode(...bytes.subarray(i, i + size)); return btoa(binary); }
  function cleanPageUrl() { return `${location.origin}${location.pathname}`; }
  function formatBytes(bytes) { return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / (1024 * 1024)).toFixed(2)} MiB`; }
  function validDate(value) { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
  function formatDate(value) { const date = new Date(value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo" }).format(date) : "日時不明"; }
  function locationText(location) { if (!location) return ""; return [location.pageNumber ? `${location.pageNumber}ページ` : "", location.slideNumber ? `${location.slideNumber}枚目` : "", location.sectionLabel || ""].filter(Boolean).join("・"); }
  function safeFileName(value) { const cleaned = String(value).normalize("NFKC").replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/gu, "-").replace(/^\.+|[ .]+$/gu, "").slice(0, 120); return cleaned || "document"; }
  function reducedMotion() { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  async function functionErrorCode(error, data) { if (SAFE_ERRORS[data?.error?.code]) return data.error.code; try { const payload = await error?.context?.clone?.().json(); return SAFE_ERRORS[payload?.error?.code] ? payload.error.code : null; } catch { return null; } }
})();
