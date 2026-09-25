const url = requireEnv("SUPABASE_URL").replace(/\/$/, "");
const publishableKey = requireEnv("SUPABASE_PUBLISHABLE_KEY");
const password = requireEnv("TEST_PASSWORD");

const accounts = {
  requesterA: "requester-a@example.com",
  requesterB: "requester-b@example.com",
  approver: "approver@example.com",
  workerA: "worker-a@example.com",
  workerB: "worker-b@example.com",
  admin: "admin@example.com"
};

const sessions = Object.fromEntries(await Promise.all(Object.entries(accounts).map(async ([key, email]) => {
  const session = await api("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: { email, password }
  });
  return [key, { token: session.access_token, id: session.user.id }];
})));

const results = [];
const runId = new Date().toISOString().replace(/[^0-9]/g, "");
const [category] = await rest(sessions.requesterA, "/workflow_categories?is_active=eq.true&select=id&order=sort_order&limit=1");
assert(category?.id, "初期カテゴリを取得できる");

const created = await rpc(sessions.requesterA, "workflow_create_request", {
  p_title: `E2Eテスト ${runId}`,
  p_description: "必須8シナリオを自動検証するための案件です。",
  p_category_id: category.id,
  p_priority: "normal",
  p_desired_due_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
});
assert(created.status === "draft", "Scenario 1: 一般ユーザーAが下書きを作成");

const submitted = await rpc(sessions.requesterA, "workflow_submit_request", {
  p_request_id: created.id,
  p_expected_version: created.version
});
assert(submitted.status === "pending_approval", "Scenario 1: 案件を承認申請");

const approverRows = await rest(sessions.approver, `/workflow_requests?id=eq.${created.id}&status=eq.pending_approval&select=id,status,version`);
assert(approverRows.length === 1, "Scenario 1: 承認者の承認待ち一覧へ表示");

const approved = await rpc(sessions.approver, "workflow_approve_request", {
  p_request_id: created.id,
  p_expected_version: submitted.version
});
assert(approved.status === "approved", "Scenario 2: 承認者が承認済みに変更");

const assigned = await rpc(sessions.admin, "workflow_assign_request", {
  p_request_id: created.id,
  p_expected_version: approved.version,
  p_assignee_id: sessions.workerA.id
});
assert(assigned.assignee_id === sessions.workerA.id, "Scenario 3: 管理者が担当者Aを設定");

const workerRows = await rest(sessions.workerA, `/workflow_requests?id=eq.${created.id}&select=id,status,version,assignee_id`);
assert(workerRows.length === 1, "Scenario 3: 担当者Aの一覧へ表示");

const requesterBRows = await rest(sessions.requesterB, `/workflow_requests?id=eq.${created.id}&select=id`);
assert(requesterBRows.length === 0, "Scenario 5: 一般ユーザーBは一般Aの案件を取得できない");

await expectDenied("Scenario 6: 一般ユーザーの直接PATCHを拒否", () => rest(sessions.requesterA, `/workflow_requests?id=eq.${created.id}`, {
  method: "PATCH", body: { status: "approved" }, prefer: "return=representation"
}));
await expectDenied("Scenario 6: 一般ユーザーの承認RPC呼び出しを拒否", () => rpc(sessions.requesterA, "workflow_approve_request", {
  p_request_id: created.id, p_expected_version: assigned.version
}));

await expectDenied("Scenario 7: 担当外の作業担当者Bによる開始を拒否", () => rpc(sessions.workerB, "workflow_start_request", {
  p_request_id: created.id, p_expected_version: assigned.version
}));

const started = await rpc(sessions.workerA, "workflow_start_request", {
  p_request_id: created.id, p_expected_version: assigned.version
});
assert(started.status === "in_progress", "Scenario 4: 担当者Aが作業を開始");

const completed = await rpc(sessions.workerA, "workflow_complete_request", {
  p_request_id: created.id, p_expected_version: started.version
});
assert(completed.status === "completed", "Scenario 4: 担当者Aが完了状態へ変更");

const requesterARows = await rest(sessions.requesterA, `/workflow_requests?id=eq.${created.id}&select=id,status`);
assert(requesterARows[0]?.status === "completed", "Scenario 4: 申請者側でも完了を確認");

const audits = await rest(sessions.requesterA, `/workflow_audit_logs?request_id=eq.${created.id}&select=action&order=created_at`);
const actions = new Set(audits.map((item) => item.action));
const expectedActions = ["created", "submitted", "approved", "assigned", "started", "completed"];
assert(expectedActions.every((action) => actions.has(action)), `Scenario 8: 操作履歴を記録（${[...actions].join(", ")}）`);

console.log(`\n必須シナリオテストPASS: ${results.length}項目`);
console.log(`対象案件ID: ${created.id}`);

async function rpc(session, name, body) { return rest(session, `/rpc/${name}`, { method: "POST", body }); }
async function rest(session, path, options = {}) { return api(`/rest/v1${path}`, { ...options, token: session.token }); }

async function api(path, { method = "GET", body, token, prefer } = {}) {
  const response = await fetch(`${url}${path}`, {
    method,
    headers: {
      apikey: publishableKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(prefer ? { Prefer: prefer } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  const data = text ? safeJson(text) : null;
  if (!response.ok) {
    const error = new Error(data?.message || data?.error_description || `HTTP ${response.status}`);
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

async function expectDenied(label, operation) {
  try { await operation(); }
  catch (error) {
    if (error.status >= 400 && error.status < 500) { assert(true, label); return; }
    throw error;
  }
  throw new Error(`FAIL ${label}: 操作が成功してしまいました`);
}

function assert(condition, label) {
  if (!condition) throw new Error(`FAIL ${label}`);
  results.push(label);
  console.log(`PASS ${label}`);
}
function safeJson(text) { try { return JSON.parse(text); } catch { return text; } }
function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
