(() => {
  "use strict";

  const MAX_MESSAGE_LENGTH = 2000;
  const SIGNUP_PASSWORD_MIN_LENGTH = 6;
  const PAGE_SIZE = 20;
  const MESSAGE_PAGE_SIZE = 50;
  const NEW_TITLE = "新しい会話";
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
  const VIEWS = ["loading-view", "config-view", "auth-view", "confirmation-view", "reset-request-view", "recovery-view", "chat-view"];
  const SAFE_ERRORS = {
    bad_request: "入力内容を確認してください。",
    unauthorized: "セッションが無効です。ログインし直してください。",
    forbidden: "この操作は許可されていません。",
    not_found: "会話を利用できません。",
    busy: "この会話では回答を作成中です。",
    rate_limited: "短時間の利用上限に達しました。時間をおいてください。",
    upstream_rate_limited: "AIサービスの利用上限に達しました。時間をおいてください。",
    upstream_unavailable: "AIサービスへ接続できませんでした。時間をおいて再試行してください。",
    upstream_timeout: "AIの回答を待つ時間が上限を超えました。再試行してください。",
    invalid_upstream_response: "AIサービスの応答を確認できませんでした。",
    database_error: "会話を保存できませんでした。時間をおいて再試行してください。"
  };

  const elements = Object.fromEntries(Array.from(document.querySelectorAll("[id]"), (element) => [element.id, element]));
  const state = {
    authMode: "login",
    client: null,
    user: null,
    recovery: false,
    authGeneration: 0,
    conversations: [],
    loadingConversations: false,
    conversationCursor: null,
    hasMoreConversations: false,
    selectedConversationId: null,
    messages: [],
    messageCursor: null,
    hasOlderMessages: false,
    conversationGeneration: 0,
    sending: false,
    activeRequest: null,
    deleteConversationId: null,
    deleteReturnFocus: null,
    noticeTimer: null,
    noticeExitTimer: null,
    noticeType: null
  };

  const config = validateConfig(window.APP_CONFIG);
  if (!config || !window.supabase?.createClient) {
    showView("config-view");
    return;
  }

  state.client = window.supabase.createClient(config.url, config.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  // Supabaseが認証URLを処理する前にURLを書き換えない。監視は初期セッション取得より先に登録する。
  state.client.auth.onAuthStateChange((event, session) => {
    const generation = ++state.authGeneration;
    if (event === "PASSWORD_RECOVERY") {
      state.recovery = true;
      state.user = session?.user || null;
      window.setTimeout(() => {
        if (generation === state.authGeneration && state.recovery) showRecoveryView();
      }, 0);
      return;
    }
    window.setTimeout(() => handleAuthEvent(event, session, generation), 0);
  });

  bindEvents();
  initialize();

  async function initialize() {
    showView("loading-view");
    const recoveryHint = hasRecoveryHint();
    if (recoveryHint) {
      await waitForRecoveryEvent();
      if (state.recovery) return;
      showAuthView("login");
      showNotice("再設定リンクが無効または期限切れです。もう一度再設定メールを要求してください。", "error");
      return;
    }
    const { data, error } = await state.client.auth.getSession();
    if (state.recovery) return;
    if (error) {
      showAuthView("login");
      showNotice("認証状態を確認できませんでした。ログインしてください。", "error");
      return;
    }
    await applySession(data.session, state.authGeneration);
  }

  async function handleAuthEvent(event, session, generation) {
    if (generation !== state.authGeneration || state.recovery) return;
    if (event === "SIGNED_OUT") {
      completeLogout();
      return;
    }
    if (["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED", "USER_UPDATED"].includes(event)) {
      await applySession(session, generation);
    }
  }

  async function applySession(session, generation) {
    if (state.recovery || generation !== state.authGeneration) return;
    if (!session?.user?.id) {
      resetChatState();
      showAuthView("login");
      return;
    }
    const changedUser = state.user?.id !== session.user.id;
    state.user = session.user;
    if (changedUser) resetConversationState();
    showView("chat-view");
    elements["signed-in-user"].textContent = session.user.email ? `ログイン中：${session.user.email}` : "ログイン中";
    if (changedUser || state.conversations.length === 0) await loadInitialConversations(generation);
  }

  function bindEvents() {
    elements["login-tab"].addEventListener("click", () => showAuthView("login"));
    elements["signup-tab"].addEventListener("click", () => showAuthView("signup"));
    elements["auth-form"].addEventListener("submit", submitAuth);
    elements["forgot-password-button"].addEventListener("click", () => showView("reset-request-view"));
    elements["reset-request-back"].addEventListener("click", () => showAuthView("login"));
    elements["reset-request-form"].addEventListener("submit", requestPasswordReset);
    elements["recovery-form"].addEventListener("submit", updatePassword);
    elements["confirmation-back"].addEventListener("click", () => showAuthView("login"));
    elements["logout-button"].addEventListener("click", logout);
    elements["new-conversation-button"].addEventListener("click", createConversation);
    elements["conversation-toggle"].addEventListener("click", toggleConversationDrawer);
    elements["load-more-conversations"].addEventListener("click", loadMoreConversations);
    elements["load-older-messages"].addEventListener("click", loadOlderMessages);
    elements["message-input"].addEventListener("input", updateComposer);
    elements["message-input"].addEventListener("keydown", handleComposerKeydown);
    elements["message-form"].addEventListener("submit", sendMessage);
    elements["delete-conversation-button"].addEventListener("click", () => openDeleteDialog(state.selectedConversationId));
    elements["delete-dialog"].addEventListener("close", handleDeleteDialogClose);
    elements["delete-dialog"].addEventListener("cancel", () => { state.deleteReturnFocus = elements["delete-conversation-button"]; });
  }

  function validateConfig(value) {
    if (!value || typeof value !== "object") return null;
    const url = String(value.SUPABASE_URL || "").trim();
    const key = String(value.SUPABASE_PUBLISHABLE_KEY || "").trim();
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) return null;
    if (!key || /YOUR_|PLACEHOLDER|CHANGE_ME/i.test(key)) return null;
    return { url, key };
  }

  function showView(id) {
    for (const viewId of VIEWS) elements[viewId].hidden = viewId !== id;
  }

  function showAuthView(mode) {
    state.authMode = mode;
    showView("auth-view");
    const signup = mode === "signup";
    elements["auth-title"].textContent = signup ? "アカウント作成" : "ログイン";
    elements["auth-description"].textContent = signup ? "確認メールが届く場合は、メール確認後にログインしてください。" : "保存済みの会話を開くにはログインしてください。";
    elements["auth-submit"].textContent = signup ? "アカウントを作成" : "ログイン";
    elements["auth-password"].autocomplete = signup ? "new-password" : "current-password";
    if (signup) elements["auth-password"].setAttribute("minlength", String(SIGNUP_PASSWORD_MIN_LENGTH));
    else elements["auth-password"].removeAttribute("minlength");
    elements["auth-password-hint"].textContent = signup
      ? `${SIGNUP_PASSWORD_MIN_LENGTH}文字以上。Supabaseプロジェクトの設定と同じ要件です。`
      : "登録済みのパスワードを入力してください。";
    elements["login-tab"].classList.toggle("is-active", !signup);
    elements["signup-tab"].classList.toggle("is-active", signup);
    elements["login-tab"].setAttribute("aria-selected", String(!signup));
    elements["signup-tab"].setAttribute("aria-selected", String(signup));
    clearFieldError("auth-error", "auth-email", "auth-password");
  }

  async function submitAuth(event) {
    event.preventDefault();
    const email = elements["auth-email"].value.trim();
    const password = elements["auth-password"].value;
    const invalidEmail = state.authMode === "signup"
      ? !email || !elements["auth-email"].validity.valid
      : email.length === 0;
    const invalidPassword = state.authMode === "signup"
      ? password.length < SIGNUP_PASSWORD_MIN_LENGTH
      : password.length === 0;
    if (invalidEmail || invalidPassword) {
      const message = state.authMode === "signup"
        ? `メールアドレスと${SIGNUP_PASSWORD_MIN_LENGTH}文字以上のパスワードを確認してください。`
        : "メールアドレスとパスワードを入力してください。";
      setFieldError("auth-error", message, "auth-email", "auth-password");
      return;
    }
    setBusy(elements["auth-submit"], true, "処理中…");
    clearFieldError("auth-error", "auth-email", "auth-password");
    try {
      if (state.authMode === "signup") {
        const redirect = applicationRedirectUrl();
        if (!redirect) throw new Error("local_server_required");
        const { data, error } = await state.client.auth.signUp({ email, password, options: { emailRedirectTo: redirect } });
        if (error) throw error;
        elements["auth-password"].value = "";
        if (data.session) showNotice("アカウントを作成しました。", "success");
        else showView("confirmation-view");
      } else {
        const { error } = await state.client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        elements["auth-password"].value = "";
      }
    } catch (error) {
      const message = error?.message === "local_server_required"
        ? "ローカルHTTPサーバーまたは公開ページから操作してください。"
        : "認証できませんでした。入力内容を確認してください。";
      setFieldError("auth-error", message, "auth-email", "auth-password");
    } finally {
      setBusy(elements["auth-submit"], false, state.authMode === "signup" ? "アカウントを作成" : "ログイン");
    }
  }

  async function requestPasswordReset(event) {
    event.preventDefault();
    const email = elements["reset-email"].value.trim();
    const redirectTo = applicationRedirectUrl();
    if (!redirectTo) {
      setFieldError("reset-request-error", "file:では利用できません。localhost:8000から開いてください。", "reset-email");
      return;
    }
    if (!email || !elements["reset-email"].validity.valid) {
      setFieldError("reset-request-error", "メールアドレスを確認してください。", "reset-email");
      return;
    }
    setBusy(elements["reset-request-submit"], true, "送信中…");
    const { error } = await state.client.auth.resetPasswordForEmail(email, { redirectTo });
    setBusy(elements["reset-request-submit"], false, "再設定メールを送信");
    if (error) {
      setFieldError("reset-request-error", "再設定メールを送信できませんでした。", "reset-email");
      return;
    }
    showAuthView("login");
    showNotice("再設定メールを送信しました。メールを確認してください。", "success");
  }

  function applicationRedirectUrl() {
    if (window.location.protocol === "file:") return null;
    if (window.location.origin === "http://localhost:8000") {
      return "http://localhost:8000/apps/intermediate/part05-ai-assistant/";
    }
    if (window.location.origin === "https://koutamada.github.io") {
      return "https://koutamada.github.io/impact-cell-ai-training/apps/intermediate/part05-ai-assistant/";
    }
    return null;
  }

  function hasRecoveryHint() {
    const search = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    return search.has("code") || hash.get("type") === "recovery" || hash.has("access_token");
  }

  async function waitForRecoveryEvent() {
    await new Promise((resolve) => window.setTimeout(resolve, 900));
  }

  function showRecoveryView() {
    showView("recovery-view");
    clearFieldError("recovery-error", "new-password", "confirm-password");
  }

  async function updatePassword(event) {
    event.preventDefault();
    if (!state.recovery) return;
    const password = elements["new-password"].value;
    const confirmation = elements["confirm-password"].value;
    if (password.length < SIGNUP_PASSWORD_MIN_LENGTH || password !== confirmation) {
      setFieldError("recovery-error", `${SIGNUP_PASSWORD_MIN_LENGTH}文字以上の同じパスワードを2か所へ入力してください。`, "new-password", "confirm-password");
      return;
    }
    setBusy(elements["recovery-submit"], true, "変更中…");
    const { error } = await state.client.auth.updateUser({ password });
    if (error) {
      setBusy(elements["recovery-submit"], false, "パスワードを変更");
      setFieldError("recovery-error", "パスワードを変更できませんでした。リンクを再発行してください。", "new-password", "confirm-password");
      return;
    }
    state.recovery = false;
    await state.client.auth.signOut();
    elements["new-password"].value = "";
    elements["confirm-password"].value = "";
    showAuthView("login");
    showNotice("パスワードを変更しました。新しいパスワードでログインしてください。", "success");
  }

  async function logout() {
    clearSuccessNotice();
    setBusy(elements["logout-button"], true, "ログアウト中…");
    try {
      const { error } = await state.client.auth.signOut();
      if (error) {
        showNotice("ログアウトできませんでした。もう一度お試しください。", "error");
        return;
      }
      completeLogout();
    } catch {
      showNotice("ログアウトできませんでした。もう一度お試しください。", "error");
    } finally {
      setBusy(elements["logout-button"], false, "ログアウト");
    }
  }

  function completeLogout() {
    invalidateAsyncWork();
    resetChatState();
    elements["signed-in-user"].textContent = "";
    elements["conversation-status"].textContent = "";
    elements["conversation-status"].hidden = true;
    elements["history-status"].textContent = "";
    elements["history-status"].hidden = true;
    elements["send-status"].textContent = "";
    elements["send-status"].hidden = true;
    clearFieldError("message-error", "message-input");
    renderConversations();
    renderMessages(false);
    renderCurrentConversation();
    showAuthView("login");
  }

  async function loadInitialConversations(authGeneration) {
    if (state.loadingConversations) return;
    state.loadingConversations = true;
    elements["conversation-status"].hidden = false;
    elements["conversation-status"].textContent = "会話を読み込んでいます…";
    const result = await queryConversations(null);
    state.loadingConversations = false;
    if (authGeneration !== state.authGeneration || state.recovery) return;
    if (!result) {
      elements["conversation-status"].textContent = "会話を読み込めませんでした。";
      return;
    }
    state.conversations = result.rows;
    state.hasMoreConversations = result.hasMore;
    state.conversationCursor = result.cursor;
    elements["conversation-status"].hidden = true;
    renderConversations();
    if (state.conversations.length) await selectConversation(state.conversations[0].id);
    else selectEmptyConversation();
  }

  async function queryConversations(cursor) {
    let query = state.client.from("ai_conversations")
      .select("id,title,generation_status,created_at,updated_at")
      .order("updated_at", { ascending: false }).order("id", { ascending: false }).limit(PAGE_SIZE + 1);
    if (cursor) query = query.or(`updated_at.lt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.lt.${cursor.id})`);
    const { data, error } = await query;
    if (error || !Array.isArray(data) || !data.every(validConversation)) return null;
    const rows = data.slice(0, PAGE_SIZE);
    const last = rows.at(-1);
    return { rows, hasMore: data.length > PAGE_SIZE, cursor: last ? { updatedAt: last.updated_at, id: last.id } : cursor };
  }

  async function loadMoreConversations() {
    setBusy(elements["load-more-conversations"], true, "読み込み中…");
    const result = await queryConversations(state.conversationCursor);
    setBusy(elements["load-more-conversations"], false, "過去の会話を読み込む");
    if (!result) {
      showNotice("過去の会話を読み込めませんでした。", "error");
      return;
    }
    const known = new Set(state.conversations.map((row) => row.id));
    state.conversations.push(...result.rows.filter((row) => !known.has(row.id)));
    state.hasMoreConversations = result.hasMore;
    state.conversationCursor = result.cursor;
    renderConversations();
  }

  function renderConversations() {
    const fragment = document.createDocumentFragment();
    if (!state.conversations.length) {
      const empty = document.createElement("p");
      empty.className = "conversation-empty";
      empty.textContent = "保存済みの会話はありません。";
      fragment.append(empty);
    }
    for (const conversation of state.conversations) {
      const wrapper = document.createElement("div");
      wrapper.className = "conversation-item";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "conversation-select";
      button.classList.toggle("is-current", conversation.id === state.selectedConversationId);
      button.setAttribute("aria-current", conversation.id === state.selectedConversationId ? "true" : "false");
      const title = document.createElement("span");
      title.className = "conversation-name";
      title.textContent = conversation.title;
      const date = document.createElement("time");
      date.className = "conversation-date";
      date.dateTime = conversation.updated_at;
      date.textContent = formatDate(conversation.updated_at);
      button.append(title, date);
      button.addEventListener("click", () => selectConversation(conversation.id));
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "conversation-delete";
      deleteButton.textContent = "削除";
      deleteButton.setAttribute("aria-label", `「${conversation.title}」を削除`);
      deleteButton.disabled = conversation.generation_status === "generating"
        || (state.sending && conversation.id === state.selectedConversationId);
      deleteButton.addEventListener("click", () => openDeleteDialog(conversation.id));
      wrapper.append(button, deleteButton);
      fragment.append(wrapper);
    }
    elements["conversation-list"].replaceChildren(fragment);
    elements["load-more-conversations"].hidden = !state.hasMoreConversations;
  }

  function toggleConversationDrawer() {
    const open = !elements["conversation-drawer"].classList.contains("is-open");
    elements["conversation-drawer"].classList.toggle("is-open", open);
    elements["conversation-toggle"].setAttribute("aria-expanded", String(open));
    elements["conversation-toggle"].textContent = open ? "会話一覧を閉じる" : "会話一覧を表示";
  }

  function closeConversationDrawerOnNarrowScreen() {
    if (!window.matchMedia("(max-width: 900px)").matches) return;
    elements["conversation-drawer"].classList.remove("is-open");
    elements["conversation-toggle"].setAttribute("aria-expanded", "false");
    elements["conversation-toggle"].textContent = "会話一覧を表示";
  }

  async function createConversation() {
    clearSuccessNotice();
    if (!state.user || state.sending) return;
    const authGeneration = state.authGeneration;
    const userId = state.user.id;
    const previousState = snapshotConversationView();
    clearConversationForCreation();
    setBusy(elements["new-conversation-button"], true, "作成中…");
    let data = null;
    let error = null;
    try {
      const result = await state.client.from("ai_conversations")
        .insert({ user_id: userId }).select("id,title,generation_status,created_at,updated_at").single();
      data = result.data;
      error = result.error;
    } catch {
      error = new Error("conversation_creation_failed");
    }
    if (authGeneration !== state.authGeneration || userId !== state.user?.id) return;
    setBusy(elements["new-conversation-button"], false, "＋ 新しい会話");
    if (error || !validConversation(data)) {
      restoreConversationView(previousState);
      showNotice("新しい会話を作成できませんでした。", "error");
      return;
    }
    state.conversations = [data, ...state.conversations.filter((row) => row.id !== data.id)];
    await selectConversation(data.id, true);
    elements["message-input"].focus();
  }

  async function selectConversation(id, knownEmpty = false) {
    clearSuccessNotice();
    if (!UUID_PATTERN.test(id)) return;
    const generation = ++state.conversationGeneration;
    state.sending = false;
    state.selectedConversationId = id;
    state.messages = [];
    state.messageCursor = null;
    state.hasOlderMessages = false;
    state.activeRequest = null;
    elements["message-input"].value = "";
    elements["send-status"].textContent = "";
    elements["send-status"].hidden = true;
    elements["history-status"].textContent = "";
    elements["history-status"].hidden = true;
    clearFieldError("message-error", "message-input");
    renderConversations();
    renderMessages(false);
    elements["message-list"].scrollTop = 0;
    renderCurrentConversation();
    closeConversationDrawerOnNarrowScreen();
    if (knownEmpty) return;
    elements["history-status"].hidden = false;
    elements["history-status"].textContent = "メッセージを読み込んでいます…";
    const result = await queryMessages(id, null);
    if (generation !== state.conversationGeneration || id !== state.selectedConversationId) return;
    elements["history-status"].hidden = true;
    if (!result) {
      elements["history-status"].hidden = false;
      elements["history-status"].textContent = "メッセージを読み込めませんでした。";
      return;
    }
    state.messages = result.rows;
    state.messageCursor = result.cursor;
    state.hasOlderMessages = result.hasMore;
    const latestMessage = state.messages.at(-1);
    if (latestMessage?.role === "user" && latestMessage.status === "failed") {
      state.activeRequest = { requestId: latestMessage.request_id, message: latestMessage.content };
      elements["message-input"].value = latestMessage.content;
      elements["send-status"].textContent = "前回失敗したメッセージを復元しました。「送信」で同じ要求として再試行できます。";
      elements["send-status"].hidden = false;
    }
    renderMessages(true);
    renderCurrentConversation();
  }

  function snapshotConversationView() {
    return {
      selectedConversationId: state.selectedConversationId,
      messages: state.messages,
      messageCursor: state.messageCursor,
      hasOlderMessages: state.hasOlderMessages,
      activeRequest: state.activeRequest,
      input: elements["message-input"].value,
      sendStatus: elements["send-status"].textContent,
      sendStatusHidden: elements["send-status"].hidden,
      historyStatus: elements["history-status"].textContent,
      historyStatusHidden: elements["history-status"].hidden,
      scrollTop: elements["message-list"].scrollTop
    };
  }

  function clearConversationForCreation() {
    ++state.conversationGeneration;
    state.selectedConversationId = null;
    state.messages = [];
    state.messageCursor = null;
    state.hasOlderMessages = false;
    state.activeRequest = null;
    elements["message-input"].value = "";
    elements["send-status"].textContent = "";
    elements["send-status"].hidden = true;
    elements["history-status"].textContent = "";
    elements["history-status"].hidden = true;
    clearFieldError("message-error", "message-input");
    renderConversations();
    renderMessages(false);
    elements["message-list"].scrollTop = 0;
    renderCurrentConversation();
  }

  function restoreConversationView(previous) {
    state.selectedConversationId = previous.selectedConversationId;
    state.messages = previous.messages;
    state.messageCursor = previous.messageCursor;
    state.hasOlderMessages = previous.hasOlderMessages;
    state.activeRequest = previous.activeRequest;
    elements["message-input"].value = previous.input;
    elements["send-status"].textContent = previous.sendStatus;
    elements["send-status"].hidden = previous.sendStatusHidden;
    elements["history-status"].textContent = previous.historyStatus;
    elements["history-status"].hidden = previous.historyStatusHidden;
    renderConversations();
    renderMessages(false);
    renderCurrentConversation();
    elements["message-list"].scrollTop = previous.scrollTop;
  }

  async function queryMessages(conversationId, cursor) {
    let query = state.client.from("ai_messages")
      .select("id,conversation_id,role,content,request_id,status,created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(MESSAGE_PAGE_SIZE + 1);
    if (cursor) query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
    const { data, error } = await query;
    if (error || !Array.isArray(data)) return null;
    const normalized = data.map((row) => ({ ...row, id: String(row.id) }));
    if (!validMessageCollection(normalized)) return null;
    const descending = normalized.slice(0, MESSAGE_PAGE_SIZE);
    const oldest = descending.at(-1);
    return {
      rows: descending.reverse(),
      hasMore: data.length > MESSAGE_PAGE_SIZE,
      cursor: oldest ? { createdAt: oldest.created_at, id: oldest.id } : cursor
    };
  }

  async function loadOlderMessages() {
    if (!state.selectedConversationId || !state.messageCursor) return;
    const list = elements["message-list"];
    const oldHeight = list.scrollHeight;
    const oldTop = list.scrollTop;
    setBusy(elements["load-older-messages"], true, "読み込み中…");
    const id = state.selectedConversationId;
    const generation = state.conversationGeneration;
    const result = await queryMessages(id, state.messageCursor);
    setBusy(elements["load-older-messages"], false, "↑ 過去を読む");
    if (!result || generation !== state.conversationGeneration || id !== state.selectedConversationId) {
      if (!result) {
        elements["history-status"].hidden = false;
        elements["history-status"].textContent = "過去のメッセージを読み込めませんでした。";
      }
      return;
    }
    const known = new Set(state.messages.map((row) => String(row.id)));
    state.messages = [...result.rows.filter((row) => !known.has(String(row.id))), ...state.messages];
    state.messageCursor = result.cursor;
    state.hasOlderMessages = result.hasMore;
    renderMessages(false);
    list.scrollTop = oldTop + (list.scrollHeight - oldHeight);
  }

  function renderCurrentConversation() {
    const conversation = selectedConversation();
    const generating = conversation?.generation_status === "generating";
    elements["current-conversation-title"].textContent = conversation?.title || NEW_TITLE;
    elements["delete-conversation-button"].hidden = !conversation;
    elements["delete-conversation-button"].disabled = !conversation || state.sending;
    elements["message-input"].disabled = !conversation || state.sending || generating;
    elements["load-older-messages"].hidden = !state.hasOlderMessages;
    elements["message-form"].setAttribute("aria-busy", String(state.sending));
    updateComposer();
  }

  function renderMessages(scrollToBottom) {
    const fragment = document.createDocumentFragment();
    for (const message of state.messages) fragment.append(createMessageElement(message));
    elements["message-list"].replaceChildren(fragment);
    elements["empty-conversation"].hidden = state.messages.length > 0;
    elements["load-older-messages"].hidden = !state.hasOlderMessages;
    if (scrollToBottom) elements["message-list"].scrollTop = elements["message-list"].scrollHeight;
  }

  function createMessageElement(message) {
    const article = document.createElement("article");
    article.className = `message message-${message.role}`;
    if (message.status === "failed") article.classList.add("message-failed");
    const role = document.createElement("p");
    role.className = "message-role";
    role.textContent = message.role === "user" ? "あなた" : "AIアシスタント";
    const body = document.createElement("p");
    body.className = "message-body";
    body.textContent = message.content;
    const time = document.createElement("time");
    time.className = "message-time";
    time.dateTime = message.created_at;
    time.textContent = `${formatDate(message.created_at)}${message.status === "failed" ? "・送信失敗" : ""}`;
    article.append(role, body, time);
    return article;
  }

  function handleComposerKeydown(event) {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && !state.sending) {
      event.preventDefault();
      elements["message-form"].requestSubmit();
    }
  }

  function updateComposer() {
    resizeMessageInput();
    const length = [...elements["message-input"].value].length;
    elements["message-count"].textContent = `${length} / ${MAX_MESSAGE_LENGTH}`;
    elements["message-count"].classList.toggle("is-warning", length >= 1800 && length < MAX_MESSAGE_LENGTH);
    elements["message-count"].classList.toggle("is-limit", length >= MAX_MESSAGE_LENGTH);
    if (length > MAX_MESSAGE_LENGTH || CONTROL_PATTERN.test(elements["message-input"].value)) {
      setFieldError("message-error", "メッセージは許可された文字で2000文字以内にしてください。", "message-input");
    } else if (!state.sending) {
      clearFieldError("message-error", "message-input");
    }
    const generating = selectedConversation()?.generation_status === "generating";
    elements["send-button"].disabled = state.sending || generating || !state.selectedConversationId || !validUserContent(elements["message-input"].value);
  }

  function resizeMessageInput() {
    const input = elements["message-input"];
    input.style.height = "0px";
    const styles = window.getComputedStyle(input);
    const minHeight = Number.parseFloat(styles.minHeight) || 76;
    const maxHeight = Number.parseFloat(styles.maxHeight) || 180;
    const contentHeight = input.scrollHeight;
    input.style.height = `${Math.min(Math.max(contentHeight, minHeight), maxHeight)}px`;
    input.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (state.sending || !state.selectedConversationId) return;
    const content = elements["message-input"].value.trim();
    if (!validUserContent(content)) {
      setFieldError("message-error", "空白だけでは送信できません。2000文字以内で入力してください。", "message-input");
      return;
    }
    clearFieldError("message-error", "message-input");
    const retrying = state.activeRequest?.message === content;
    const requestId = retrying ? state.activeRequest.requestId : crypto.randomUUID();
    state.activeRequest = { requestId, message: content };
    state.sending = true;
    renderCurrentConversation();
    elements["send-status"].hidden = false;
    elements["send-status"].textContent = retrying ? "AIの回答を再試行しています…" : "AIが回答を作成しています…";
    const conversationId = state.selectedConversationId;
    const generation = state.conversationGeneration;
    const { data, error } = await state.client.functions.invoke("ai-chat", {
      body: { conversationId, requestId, message: content }
    });
    if (generation !== state.conversationGeneration || conversationId !== state.selectedConversationId) return;
    state.sending = false;
    elements["send-status"].hidden = true;
    if (error || !validFunctionResult(data)) {
      await refreshCurrentConversation(false);
      const code = await safeFunctionErrorCode(error, data);
      const message = SAFE_ERRORS[code] || "回答を取得できませんでした。手動で再試行できます。";
      renderCurrentConversation();
      setFieldError("message-error", message, "message-input");
      return;
    }
    state.activeRequest = null;
    elements["message-input"].value = "";
    const confirmed = data.messages.map((row) => ({ ...row, id: String(row.id) }));
    const confirmedIds = new Set(confirmed.map((row) => row.id));
    state.messages = [...state.messages.filter((row) => !confirmedIds.has(String(row.id))), ...confirmed]
      .sort(compareMessages);
    renderMessages(true);
    await refreshCurrentConversation(true);
    await refreshConversationSummary(conversationId);
    elements["message-input"].focus();
  }

  async function refreshCurrentConversation(scrollToBottom) {
    const id = state.selectedConversationId;
    if (!id) return;
    const result = await queryMessages(id, null);
    if (!result || id !== state.selectedConversationId) return;
    state.messages = result.rows;
    state.messageCursor = result.cursor;
    state.hasOlderMessages = result.hasMore;
    renderMessages(scrollToBottom);
  }

  async function safeFunctionErrorCode(error, data) {
    if (typeof data?.error?.code === "string" && SAFE_ERRORS[data.error.code]) return data.error.code;
    try {
      const response = error?.context;
      if (!(response instanceof Response)) return null;
      const payload = await response.clone().json();
      return typeof payload?.error?.code === "string" && SAFE_ERRORS[payload.error.code]
        ? payload.error.code
        : null;
    } catch {
      return null;
    }
  }

  async function refreshConversationSummary(id) {
    const { data, error } = await state.client.from("ai_conversations")
      .select("id,title,generation_status,created_at,updated_at").eq("id", id).single();
    if (error || !validConversation(data)) return;
    state.conversations = [data, ...state.conversations.filter((row) => row.id !== id)];
    renderConversations();
    renderCurrentConversation();
  }

  function openDeleteDialog(conversationId) {
    const conversation = state.conversations.find((row) => row.id === conversationId);
    if (!conversation || conversation.generation_status === "generating"
      || (state.sending && conversationId === state.selectedConversationId)) return;
    state.deleteConversationId = conversationId;
    state.deleteReturnFocus = document.activeElement;
    const title = conversation.title;
    elements["delete-dialog-description"].textContent = `「${title}」とすべてのメッセージを削除します。ゴミ箱や復元機能はありません。`;
    elements["delete-dialog"].showModal();
    elements["delete-cancel"].focus();
  }

  async function handleDeleteDialogClose() {
    if (elements["delete-dialog"].returnValue === "confirm") await deleteConversation();
    state.deleteReturnFocus?.focus?.();
    state.deleteReturnFocus = null;
    state.deleteConversationId = null;
  }

  async function deleteConversation() {
    clearSuccessNotice();
    const id = state.deleteConversationId;
    if (!id) return;
    const generation = state.conversationGeneration;
    setBusy(elements["delete-conversation-button"], true, "削除中…");
    try {
      const { error } = await state.client.from("ai_conversations").delete().eq("id", id);
      if (generation !== state.conversationGeneration) return;
      if (error) {
        showNotice("会話を削除できませんでした。", "error");
        return;
      }
      state.conversations = state.conversations.filter((row) => row.id !== id);
      if (id === state.selectedConversationId) {
        if (state.conversations.length) await selectConversation(state.conversations[0].id);
        else selectEmptyConversation();
      }
      renderConversations();
      showNotice("会話を削除しました。", "success");
    } finally {
      setBusy(elements["delete-conversation-button"], false, "会話を削除");
      renderCurrentConversation();
    }
  }

  function selectEmptyConversation() {
    ++state.conversationGeneration;
    state.selectedConversationId = null;
    state.messages = [];
    state.messageCursor = null;
    state.hasOlderMessages = false;
    state.activeRequest = null;
    renderConversations();
    renderMessages(false);
    renderCurrentConversation();
  }

  function selectedConversation() {
    return state.conversations.find((row) => row.id === state.selectedConversationId) || null;
  }

  function validConversation(row) {
    return row && typeof row === "object" && UUID_PATTERN.test(row.id)
      && typeof row.title === "string" && [...row.title].length >= 1 && [...row.title].length <= 60
      && ["idle", "generating"].includes(row.generation_status)
      && validDate(row.created_at) && validDate(row.updated_at);
  }

  function validMessage(row) {
    return row && typeof row === "object" && /^\d+$/.test(String(row.id))
      && UUID_PATTERN.test(row.conversation_id) && UUID_PATTERN.test(row.request_id)
      && ["user", "assistant"].includes(row.role)
      && ((row.role === "assistant" && row.status === "completed") || (row.role === "user" && ["pending", "completed", "failed"].includes(row.status)))
      && typeof row.content === "string" && [...row.content].length >= 1 && [...row.content].length <= (row.role === "user" ? 2000 : 12000)
      && !CONTROL_PATTERN.test(row.content) && validDate(row.created_at);
  }

  function validFunctionResult(data) {
    return data && typeof data === "object" && Array.isArray(data.messages)
      && data.messages.length === 2 && validMessageCollection(data.messages);
  }

  function validMessageCollection(rows) {
    if (!rows.every(validMessage)) return false;
    const ids = new Set();
    const turnRoles = new Set();
    for (const row of rows) {
      const id = String(row.id);
      const turnRole = `${row.request_id}:${row.role}`;
      if (ids.has(id) || turnRoles.has(turnRole)) return false;
      ids.add(id);
      turnRoles.add(turnRole);
    }
    return true;
  }

  function validUserContent(value) {
    const content = value.trim();
    const length = [...content].length;
    return length >= 1 && length <= MAX_MESSAGE_LENGTH && !CONTROL_PATTERN.test(content);
  }

  function validDate(value) {
    return typeof value === "string" && Number.isFinite(Date.parse(value));
  }

  function compareMessages(a, b) {
    const timeDifference = Date.parse(a.created_at) - Date.parse(b.created_at);
    if (timeDifference) return timeDifference;
    const left = String(a.id);
    const right = String(b.id);
    return left.length - right.length || left.localeCompare(right);
  }

  function formatDate(value) {
    try {
      return new Intl.DateTimeFormat("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
    } catch {
      return "日時不明";
    }
  }

  function setBusy(button, busy, label) {
    button.disabled = busy;
    button.setAttribute("aria-busy", String(busy));
    button.textContent = label;
  }

  function setFieldError(id, message, ...inputIds) {
    const output = elements[id];
    output.textContent = message;
    output.hidden = false;
    for (const inputId of inputIds) elements[inputId]?.setAttribute("aria-invalid", "true");
  }

  function clearFieldError(id, ...inputIds) {
    elements[id].textContent = "";
    elements[id].hidden = true;
    for (const inputId of inputIds) elements[inputId]?.removeAttribute("aria-invalid");
  }

  function showNotice(message, type = "info") {
    cancelNoticeTimers();
    resetNoticeExitStyles();
    state.noticeType = type;
    elements["global-notice"].hidden = false;
    elements["global-notice"].className = `notice notice-${type}`;
    elements["global-notice"].setAttribute("role", type === "error" ? "alert" : "status");
    elements["global-notice-icon"].textContent = type === "success" ? "✓" : type === "error" ? "!" : type === "warning" ? "△" : "i";
    elements["global-notice-text"].textContent = message;
    if (type === "success") {
      state.noticeTimer = window.setTimeout(() => {
        state.noticeTimer = null;
        if (state.noticeType === "success") beginNoticeExit();
      }, 4000);
    }
  }

  function clearSuccessNotice() {
    if (state.noticeType === "success") clearNotice();
  }

  function clearNotice() {
    cancelNoticeTimers();
    state.noticeType = null;
    resetNoticeExitStyles();
    const notice = elements["global-notice"];
    notice.hidden = true;
    elements["global-notice-icon"].textContent = "";
    elements["global-notice-text"].textContent = "";
  }

  function beginNoticeExit() {
    if (state.noticeType !== "success") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      clearNotice();
      return;
    }
    const notice = elements["global-notice"];
    notice.style.height = `${notice.offsetHeight}px`;
    notice.style.marginBottom = window.getComputedStyle(notice).marginBottom;
    void notice.offsetHeight;
    notice.classList.add("is-exiting");
    state.noticeExitTimer = window.setTimeout(() => {
      state.noticeExitTimer = null;
      if (state.noticeType === "success") clearNotice();
    }, 230);
  }

  function cancelNoticeTimers() {
    if (state.noticeTimer !== null) window.clearTimeout(state.noticeTimer);
    if (state.noticeExitTimer !== null) window.clearTimeout(state.noticeExitTimer);
    state.noticeTimer = null;
    state.noticeExitTimer = null;
  }

  function resetNoticeExitStyles() {
    const notice = elements["global-notice"];
    notice.classList.remove("is-exiting");
    notice.style.height = "";
    notice.style.marginBottom = "";
  }

  function invalidateAsyncWork() {
    ++state.authGeneration;
    ++state.conversationGeneration;
    state.sending = false;
  }

  function resetConversationState() {
    ++state.conversationGeneration;
    state.conversations = [];
    state.loadingConversations = false;
    state.conversationCursor = null;
    state.hasMoreConversations = false;
    state.selectedConversationId = null;
    state.messages = [];
    state.messageCursor = null;
    state.hasOlderMessages = false;
    state.activeRequest = null;
    state.sending = false;
  }

  function resetChatState() {
    state.user = null;
    resetConversationState();
    elements["auth-password"].value = "";
    elements["message-input"].value = "";
  }
})();
