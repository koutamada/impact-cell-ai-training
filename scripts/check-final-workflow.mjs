import { readFile } from "node:fs/promises";

const schema = await read("supabase/migrations/20260924150000_final_workflow_schema.sql");
const rpc = await read("supabase/migrations/20260924151000_final_workflow_rpc.sql");
const conflictFix = await read("supabase/migrations/20260927173000_final_workflow_conflict_sqlstate.sql");
const adminGrants = await read("supabase/migrations/20260928120000_final_workflow_admin_service_role_grants.sql");
const app = await read("apps/final-workflow/app.js");
const style = await read("apps/final-workflow/style.css");
const config = await read("apps/final-workflow/config.js");
const adminFunction = await read("supabase/functions/admin-users/index.ts");
const supabaseConfig = await read("supabase/config.toml");

const publicRpcs = [
  "workflow_get_my_context", "workflow_create_request", "workflow_update_request",
  "workflow_delete_request", "workflow_submit_request", "workflow_approve_request",
  "workflow_reject_request", "workflow_return_request", "workflow_assign_request",
  "workflow_start_request", "workflow_complete_request", "workflow_add_comment",
  "workflow_add_attachment", "workflow_delete_attachment", "workflow_mark_notification_read",
  "workflow_mark_all_notifications_read", "workflow_get_dashboard_stats"
];

const failures = [];
check(!app.includes("innerHTML"), "フロントエンドで innerHTML を使用していない");
check(!/service[_-]?role/i.test(app + config), "ブラウザコードにService Roleの記述がない");
check((rpc.match(/\$\$/g) || []).length % 2 === 0, "SQLのdollar quoteが対応している");
check(!/grant\s+(insert|update|delete)[^;]*to\s+authenticated/iu.test(schema + rpc), "authenticatedへ直接DML権限を付与していない");
check(/alter table public\.workflow_requests enable row level security;/i.test(schema), "案件テーブルでRLSが有効");
check(/create policy workflow_requests_select/i.test(schema), "案件閲覧ポリシーが存在");
check(/create policy workflow_storage_select/i.test(schema), "添付Storageの閲覧ポリシーが存在");
check(/const ALLOWED_FILES = new Set\(\["image\/jpeg", "image\/png", "application\/pdf"\]\);/.test(app), "フロントエンドが添付形式をJPEG・PNG・PDFに制限");
check(/const MAX_FILE_SIZE = 10 \* 1024 \* 1024;/.test(app), "フロントエンドが添付を10MiB以下に制限");
check(/mime_type in \('image\/jpeg', 'image\/png', 'application\/pdf'\)/i.test(schema), "DBが添付形式をJPEG・PNG・PDFに制限");
check(/size_bytes between 1 and 10485760/i.test(schema), "DBが添付を10MiB以下に制限");
check(/10485760,[\s\S]*array\['image\/jpeg', 'image\/png', 'application\/pdf'\]/i.test(schema), "Storageが添付形式と10MiB上限を制限");
check(/@media \(max-width: 560px\)[\s\S]*\.main-content \{ padding: 24px 14px 40px; \}[\s\S]*\.form-grid \{ grid-template-columns: 1fr;/i.test(style), "560px以下の主要画面にモバイルレイアウトがある");
check(/await navigate\(state\.currentView, false\);[\s\S]*await openDetail\(request\.id\);/.test(app), "状態変更後に一覧と詳細を再取得する");
check(/workflow_version_conflict:\s*"他の操作により案件が更新されました。再読み込みしてください。"/.test(app), "競合時に再読み込みを案内する");
check(/'errcode = ''40001'''[\s\S]*'errcode = ''P0001'''/.test(conflictFix), "競合を再試行対象外のSQLSTATEへ変更する");
check(/SUPABASE_PUBLISHABLE_KEYS/.test(adminFunction) && /SUPABASE_SECRET_KEYS/.test(adminFunction), "Edge Functionが現行Supabaseキーに対応");
check(/auth\.getUser\(token\)/.test(adminFunction), "Edge FunctionがBearer tokenを明示検証");
check(/actor\.role !== "admin"/.test(adminFunction) && /actor\.is_active !== true/.test(adminFunction), "Edge Functionが有効な管理者ロールを検証");
check(/userId === actorId && input\.isActive === false[\s\S]*cannot_disable_self/.test(adminFunction), "管理APIが管理者自身の無効化を拒否");
check(/userId === actorId && role !== "admin"[\s\S]*cannot_remove_own_admin/.test(adminFunction), "管理APIが自身の管理者権限解除を拒否");
check(/workflow_assert_actor[\s\S]*where id = \(select auth\.uid\(\)\)[\s\S]*and is_active = true;/.test(rpc), "RPCが無効ユーザーの既存セッションを拒否");
check(/headers\.set\("apikey", secretKey\)/.test(adminFunction), "Secret Keyをapikeyヘッダーで送信");
check(/grant select, insert, update[\s\S]*workflow_users[\s\S]*to service_role;/i.test(adminGrants), "管理APIがユーザーを書き込み可能");
check(/grant select, insert, update[\s\S]*workflow_departments[\s\S]*to service_role;/i.test(adminGrants), "管理APIが部署を書き込み可能");
check(/grant select, insert, update[\s\S]*workflow_categories[\s\S]*to service_role;/i.test(adminGrants), "管理APIがカテゴリを書き込み可能");
check(/grant insert[\s\S]*workflow_audit_logs[\s\S]*to service_role;/i.test(adminGrants) && /grant usage, select[\s\S]*workflow_audit_logs_id_seq[\s\S]*to service_role;/i.test(adminGrants), "管理APIが監査ログを書き込み可能");
check(/\[functions\.admin-users\][\s\S]*?verify_jwt\s*=\s*false/.test(supabaseConfig), "admin-usersのLegacy JWT verificationが無効");

for (const name of publicRpcs) {
  check(new RegExp(`create or replace function public\\.${name}\\s*\\(`, "i").test(rpc), `${name} が定義済み`);
  check(new RegExp(`grant execute on function public\\.${name}\\s*\\(`, "i").test(rpc), `${name} の実行権限を明示`);
}

for (const name of [
  "workflow_update_request", "workflow_delete_request", "workflow_submit_request",
  "workflow_approve_request", "workflow_reject_request", "workflow_return_request",
  "workflow_assign_request", "workflow_start_request", "workflow_complete_request"
]) {
  check(conflictFix.includes(`'${name}'`), `${name} の競合SQLSTATEを補正`);
}

const definitions = [...rpc.matchAll(/create or replace function public\.(workflow_[a-z0-9_]+)\s*\(/gi)].map((match) => match[1]);
const duplicates = definitions.filter((name, index) => definitions.indexOf(name) !== index);
check(duplicates.length === 0, "RPC関数名に重複がない");

if (failures.length) {
  console.error(`\n${failures.length}件の検査に失敗しました。`);
  process.exit(1);
}
console.log(`\n静的検査PASS: ${publicRpcs.length} RPC / ${definitions.length} workflow関数`);

function check(condition, label) {
  console.log(`${condition ? "PASS" : "FAIL"} ${label}`);
  if (!condition) failures.push(label);
}

async function read(path) {
  try { return await readFile(path, "utf8"); }
  catch (error) {
    console.error(`FAIL ${path} を読み込めません: ${error.message}`);
    process.exit(1);
  }
}
