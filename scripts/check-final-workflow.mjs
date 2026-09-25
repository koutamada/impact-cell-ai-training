import { readFile } from "node:fs/promises";

const schema = await read("supabase/migrations/20260924150000_final_workflow_schema.sql");
const rpc = await read("supabase/migrations/20260924151000_final_workflow_rpc.sql");
const app = await read("apps/final-workflow/app.js");
const config = await read("apps/final-workflow/config.js");

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

for (const name of publicRpcs) {
  check(new RegExp(`create or replace function public\\.${name}\\s*\\(`, "i").test(rpc), `${name} が定義済み`);
  check(new RegExp(`grant execute on function public\\.${name}\\s*\\(`, "i").test(rpc), `${name} の実行権限を明示`);
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
