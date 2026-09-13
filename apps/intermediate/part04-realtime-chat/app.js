(() => {
  "use strict";

  const PAGE_SIZE = 50;
  const NEAR_BOTTOM_PX = 80;
  const PASSWORD_MIN_LENGTH = 6;
  const USERNAME_MIN_LENGTH = 2;
  const USERNAME_MAX_LENGTH = 30;
  const MESSAGE_MAX_LENGTH = 1000;
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
  const MESSAGE_CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
  const RECOVERY_QUERY_KEY = "authFlow";
  const RECOVERY_QUERY_VALUE = "password-recovery";
  const LOCAL_APP_REDIRECT_URL = "http://localhost:8000/apps/intermediate/part04-realtime-chat/";
  const GITHUB_PAGES_APP_REDIRECT_URL = "https://koutamada.github.io/impact-cell-ai-training/apps/intermediate/part04-realtime-chat/";
  const initialAuthContext = inspectInitialAuthContext();

  const state = {
    client: null,
    configReady: false,
    authMode: "login",
    authStatus: "checking",
    session: null,
    user: null,
    profile: null,
    profileStatus: "idle",
    editingProfile: false,
    messagesById: new Map(),
    orderedMessageIds: [],
    profileNames: new Map(),
    profileNameVersions: new Map(),
    profileRefreshBaseline: new Map(),
    oldestCursor: null,
    newestCursor: null,
    hasOlderMessages: true,
    historyStatus: "idle",
    sendStatus: "idle",
    realtimeStatus: "disconnected",
    subscription: null,
    sessionGeneration: 0,
    subscriptionId: 0,
    unreadNewCount: 0,
    isNearBottom: true,
    initialHistoryLoaded: false,
    reconnectTimer: null,
    isComposing: false,
    recoveryActive: initialAuthContext.expectsRecovery,
    recoveryRedirectExpected: initialAuthContext.expectsRecovery,
    recoveryLinkInvalid: initialAuthContext.invalidRecovery,
    invalidRecoveryNoticeActive: false,
    recoveryCompleted: false,
    authEventQueue: Promise.resolve()
  };

  const dom = {};
  const ids = [
    "global-notice", "global-notice-icon", "global-notice-text", "loading-view", "config-view",
    "auth-view", "login-tab", "signup-tab", "auth-title", "auth-description", "auth-form",
    "auth-email", "auth-email-error", "auth-password", "auth-password-error", "auth-form-error",
    "auth-submit", "show-reset", "confirmation-view", "confirmation-back", "reset-view",
    "reset-request-form", "reset-email", "reset-email-error", "reset-request-error",
    "reset-request-submit", "reset-back", "recovery-view", "recovery-form", "new-password",
    "new-password-error", "confirm-password", "confirm-password-error", "recovery-error",
    "recovery-submit", "profile-view", "profile-title", "profile-form", "profile-username",
    "profile-error", "profile-submit", "profile-cancel", "profile-logout", "chat-view",
    "current-username", "edit-profile", "chat-logout", "connection-status", "retry-connection",
    "history-actions", "load-older", "history-status", "message-region", "message-list", "empty-messages",
    "new-message-notice", "message-form", "message-body", "message-count", "message-error",
    "message-submit"
  ];

  function cacheDom() {
    ids.forEach((id) => {
      dom[toCamelCase(id)] = document.getElementById(id);
    });
  }

  function toCamelCase(value) {
    return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  }

  function showView(viewName) {
    ["loading", "config", "auth", "confirmation", "reset", "recovery", "profile", "chat"]
      .forEach((name) => {
        dom[`${name}View`].hidden = name !== viewName;
      });
    document.body.classList.toggle("chat-active", viewName === "chat");
  }

  function currentAppRedirectUrl() {
    const redirectUrl = new URL(window.location.href);
    if (!["http:", "https:"].includes(redirectUrl.protocol)) throw new Error("unsupported-redirect-protocol");
    redirectUrl.search = "";
    redirectUrl.hash = "";
    return redirectUrl.href;
  }

  function passwordRecoveryRedirectUrl() {
    const currentUrl = new URL(window.location.href);
    if (currentUrl.protocol === "file:") throw new Error("recovery-requires-localhost");
    if (["localhost", "127.0.0.1", "[::1]"].includes(currentUrl.hostname)) {
      return LOCAL_APP_REDIRECT_URL;
    }
    if (currentUrl.origin === "https://koutamada.github.io") {
      return GITHUB_PAGES_APP_REDIRECT_URL;
    }
    throw new Error("unsupported-recovery-origin");
  }

  function inspectInitialAuthContext() {
    try {
      const url = new URL(window.location.href);
      const hash = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
      const expectsRecovery = url.searchParams.get(RECOVERY_QUERY_KEY) === RECOVERY_QUERY_VALUE
        || url.searchParams.get("type") === "recovery"
        || hash.get("type") === "recovery";
      const hasAuthError = url.searchParams.has("error")
        || url.searchParams.has("error_code")
        || hash.has("error")
        || hash.has("error_code");
      return { expectsRecovery, invalidRecovery: expectsRecovery && hasAuthError };
    } catch {
      return { expectsRecovery: false, invalidRecovery: false };
    }
  }

  function clearProcessedRecoveryUrl() {
    window.history.replaceState(window.history.state, "", currentAppRedirectUrl());
  }

  function setNotice(type, message) {
    const icons = { info: "ℹ", success: "✓", warning: "!", error: "×" };
    dom.globalNotice.className = `notice notice-${type}`;
    dom.globalNotice.setAttribute("role", type === "error" ? "alert" : "status");
    dom.globalNoticeIcon.textContent = icons[type] || icons.info;
    dom.globalNoticeText.textContent = message;
    dom.globalNotice.hidden = false;
  }

  function hideNotice() {
    dom.globalNotice.hidden = true;
  }

  function setBusy(button, busy, busyText, idleText) {
    button.disabled = busy;
    button.textContent = busy ? busyText : idleText;
    button.setAttribute("aria-busy", String(busy));
  }

  function setFieldError(input, output, message) {
    output.textContent = message;
    input.setAttribute("aria-invalid", message ? "true" : "false");
  }

  function clearAuthErrors() {
    setFieldError(dom.authEmail, dom.authEmailError, "");
    setFieldError(dom.authPassword, dom.authPasswordError, "");
    dom.authFormError.textContent = "";
  }

  function codePointLength(value) {
    return Array.from(value).length;
  }

  function isValidEmail(value) {
    const probe = document.createElement("input");
    probe.type = "email";
    probe.value = value;
    return value.length > 0 && probe.validity.valid;
  }

  function validateConfig() {
    const config = window.APP_CONFIG;
    if (!config || typeof config !== "object") return false;
    const url = config.SUPABASE_URL;
    const key = config.SUPABASE_PUBLISHABLE_KEY;
    if (typeof url !== "string" || typeof key !== "string") return false;
    if (url.includes("YOUR_") || key.includes("YOUR_")) return false;
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" && parsed.hostname.endsWith(".supabase.co") && key.startsWith("sb_publishable_");
    } catch {
      return false;
    }
  }

  function initialize() {
    cacheDom();
    bindEvents();
    renderAuthMode();
    renderMessageCount();

    if (!validateConfig() || !window.supabase || typeof window.supabase.createClient !== "function") {
      state.authStatus = "signedOut";
      showView("config");
      setNotice("warning", "Supabaseの公開用接続設定を確認してください。秘密鍵は使用しないでください。");
      return;
    }

    state.configReady = true;
    state.client = window.supabase.createClient(
      window.APP_CONFIG.SUPABASE_URL,
      window.APP_CONFIG.SUPABASE_PUBLISHABLE_KEY,
      { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
    );

    state.client.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        state.recoveryActive = true;
        state.sessionGeneration += 1;
      }
      state.authEventQueue = state.authEventQueue.then(
        () => handleAuthChange(event, session),
        () => handleAuthChange(event, session)
      );
    });
  }

  function bindEvents() {
    dom.loginTab.addEventListener("click", () => changeAuthMode("login"));
    dom.signupTab.addEventListener("click", () => changeAuthMode("signup"));
    dom.authForm.addEventListener("submit", submitAuth);
    dom.showReset.addEventListener("click", showResetRequest);
    dom.resetBack.addEventListener("click", showLogin);
    dom.confirmationBack.addEventListener("click", showLogin);
    dom.resetRequestForm.addEventListener("submit", submitResetRequest);
    dom.recoveryForm.addEventListener("submit", submitRecovery);
    dom.profileForm.addEventListener("submit", saveProfile);
    dom.profileCancel.addEventListener("click", cancelProfileEdit);
    dom.profileLogout.addEventListener("click", logout);
    dom.chatLogout.addEventListener("click", logout);
    dom.editProfile.addEventListener("click", beginProfileEdit);
    dom.loadOlder.addEventListener("click", loadOlderMessages);
    dom.retryConnection.addEventListener("click", () => startRealtime(true));
    dom.newMessageNotice.addEventListener("click", moveToBottom);
    dom.messageForm.addEventListener("submit", sendMessage);
    dom.messageBody.addEventListener("input", handleMessageInput);
    dom.messageBody.addEventListener("compositionstart", () => { state.isComposing = true; });
    dom.messageBody.addEventListener("compositionend", () => { state.isComposing = false; });
    dom.messageBody.addEventListener("keydown", handleMessageKeydown);
    dom.messageRegion.addEventListener("scroll", handleMessageScroll, { passive: true });
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("pagehide", releaseRealtime);
  }

  function changeAuthMode(mode) {
    if (mode === state.authMode) return;
    state.authMode = mode;
    clearAuthErrors();
    dom.authPassword.value = "";
    renderAuthMode();
  }

  function renderAuthMode() {
    const signup = state.authMode === "signup";
    dom.loginTab.classList.toggle("is-active", !signup);
    dom.signupTab.classList.toggle("is-active", signup);
    dom.loginTab.setAttribute("aria-selected", String(!signup));
    dom.signupTab.setAttribute("aria-selected", String(signup));
    dom.authTitle.textContent = signup ? "アカウント作成" : "ログイン";
    dom.authDescription.textContent = signup
      ? "メールアドレスとパスワードでアカウントを作成します。ユーザー名は認証後に設定します。"
      : "登録済みのメールアドレスとパスワードを入力してください。";
    dom.authSubmit.textContent = signup ? "アカウントを作成" : "ログイン";
    dom.authPassword.autocomplete = signup ? "new-password" : "current-password";
  }

  async function handleAuthChange(event, session) {
    if (!state.configReady) return;
    if (event === "PASSWORD_RECOVERY") {
      state.recoveryActive = true;
      state.recoveryCompleted = false;
      state.recoveryLinkInvalid = false;
      await releaseRealtime();
      state.profile = null;
      state.profileStatus = "idle";
      state.editingProfile = false;
      resetChatState();
      state.session = session;
      state.user = session?.user || null;
      state.authStatus = "recovery";
      showView("recovery");
      setNotice("info", "新しいパスワードを設定してください。");
      return;
    }

    if (state.recoveryLinkInvalid) {
      state.recoveryActive = false;
      state.recoveryRedirectExpected = false;
      state.recoveryLinkInvalid = false;
      state.invalidRecoveryNoticeActive = true;
      try { await state.client.auth.signOut(); } catch { /* The invalid-link screen remains authoritative. */ }
      await clearProtectedState();
      state.authStatus = "signedOut";
      showView("auth");
      setNotice("error", "再設定リンクが無効または期限切れです。もう一度再設定メールを送信してください。");
      clearProcessedRecoveryUrl();
      return;
    }

    if (state.recoveryActive && session?.user) {
      state.session = session;
      state.user = session.user;
      state.authStatus = "recovery";
      showView("recovery");
      setNotice("info", "新しいパスワードを設定してください。");
      return;
    }

    if (!session?.user) {
      const recoveryCompleted = state.recoveryCompleted;
      const invalidRecovery = !recoveryCompleted && (
        state.recoveryLinkInvalid || state.recoveryRedirectExpected
        || state.recoveryActive || state.invalidRecoveryNoticeActive
      );
      state.recoveryActive = false;
      state.recoveryRedirectExpected = false;
      state.recoveryLinkInvalid = false;
      state.invalidRecoveryNoticeActive = false;
      await clearProtectedState();
      state.authStatus = "signedOut";
      showView("auth");
      setNotice(
        recoveryCompleted ? "success" : invalidRecovery ? "error" : "info",
        recoveryCompleted
          ? "パスワードを変更しました。新しいパスワードでログインしてください。"
          : invalidRecovery
            ? "再設定リンクが無効または期限切れです。もう一度再設定メールを送信してください。"
          : "ログインすると共通チャットを利用できます。"
      );
      if (invalidRecovery) clearProcessedRecoveryUrl();
      return;
    }

    state.recoveryCompleted = false;

    if (state.user?.id === session.user.id && state.profileStatus === "ready") {
      state.session = session;
      state.user = session.user;
      return;
    }

    await activateSession(session);
  }

  async function activateSession(session) {
    if (state.recoveryActive) return;
    await releaseRealtime();
    if (state.recoveryActive) return;
    state.sessionGeneration += 1;
    resetChatState();
    state.session = session;
    state.user = session.user;
    state.authStatus = "signedIn";
    state.profileStatus = "loading";
    showView("loading");
    setNotice("info", "プロフィールを確認しています。");
    await loadOwnProfile(state.sessionGeneration, session.user.id);
  }

  async function clearProtectedState() {
    state.sessionGeneration += 1;
    await releaseRealtime();
    state.session = null;
    state.user = null;
    state.profile = null;
    state.profileStatus = "idle";
    state.editingProfile = false;
    resetChatState();
    dom.authPassword.value = "";
    dom.newPassword.value = "";
    dom.confirmPassword.value = "";
  }

  function resetChatState() {
    state.messagesById.clear();
    state.orderedMessageIds = [];
    state.profileNames.clear();
    state.profileNameVersions.clear();
    state.profileRefreshBaseline.clear();
    state.oldestCursor = null;
    state.newestCursor = null;
    state.hasOlderMessages = true;
    state.historyStatus = "idle";
    state.sendStatus = "idle";
    state.unreadNewCount = 0;
    state.initialHistoryLoaded = false;
    dom.messageBody.value = "";
    renderMessageCount();
    renderMessages();
  }

  async function submitAuth(event) {
    event.preventDefault();
    if (!state.client || dom.authSubmit.disabled) return;
    state.recoveryCompleted = false;
    clearAuthErrors();
    const email = dom.authEmail.value.trim();
    const password = dom.authPassword.value;
    let invalid = false;
    if (!isValidEmail(email)) {
      setFieldError(dom.authEmail, dom.authEmailError, "有効なメールアドレスを入力してください。");
      invalid = true;
    }
    if (password.length < PASSWORD_MIN_LENGTH) {
      setFieldError(dom.authPassword, dom.authPasswordError, `${PASSWORD_MIN_LENGTH}文字以上のパスワードを入力してください。`);
      invalid = true;
    }
    if (invalid) return;

    const signup = state.authMode === "signup";
    setBusy(dom.authSubmit, true, signup ? "作成中…" : "ログイン中…", signup ? "アカウントを作成" : "ログイン");
    try {
      if (signup) {
        const redirectTo = currentAppRedirectUrl();
        const { data, error } = await state.client.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
        if (error) throw error;
        dom.authPassword.value = "";
        if (!data.session) {
          state.authStatus = "confirmationPending";
          showView("confirmation");
          setNotice("success", "確認メールを送信しました。メール内のリンクで登録を完了してください。");
        }
      } else {
        const { error } = await state.client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        dom.authPassword.value = "";
      }
    } catch {
      dom.authFormError.textContent = signup
        ? "登録を完了できませんでした。入力内容またはメールをご確認ください。"
        : "ログインできませんでした。入力内容をご確認ください。";
      setNotice("error", signup ? "アカウント作成に失敗しました。" : "ログインに失敗しました。");
    } finally {
      setBusy(dom.authSubmit, false, "", signup ? "アカウントを作成" : "ログイン");
    }
  }

  function showResetRequest() {
    dom.resetEmail.value = dom.authEmail.value.trim();
    setFieldError(dom.resetEmail, dom.resetEmailError, "");
    dom.resetRequestError.textContent = "";
    showView("reset");
    setNotice("info", "パスワード再設定用のメールを送信します。");
  }

  function showLogin(noticeMessage = "ログイン情報を入力してください。") {
    state.authMode = "login";
    renderAuthMode();
    showView("auth");
    if (noticeMessage) setNotice("info", noticeMessage);
  }

  async function submitResetRequest(event) {
    event.preventDefault();
    if (!state.client || dom.resetRequestSubmit.disabled) return;
    const email = dom.resetEmail.value.trim();
    setFieldError(dom.resetEmail, dom.resetEmailError, "");
    dom.resetRequestError.textContent = "";
    if (!isValidEmail(email)) {
      setFieldError(dom.resetEmail, dom.resetEmailError, "有効なメールアドレスを入力してください。");
      return;
    }
    setBusy(dom.resetRequestSubmit, true, "送信中…", "再設定メールを送る");
    try {
      const redirectTo = passwordRecoveryRedirectUrl();
      const { error } = await state.client.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      showLogin("");
      setNotice("success", "該当するアカウントがある場合、再設定メールを送信しました。");
    } catch (error) {
      const invalidOrigin = error instanceof Error
        && ["recovery-requires-localhost", "unsupported-recovery-origin"].includes(error.message);
      dom.resetRequestError.textContent = invalidOrigin
        ? "この表示方法では再設定メールを要求できません。localhost:8000でアプリを開いてください。"
        : "再設定メールを送信できませんでした。時間をおいてお試しください。";
      setNotice("error", invalidOrigin
        ? "パスワード再設定はlocalhost:8000または公開ページから実行してください。"
        : "パスワード再設定の要求に失敗しました。");
    } finally {
      setBusy(dom.resetRequestSubmit, false, "", "再設定メールを送る");
    }
  }

  async function submitRecovery(event) {
    event.preventDefault();
    if (!state.client || !state.recoveryActive || dom.recoverySubmit.disabled) return;
    const password = dom.newPassword.value;
    const confirmation = dom.confirmPassword.value;
    setFieldError(dom.newPassword, dom.newPasswordError, "");
    setFieldError(dom.confirmPassword, dom.confirmPasswordError, "");
    dom.recoveryError.textContent = "";
    if (password.length < PASSWORD_MIN_LENGTH) {
      setFieldError(dom.newPassword, dom.newPasswordError, `${PASSWORD_MIN_LENGTH}文字以上で入力してください。`);
      return;
    }
    if (password !== confirmation) {
      setFieldError(dom.confirmPassword, dom.confirmPasswordError, "新しいパスワードが一致しません。");
      return;
    }
    setBusy(dom.recoverySubmit, true, "更新中…", "パスワードを更新");
    try {
      const { error } = await state.client.auth.updateUser({ password });
      if (error) throw error;
      dom.newPassword.value = "";
      dom.confirmPassword.value = "";
      state.recoveryActive = false;
      state.recoveryRedirectExpected = false;
      state.recoveryLinkInvalid = false;
      state.recoveryCompleted = true;
      clearProcessedRecoveryUrl();
      state.sessionGeneration += 1;
      await releaseRealtime();
      const { error: signOutError } = await state.client.auth.signOut();
      if (signOutError) throw signOutError;
      if (state.session || state.user) {
        await clearProtectedState();
        state.authStatus = "signedOut";
        showView("auth");
        setNotice("success", "パスワードを変更しました。新しいパスワードでログインしてください。");
      }
    } catch {
      dom.recoveryError.textContent = "パスワードを更新できませんでした。リンクの有効期限をご確認ください。";
      setNotice("error", "パスワード更新に失敗しました。");
    } finally {
      setBusy(dom.recoverySubmit, false, "", "パスワードを更新");
    }
  }

  async function loadOwnProfile(generation, userId) {
    try {
      const { data, error } = await state.client.from("profiles").select("id,username").eq("id", userId).maybeSingle();
      if (!isCurrentSession(generation, userId)) return;
      if (error) throw error;
      if (!data) {
        state.profileStatus = "missing";
        state.profile = null;
        state.editingProfile = false;
        renderProfileView();
        setNotice("info", "チャットで使用するユーザー名を設定してください。");
        return;
      }
      const profile = validateProfile(data);
      if (!profile) throw new Error("invalid-profile");
      state.profile = profile;
      bumpProfileNameVersion(profile.id);
      state.profileNames.set(profile.id, profile.username);
      state.profileStatus = "ready";
      renderChatView();
      await startRealtime(false);
    } catch {
      if (!isCurrentSession(generation, userId)) return;
      state.profileStatus = "error";
      renderProfileView();
      dom.profileError.textContent = "プロフィールを確認できませんでした。再読み込みするか、時間をおいてお試しください。";
      setNotice("error", "プロフィールの取得に失敗しました。");
    }
  }

  function validateProfile(raw) {
    if (!raw || typeof raw !== "object" || !UUID_PATTERN.test(raw.id) || typeof raw.username !== "string") return null;
    const username = raw.username;
    const length = codePointLength(username);
    if (username !== username.trim() || length < USERNAME_MIN_LENGTH || length > USERNAME_MAX_LENGTH || CONTROL_PATTERN.test(username)) return null;
    return { id: raw.id, username };
  }

  function validateUsername(value) {
    const username = value.trim();
    const length = codePointLength(username);
    if (length < USERNAME_MIN_LENGTH || length > USERNAME_MAX_LENGTH) return { error: "ユーザー名は前後空白を除いて2〜30文字で入力してください。" };
    if (CONTROL_PATTERN.test(username)) return { error: "ユーザー名に制御文字は使用できません。" };
    return { value: username };
  }

  function renderProfileView() {
    showView("profile");
    const editing = state.editingProfile && Boolean(state.profile);
    dom.profileTitle.textContent = editing ? "ユーザー名を変更" : "ユーザー名を設定";
    dom.profileSubmit.textContent = state.profileStatus === "error"
      ? "プロフィールを再確認"
      : editing ? "変更を保存" : "ユーザー名を保存";
    dom.profileCancel.hidden = !editing;
    dom.profileUsername.value = editing ? state.profile.username : "";
    dom.profileError.textContent = state.profileStatus === "error"
      ? "プロフィールを確認できませんでした。再読み込みするか、時間をおいてお試しください。"
      : "";
    dom.profileUsername.setAttribute("aria-invalid", "false");
  }

  async function saveProfile(event) {
    event.preventDefault();
    if (!state.client || !state.user || dom.profileSubmit.disabled) return;
    if (state.profileStatus === "error") {
      state.profileStatus = "loading";
      setBusy(dom.profileSubmit, true, "確認中…", "プロフィールを再確認");
      await loadOwnProfile(state.sessionGeneration, state.user.id);
      setBusy(dom.profileSubmit, false, "", "プロフィールを再確認");
      return;
    }
    const result = validateUsername(dom.profileUsername.value);
    if (result.error) {
      setFieldError(dom.profileUsername, dom.profileError, result.error);
      return;
    }
    setFieldError(dom.profileUsername, dom.profileError, "");
    const generation = state.sessionGeneration;
    const userId = state.user.id;
    const editing = state.editingProfile && Boolean(state.profile);
    state.profileStatus = "saving";
    setBusy(dom.profileSubmit, true, "保存中…", editing ? "変更を保存" : "ユーザー名を保存");
    try {
      const query = editing
        ? state.client.from("profiles").update({ username: result.value }).eq("id", userId)
        : state.client.from("profiles").insert({ id: userId, username: result.value });
      const { data, error } = await query.select("id,username").single();
      if (!isCurrentSession(generation, userId)) return;
      if (error) throw error;
      const profile = validateProfile(data);
      if (!profile) throw new Error("invalid-profile");
      state.profile = profile;
      state.profileNames.set(profile.id, profile.username);
      state.profileStatus = "ready";
      state.editingProfile = false;
      if (editing) {
        renderMessages();
        renderChatView();
        setNotice("success", "ユーザー名を変更しました。");
      } else {
        renderChatView();
        setNotice("success", "プロフィールを登録しました。");
        await startRealtime(false);
      }
    } catch (error) {
      if (!isCurrentSession(generation, userId)) return;
      state.profileStatus = state.profile ? "ready" : "missing";
      const duplicate = error && typeof error === "object" && error.code === "23505";
      setFieldError(dom.profileUsername, dom.profileError, duplicate
        ? "このユーザー名は使用できません。別の名前を入力してください。"
        : "ユーザー名を保存できませんでした。時間をおいてお試しください。");
      setNotice("error", "プロフィールの保存に失敗しました。");
    } finally {
      if (isCurrentSession(generation, userId)) setBusy(dom.profileSubmit, false, "", editing ? "変更を保存" : "ユーザー名を保存");
    }
  }

  function beginProfileEdit() {
    state.editingProfile = true;
    renderProfileView();
    dom.profileUsername.focus();
  }

  function cancelProfileEdit() {
    state.editingProfile = false;
    renderChatView();
    dom.editProfile.focus();
  }

  async function logout() {
    if (!state.client) return;
    const generation = ++state.sessionGeneration;
    await releaseRealtime();
    setNotice("info", "ログアウトしています。");
    try {
      const { error } = await state.client.auth.signOut();
      if (error) throw error;
    } catch {
      const { data } = await state.client.auth.getSession();
      if (generation !== state.sessionGeneration) return;
      if (data?.session) {
        state.session = data.session;
        state.user = data.session.user;
        setNotice("error", "ログアウトできませんでした。通信状態をご確認ください。");
        if (state.profile) renderChatView();
      } else {
        await clearProtectedState();
        showLogin();
      }
    }
  }

  function isCurrentSession(generation, userId) {
    return generation === state.sessionGeneration && state.user?.id === userId;
  }

  function renderChatView() {
    if (!state.profile || !state.user) return;
    showView("chat");
    dom.currentUsername.textContent = state.profile.username;
    renderConnectionStatus();
    renderHistoryStatus();
    renderMessages();
    updateSendAvailability();
  }

  async function startRealtime(isReconnect) {
    if (!state.client || !state.user || !state.profile) return;
    await releaseRealtime();
    const generation = state.sessionGeneration;
    const userId = state.user.id;
    const subscriptionId = ++state.subscriptionId;
    state.profileRefreshBaseline = new Map(state.profileNameVersions);
    state.realtimeStatus = isReconnect ? "reconnecting" : "connecting";
    renderConnectionStatus();

    const channel = state.client
      .channel(`messages-${userId}-${subscriptionId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        handleRealtimeInsert(payload, generation, userId, subscriptionId);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" }, (payload) => {
        handleRealtimeProfileUpdate(payload, generation, userId, subscriptionId);
      });
    state.subscription = channel;
    channel.subscribe((status) => {
      if (!isCurrentSubscription(generation, userId, subscriptionId)) return;
      handleChannelStatus(status, isReconnect, generation, userId, subscriptionId);
    });
  }

  function isCurrentSubscription(generation, userId, subscriptionId) {
    return isCurrentSession(generation, userId) && state.subscriptionId === subscriptionId;
  }

  async function handleChannelStatus(status, isReconnect, generation, userId, subscriptionId) {
    if (!isCurrentSubscription(generation, userId, subscriptionId)) return;
    if (status === "SUBSCRIBED") {
      if (!state.initialHistoryLoaded) {
        await loadInitialHistory(generation, userId, subscriptionId);
      } else {
        state.realtimeStatus = "reconnecting";
        renderConnectionStatus();
        await resyncMessages(generation, userId, subscriptionId);
      }
      return;
    }
    if (["TIMED_OUT", "CHANNEL_ERROR"].includes(status)) {
      state.realtimeStatus = "reconnecting";
      renderConnectionStatus();
      dom.retryConnection.hidden = false;
      setNotice("warning", "リアルタイム接続が中断しました。再接続を試みます。");
      scheduleReconnect();
      return;
    }
    if (status === "CLOSED") {
      state.realtimeStatus = "disconnected";
      renderConnectionStatus();
      dom.retryConnection.hidden = false;
      if (navigator.onLine) scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (state.reconnectTimer || !navigator.onLine || !state.user || !state.profile) return;
    state.reconnectTimer = window.setTimeout(() => {
      state.reconnectTimer = null;
      startRealtime(true);
    }, 2500);
  }

  async function releaseRealtime() {
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    state.subscriptionId += 1;
    const channel = state.subscription;
    state.subscription = null;
    state.realtimeStatus = "disconnected";
    if (channel && state.client) {
      try { await state.client.removeChannel(channel); } catch { /* A stale channel is already unusable. */ }
    }
  }

  function renderConnectionStatus() {
    const labels = {
      connecting: ["接続中", "status-connecting"],
      connected: ["接続済み", "status-connected"],
      reconnecting: ["再接続中", "status-reconnecting"],
      disconnected: ["切断", "status-disconnected"]
    };
    const [label, className] = labels[state.realtimeStatus];
    dom.connectionStatus.className = `connection-status ${className}`;
    dom.connectionStatus.textContent = `● ${label}`;
    dom.retryConnection.hidden = !["reconnecting", "disconnected"].includes(state.realtimeStatus);
  }

  async function loadInitialHistory(generation, userId, subscriptionId) {
    state.historyStatus = "loadingInitial";
    renderHistoryStatus();
    try {
      const { data, error } = await state.client.from("messages")
        .select("id,user_id,body,created_at")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(PAGE_SIZE);
      if (!isCurrentSubscription(generation, userId, subscriptionId)) return;
      if (error) throw error;
      const messages = validateMessageRows(data);
      if (!messages) throw new Error("invalid-history");
      await mergeMessagesWithProfiles(messages, generation, userId, subscriptionId);
      if (!isCurrentSubscription(generation, userId, subscriptionId)) return;
      state.hasOlderMessages = messages.length === PAGE_SIZE;
      state.initialHistoryLoaded = true;
      state.historyStatus = "idle";
      state.realtimeStatus = "connected";
      updateCursors();
      renderMessages();
      renderHistoryStatus();
      renderConnectionStatus();
      requestAnimationFrame(() => moveToBottom(false));
      hideNotice();
    } catch {
      if (!isCurrentSubscription(generation, userId, subscriptionId)) return;
      state.historyStatus = "error";
      state.realtimeStatus = "reconnecting";
      renderHistoryStatus();
      renderConnectionStatus();
      setNotice("error", "メッセージ履歴を取得できませんでした。再接続してください。");
    }
  }

  function normalizeMessage(raw) {
    if (!raw || typeof raw !== "object") return null;
    const id = typeof raw.id === "string" ? raw.id : (Number.isSafeInteger(raw.id) ? String(raw.id) : "");
    const createdAt = typeof raw.created_at === "string" ? raw.created_at : "";
    if (!/^[1-9]\d*$/.test(id) || !UUID_PATTERN.test(raw.user_id) || typeof raw.body !== "string") return null;
    if (!Number.isFinite(Date.parse(createdAt))) return null;
    const length = codePointLength(raw.body);
    if (raw.body !== raw.body.trim() || length < 1 || length > MESSAGE_MAX_LENGTH || MESSAGE_CONTROL_PATTERN.test(raw.body)) return null;
    return { id, userId: raw.user_id, body: raw.body, createdAt, username: null };
  }

  function validateMessageRows(data) {
    if (!Array.isArray(data)) return null;
    const rows = data.map(normalizeMessage);
    return rows.some((row) => row === null) ? null : rows;
  }

  async function mergeMessagesWithProfiles(messages, generation, userId, subscriptionId) {
    const missingIds = [...new Set(messages.map((message) => message.userId))]
      .filter((id) => !state.profileNames.has(id));
    if (missingIds.length) await fetchProfileNames(missingIds, generation, userId, subscriptionId);
    if (!isCurrentSubscription(generation, userId, subscriptionId)) return;
    messages.forEach((message) => upsertMessage(message));
  }

  async function fetchProfileNames(userIds, generation, userId, subscriptionId, expectedVersions = null) {
    const requestedVersions = expectedVersions || new Map(userIds.map((id) => [id, profileNameVersion(id)]));
    const { data, error } = await state.client.from("profiles").select("id,username").in("id", userIds);
    if (!isCurrentSubscription(generation, userId, subscriptionId)) return;
    if (error || !Array.isArray(data)) throw error || new Error("invalid-profiles");
    const profiles = data.map(validateProfile);
    if (profiles.some((profile) => profile === null)) throw new Error("invalid-profiles");
    profiles.forEach((profile) => {
      if (profileNameVersion(profile.id) === requestedVersions.get(profile.id)) {
        state.profileNames.set(profile.id, profile.username);
      }
    });
  }

  function profileNameVersion(userId) {
    return state.profileNameVersions.get(userId) || 0;
  }

  function bumpProfileNameVersion(userId) {
    state.profileNameVersions.set(userId, profileNameVersion(userId) + 1);
  }

  async function refreshKnownProfiles(generation, userId, subscriptionId) {
    const userIds = new Set([userId]);
    state.messagesById.forEach((message) => userIds.add(message.userId));
    const baseline = new Map([...userIds].map((id) => [id, state.profileRefreshBaseline.get(id) || 0]));
    await fetchProfileNames([...userIds], generation, userId, subscriptionId, baseline);
  }

  function handleRealtimeProfileUpdate(payload, generation, userId, subscriptionId) {
    if (!isCurrentSubscription(generation, userId, subscriptionId)) return;
    const profile = validateProfile(payload?.new);
    if (!profile) {
      setNotice("warning", "形式を確認できないプロフィール更新を受信しました。");
      return;
    }
    bumpProfileNameVersion(profile.id);
    state.profileNames.set(profile.id, profile.username);
    if (profile.id === state.user?.id) {
      state.profile = profile;
      dom.currentUsername.textContent = profile.username;
    }
    renderMessagesPreservingViewport();
  }

  function upsertMessage(message) {
    message.username = state.profileNames.get(message.userId) || null;
    state.messagesById.set(message.id, message);
    sortMessages();
  }

  function sortMessages() {
    state.orderedMessageIds = [...state.messagesById.values()]
      .sort(compareMessages)
      .map((message) => message.id);
    updateCursors();
  }

  function compareMessages(left, right) {
    const timeDifference = Date.parse(left.createdAt) - Date.parse(right.createdAt);
    if (timeDifference !== 0) return timeDifference;
    const leftId = BigInt(left.id);
    const rightId = BigInt(right.id);
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  }

  function updateCursors() {
    const first = state.messagesById.get(state.orderedMessageIds[0]);
    const last = state.messagesById.get(state.orderedMessageIds[state.orderedMessageIds.length - 1]);
    state.oldestCursor = first ? { createdAt: first.createdAt, id: first.id } : null;
    state.newestCursor = last ? { createdAt: last.createdAt, id: last.id } : null;
  }

  async function handleRealtimeInsert(payload, generation, userId, subscriptionId) {
    if (!isCurrentSubscription(generation, userId, subscriptionId)) return;
    const message = normalizeMessage(payload?.new);
    if (!message) {
      setNotice("error", "形式を確認できない新着メッセージを受信しました。");
      return;
    }
    if (state.messagesById.has(message.id)) return;
    const wasNearBottom = isNearBottom();
    try {
      if (!state.profileNames.has(message.userId)) await fetchProfileNames([message.userId], generation, userId, subscriptionId);
      if (!isCurrentSubscription(generation, userId, subscriptionId)) return;
      upsertMessage(message);
      renderMessages();
      if (wasNearBottom) requestAnimationFrame(() => moveToBottom(false));
      else {
        state.unreadNewCount += 1;
        renderNewMessageNotice();
      }
    } catch {
      if (isCurrentSubscription(generation, userId, subscriptionId)) setNotice("warning", "新着メッセージの送信者名を確認できませんでした。");
    }
  }

  async function loadOlderMessages() {
    if (!state.client || !state.oldestCursor || !state.hasOlderMessages || !["idle", "error"].includes(state.historyStatus)) return;
    const generation = state.sessionGeneration;
    const userId = state.user.id;
    const subscriptionId = state.subscriptionId;
    const cursor = { ...state.oldestCursor };
    const previousHeight = dom.messageRegion.scrollHeight;
    const previousTop = dom.messageRegion.scrollTop;
    state.historyStatus = "loadingOlder";
    renderHistoryStatus();
    try {
      const filter = `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`;
      const { data, error } = await state.client.from("messages")
        .select("id,user_id,body,created_at")
        .or(filter)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(PAGE_SIZE);
      if (!isCurrentSubscription(generation, userId, subscriptionId)) return;
      if (error) throw error;
      const messages = validateMessageRows(data);
      if (!messages) throw new Error("invalid-history");
      await mergeMessagesWithProfiles(messages, generation, userId, subscriptionId);
      if (!isCurrentSubscription(generation, userId, subscriptionId)) return;
      state.hasOlderMessages = messages.length === PAGE_SIZE;
      state.historyStatus = "idle";
      renderMessages();
      renderHistoryStatus();
      requestAnimationFrame(() => {
        const addedHeight = dom.messageRegion.scrollHeight - previousHeight;
        dom.messageRegion.scrollTop = previousTop + addedHeight;
      });
    } catch {
      if (!isCurrentSubscription(generation, userId, subscriptionId)) return;
      state.historyStatus = "error";
      renderHistoryStatus();
      setNotice("error", "過去のメッセージを取得できませんでした。もう一度お試しください。");
    }
  }

  async function resyncMessages(generation, userId, subscriptionId) {
    state.historyStatus = "resyncing";
    renderHistoryStatus();
    try {
      await refreshKnownProfiles(generation, userId, subscriptionId);
      if (!isCurrentSubscription(generation, userId, subscriptionId)) return;
      let cursor = state.newestCursor ? { ...state.newestCursor } : null;
      while (true) {
        let query = state.client.from("messages")
          .select("id,user_id,body,created_at")
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .limit(PAGE_SIZE);
        if (cursor) {
          const filter = `created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id})`;
          query = query.or(filter);
        }
        const { data, error } = await query;
        if (!isCurrentSubscription(generation, userId, subscriptionId)) return;
        if (error) throw error;
        const messages = validateMessageRows(data);
        if (!messages) throw new Error("invalid-history");
        await mergeMessagesWithProfiles(messages, generation, userId, subscriptionId);
        if (!isCurrentSubscription(generation, userId, subscriptionId)) return;
        if (messages.length < PAGE_SIZE) break;
        const last = messages[messages.length - 1];
        cursor = { createdAt: last.createdAt, id: last.id };
      }
      state.historyStatus = "idle";
      state.realtimeStatus = "connected";
      renderMessages();
      renderHistoryStatus();
      renderConnectionStatus();
      setNotice("success", "リアルタイム接続を復旧しました。");
    } catch {
      if (!isCurrentSubscription(generation, userId, subscriptionId)) return;
      state.historyStatus = "error";
      state.realtimeStatus = "reconnecting";
      renderHistoryStatus();
      renderConnectionStatus();
      setNotice("error", "再接続後のメッセージを補完できませんでした。再試行してください。");
    }
  }

  function renderHistoryStatus() {
    const labels = {
      idle: state.hasOlderMessages ? "" : "これより前のメッセージはありません。",
      loadingInitial: "最新メッセージを読み込んでいます…",
      loadingOlder: "過去のメッセージを読み込んでいます…",
      resyncing: "切断中のメッセージを確認しています…",
      error: "履歴を取得できませんでした。"
    };
    dom.historyStatus.textContent = labels[state.historyStatus];
    const historyBusy = ["loadingInitial", "loadingOlder", "resyncing"].includes(state.historyStatus);
    dom.historyActions.hidden = state.historyStatus === "idle" && !state.hasOlderMessages;
    dom.loadOlder.hidden = historyBusy;
    dom.loadOlder.disabled = historyBusy || !state.hasOlderMessages || !state.oldestCursor;
    dom.loadOlder.setAttribute("aria-busy", String(state.historyStatus === "loadingOlder"));
  }

  function renderMessages() {
    const fragment = document.createDocumentFragment();
    state.orderedMessageIds.forEach((id) => {
      const message = state.messagesById.get(id);
      const item = document.createElement("li");
      const own = message.userId === state.user?.id;
      item.className = `message-item${own ? " is-own" : ""}`;
      item.dataset.messageId = message.id;

      const article = document.createElement("article");
      article.className = "message-bubble";
      article.setAttribute("aria-label", own ? "自分のメッセージ" : "他の利用者のメッセージ");

      const sender = document.createElement("span");
      sender.className = "message-sender";
      const username = state.profileNames.get(message.userId) || "ユーザー名を確認中";
      sender.textContent = own ? `${username}（自分）` : username;

      const body = document.createElement("p");
      body.className = "message-body";
      body.textContent = message.body;

      const time = document.createElement("time");
      time.className = "message-time";
      time.dateTime = message.createdAt;
      time.textContent = formatLocalDateTime(message.createdAt);

      article.append(sender, body, time);
      item.append(article);
      fragment.append(item);
    });
    dom.messageList.replaceChildren(fragment);
    dom.emptyMessages.hidden = state.orderedMessageIds.length > 0;
    renderNewMessageNotice();
  }

  function renderMessagesPreservingViewport() {
    const wasNearBottom = isNearBottom();
    const regionTop = dom.messageRegion.getBoundingClientRect().top;
    const anchor = [...dom.messageList.querySelectorAll(".message-item")]
      .find((item) => item.getBoundingClientRect().bottom > regionTop);
    const anchorId = anchor?.dataset.messageId || null;
    const anchorOffset = anchor ? anchor.getBoundingClientRect().top - regionTop : 0;
    renderMessages();
    if (wasNearBottom) {
      dom.messageRegion.scrollTop = dom.messageRegion.scrollHeight;
      return;
    }
    if (!anchorId) return;
    const restoredAnchor = [...dom.messageList.querySelectorAll(".message-item")]
      .find((item) => item.dataset.messageId === anchorId);
    if (restoredAnchor) {
      dom.messageRegion.scrollTop += restoredAnchor.getBoundingClientRect().top - regionTop - anchorOffset;
    }
  }

  function formatLocalDateTime(value) {
    const date = new Date(value);
    return new Intl.DateTimeFormat("ja-JP", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
    }).format(date);
  }

  function isNearBottom() {
    return dom.messageRegion.scrollHeight - dom.messageRegion.scrollTop - dom.messageRegion.clientHeight <= NEAR_BOTTOM_PX;
  }

  function handleMessageScroll() {
    state.isNearBottom = isNearBottom();
    if (state.isNearBottom && state.unreadNewCount > 0) {
      state.unreadNewCount = 0;
      renderNewMessageNotice();
    }
  }

  function moveToBottom(smooth = true) {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    dom.messageRegion.scrollTo({ top: dom.messageRegion.scrollHeight, behavior: smooth && !reduced ? "smooth" : "auto" });
    state.unreadNewCount = 0;
    state.isNearBottom = true;
    renderNewMessageNotice();
  }

  function renderNewMessageNotice() {
    dom.newMessageNotice.hidden = state.unreadNewCount === 0;
    dom.newMessageNotice.textContent = state.unreadNewCount > 0
      ? `新着メッセージ ${state.unreadNewCount}件 — 最下部へ移動`
      : "";
  }

  function handleMessageInput() {
    renderMessageCount();
    setFieldError(dom.messageBody, dom.messageError, "");
    updateSendAvailability();
  }

  function renderMessageCount() {
    if (!dom.messageBody) return;
    const length = codePointLength(dom.messageBody.value);
    dom.messageCount.textContent = `${length} / ${MESSAGE_MAX_LENGTH}`;
    dom.messageCount.classList.toggle("is-near-limit", length >= 900 && length < MESSAGE_MAX_LENGTH);
    dom.messageCount.classList.toggle("is-at-limit", length >= MESSAGE_MAX_LENGTH);
  }

  function validateMessageBody(value) {
    const body = value.trim();
    const length = codePointLength(body);
    if (length < 1) return { error: "メッセージを入力してください。" };
    if (length > MESSAGE_MAX_LENGTH) return { error: "メッセージは1000文字以内で入力してください。" };
    if (MESSAGE_CONTROL_PATTERN.test(body)) return { error: "メッセージに使用できない制御文字が含まれています。" };
    return { value: body };
  }

  function updateSendAvailability() {
    const valid = !validateMessageBody(dom.messageBody.value).error;
    const available = Boolean(state.profile && state.user && state.sendStatus !== "sending");
    dom.messageSubmit.disabled = !available || !valid;
    dom.messageBody.disabled = state.sendStatus === "sending";
  }

  function handleMessageKeydown(event) {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (state.isComposing || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    if (!dom.messageSubmit.disabled) dom.messageForm.requestSubmit();
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (!state.client || !state.user || !state.profile || state.sendStatus === "sending") return;
    const result = validateMessageBody(dom.messageBody.value);
    if (result.error) {
      setFieldError(dom.messageBody, dom.messageError, result.error);
      return;
    }
    const generation = state.sessionGeneration;
    const userId = state.user.id;
    const subscriptionId = state.subscriptionId;
    const submittedBody = result.value;
    state.sendStatus = "sending";
    setBusy(dom.messageSubmit, true, "送信中…", "送信");
    updateSendAvailability();
    try {
      const { data, error } = await state.client.from("messages")
        .insert({ user_id: userId, body: submittedBody })
        .select("id,user_id,body,created_at")
        .single();
      if (!isCurrentSession(generation, userId)) return;
      if (error) throw error;
      const message = normalizeMessage(data);
      if (!message) throw new Error("invalid-message");
      upsertMessage(message);
      renderMessages();
      if (dom.messageBody.value.trim() === submittedBody) dom.messageBody.value = "";
      renderMessageCount();
      requestAnimationFrame(() => moveToBottom(false));
      setNotice("success", "メッセージを送信しました。");
    } catch {
      if (!isCurrentSession(generation, userId)) return;
      setFieldError(dom.messageBody, dom.messageError, "送信できませんでした。本文を残しています。もう一度お試しください。");
      setNotice("error", "メッセージの送信に失敗しました。");
    } finally {
      if (isCurrentSession(generation, userId)) {
        state.sendStatus = "idle";
        setBusy(dom.messageSubmit, false, "", "送信");
        updateSendAvailability();
      }
    }
  }

  function handleOffline() {
    if (!state.user || !state.profile) return;
    state.realtimeStatus = "disconnected";
    renderConnectionStatus();
    setNotice("warning", "ネットワーク接続が切れました。復旧後に再接続します。");
  }

  function handleOnline() {
    if (!state.user || !state.profile) return;
    setNotice("info", "ネットワーク接続が復旧しました。メッセージを確認しています。");
    startRealtime(true);
  }

  document.addEventListener("DOMContentLoaded", initialize);
})();
