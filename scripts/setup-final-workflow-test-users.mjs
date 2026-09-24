const url = requireEnv("SUPABASE_URL").replace(/\/$/, "");
const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const password = requireEnv("TEST_PASSWORD");
if (password.length < 12) throw new Error("TEST_PASSWORD must be at least 12 characters");

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json"
};

const accounts = [
  { email: "admin@example.com", displayName: "管理者", role: "admin", department: null },
  { email: "requester-a@example.com", displayName: "一般ユーザーA", role: "requester", department: "営業部" },
  { email: "requester-b@example.com", displayName: "一般ユーザーB", role: "requester", department: "営業部" },
  { email: "approver@example.com", displayName: "承認者", role: "approver", department: "営業部" },
  { email: "worker-a@example.com", displayName: "作業担当者A", role: "worker", department: "業務支援部" },
  { email: "worker-b@example.com", displayName: "作業担当者B", role: "worker", department: "業務支援部" }
];

const departments = new Map();
for (const name of ["営業部", "業務支援部"]) {
  const existing = await rest(`workflow_departments?name=eq.${encodeURIComponent(name)}&select=id,name`, { method: "GET" });
  if (existing[0]) departments.set(name, existing[0].id);
  else {
    const [created] = await rest("workflow_departments", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: { name }
    });
    departments.set(name, created.id);
  }
}

const authUsers = await listAllUsers();
const ids = new Map();
for (const account of accounts) {
  let user = authUsers.find((item) => item.email?.toLowerCase() === account.email);
  if (!user) {
    user = await auth("/admin/users", {
      method: "POST",
      body: { email: account.email, password, email_confirm: true }
    });
  } else {
    await auth(`/admin/users/${user.id}`, { method: "PUT", body: { password, email_confirm: true } });
  }
  ids.set(account.email, user.id);
  await rest("workflow_users?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: {
      id: user.id,
      display_name: account.displayName,
      role: account.role,
      department_id: account.department ? departments.get(account.department) : null,
      is_active: true
    }
  });
}

await rest(`workflow_departments?id=eq.${departments.get("営業部")}`, {
  method: "PATCH",
  body: { approver_id: ids.get("approver@example.com"), is_active: true }
});

console.log("FlowDesk test accounts are ready:");
accounts.forEach((account) => console.log(`- ${account.role}: ${account.email}`));
console.log("Password: the TEST_PASSWORD value supplied to this process (not printed)");

async function listAllUsers() {
  const result = [];
  for (let page = 1; ; page += 1) {
    const data = await auth(`/admin/users?page=${page}&per_page=100`, { method: "GET" });
    result.push(...data.users);
    if (data.users.length < 100) return result;
  }
}

async function auth(path, options) {
  return request(`${url}/auth/v1${path}`, options);
}

async function rest(path, options) {
  return request(`${url}/rest/v1/${path}`, options);
}

async function request(endpoint, options) {
  const response = await fetch(endpoint, {
    ...options,
    headers: { ...headers, ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${options.method} ${new URL(endpoint).pathname}: ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
