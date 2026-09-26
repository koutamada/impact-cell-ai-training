import { createClient } from "npm:@supabase/supabase-js@2.111.0";

const ALLOWED_ORIGINS = new Set([
  "http://localhost:8000",
  "https://koutamada.github.io"
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const ROLES = new Set(["requester", "approver", "worker", "admin"]);
const PUBLISHABLE_KEY = readNamedKey("SUPABASE_PUBLISHABLE_KEYS");
const SECRET_KEY = readNamedKey("SUPABASE_SECRET_KEYS");
const CONFIG = {
  url: Deno.env.get("SUPABASE_URL"),
  anonKey: PUBLISHABLE_KEY || Deno.env.get("SUPABASE_ANON_KEY"),
  serviceRoleKey: SECRET_KEY || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
};

type AdminClient = ReturnType<typeof createClient>;
type Input = Record<string, unknown>;

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") || "";
  const headers = corsHeaders(origin);
  if (request.method === "OPTIONS") {
    return ALLOWED_ORIGINS.has(origin)
      ? new Response(null, { status: 204, headers })
      : errorResponse("forbidden", 403, headers);
  }
  if (request.method !== "POST") return errorResponse("method_not_allowed", 405, headers);
  if (!ALLOWED_ORIGINS.has(origin)) return errorResponse("forbidden", 403, headers);
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) {
    return errorResponse("unsupported_media_type", 415, headers);
  }
  if (!CONFIG.url || !CONFIG.anonKey || !CONFIG.serviceRoleKey) {
    return errorResponse("service_unavailable", 503, headers);
  }

  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return errorResponse("unauthorized", 401, headers);

  const userClient = createClient(CONFIG.url, CONFIG.anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !authData.user?.id) return errorResponse("unauthorized", 401, headers);

  const { data: actor, error: actorError } = await userClient.from("workflow_users")
    .select("id,role,is_active")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (actorError) {
    console.error("[admin-users] actor lookup failed", actorError.code || "unknown");
    return errorResponse("database_error", 500, headers);
  }
  if (!actor || actor.role !== "admin" || actor.is_active !== true) {
    return errorResponse("forbidden", 403, headers);
  }
  const admin = createAdminClient(CONFIG.url, CONFIG.serviceRoleKey);

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > 20000) {
    return errorResponse("payload_too_large", 413, headers);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("bad_request", 400, headers);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse("bad_request", 400, headers);
  }

  const input = body as Input;
  const action = typeof input.action === "string" ? input.action : "";
  try {
    if (action === "list") {
      return jsonResponse(await listAdminData(userClient, admin, authData.user.id, authData.user.email || ""), 200, headers);
    }
    if (action === "create_user") return jsonResponse(await createUser(admin, actor.id, input), 201, headers);
    if (action === "update_user") return jsonResponse(await updateUser(admin, actor.id, input), 200, headers);
    if (action === "create_department") return jsonResponse(await createDepartment(admin, actor.id, input), 201, headers);
    if (action === "update_department") return jsonResponse(await updateDepartment(admin, actor.id, input), 200, headers);
    if (action === "create_category") return jsonResponse(await createCategory(admin, actor.id, input), 201, headers);
    if (action === "update_category") return jsonResponse(await updateCategory(admin, actor.id, input), 200, headers);
    throw new SafeError("bad_request", 400);
  } catch (error) {
    if (error instanceof SafeError) return errorResponse(error.code, error.status, headers);
    console.error("[admin-users] unexpected failure", safeLogValue(error));
    return errorResponse("database_error", 500, headers);
  }
});

async function listAdminData(userClient: AdminClient, admin: AdminClient, currentUserId: string, currentUserEmail: string) {
  const [{ data: profiles, error: profilesError }, departments, categories, authUsers] = await Promise.all([
    userClient.from("workflow_users").select("id,display_name,role,department_id,is_active,created_at,updated_at").order("display_name"),
    userClient.from("workflow_departments").select("id,name,approver_id,is_active,created_at,updated_at").order("name"),
    userClient.from("workflow_categories").select("id,name,is_active,sort_order,created_at,updated_at").order("sort_order"),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  ]);
  const emailById = new Map((authUsers.data?.users || []).map((user) => [user.id, user.email || ""]));
  if (authUsers.error) emailById.set(currentUserId, currentUserEmail);
  return {
    users: profilesError ? [] : (profiles || []).map((profile) => ({ ...profile, email: emailById.get(profile.id) || "" })),
    departments: departments.error ? [] : departments.data || [],
    categories: categories.error ? [] : categories.data || []
  };
}

function readNamedKey(name: string) {
  const raw = Deno.env.get(name);
  if (!raw) return null;
  try {
    const keys = JSON.parse(raw);
    return typeof keys?.default === "string" && keys.default ? keys.default : null;
  } catch {
    return null;
  }
}

function createAdminClient(url: string, key: string) {
  return createClient(url, key, {
    global: SECRET_KEY ? { fetch: secretKeyFetch(SECRET_KEY) } : undefined,
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function secretKeyFetch(secretKey: string) {
  return (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (headers.get("Authorization") === `Bearer ${secretKey}`) {
      headers.delete("Authorization");
    }
    headers.set("apikey", secretKey);
    return fetch(input, { ...init, headers });
  };
}

async function createUser(admin: AdminClient, actorId: string, input: Input) {
  assertKeys(input, ["action", "email", "password", "displayName", "role", "departmentId"]);
  const email = requiredString(input.email, 254).toLowerCase();
  const password = requiredString(input.password, 128, false);
  const displayName = requiredString(input.displayName, 80);
  const role = requiredRole(input.role);
  const departmentId = optionalUuid(input.departmentId);
  if (!EMAIL_PATTERN.test(email) || password.length < 8) throw new SafeError("invalid_user", 400);
  if (role !== "admin" && !departmentId) throw new SafeError("department_required", 400);
  await assertDepartment(admin, departmentId);

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });
  if (createError || !created.user) {
    if (/already|registered|exists/i.test(createError?.message || "")) throw new SafeError("email_already_exists", 409);
    throw new SafeError("auth_create_failed", 500);
  }

  const { error: profileError } = await admin.from("workflow_users").insert({
    id: created.user.id,
    display_name: displayName,
    role,
    department_id: departmentId,
    is_active: true
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    throw new SafeError("database_error", 500);
  }

  await writeAudit(admin, actorId, "user_created", "ユーザーを追加しました", {
    target_user_id: created.user.id,
    role,
    department_id: departmentId
  });
  return { id: created.user.id };
}

async function updateUser(admin: AdminClient, actorId: string, input: Input) {
  assertKeys(input, ["action", "userId", "displayName", "role", "departmentId", "isActive"]);
  const userId = requiredUuid(input.userId);
  const displayName = requiredString(input.displayName, 80);
  const role = requiredRole(input.role);
  const departmentId = optionalUuid(input.departmentId);
  if (typeof input.isActive !== "boolean") throw new SafeError("invalid_user", 400);
  if (role !== "admin" && !departmentId) throw new SafeError("department_required", 400);
  if (userId === actorId && input.isActive === false) throw new SafeError("cannot_disable_self", 409);
  if (userId === actorId && role !== "admin") throw new SafeError("cannot_remove_own_admin", 409);
  await assertDepartment(admin, departmentId);

  const { data: before, error: beforeError } = await admin.from("workflow_users")
    .select("id,display_name,role,department_id,is_active")
    .eq("id", userId)
    .maybeSingle();
  if (beforeError) throw new SafeError("database_error", 500);
  if (!before) throw new SafeError("user_not_found", 404);

  const { error } = await admin.from("workflow_users").update({
    display_name: displayName,
    role,
    department_id: departmentId,
    is_active: input.isActive
  }).eq("id", userId);
  if (error) throw new SafeError("database_error", 500);

  await writeAudit(admin, actorId, "user_updated", "ユーザー情報を変更しました", {
    target_user_id: userId,
    before,
    after: { display_name: displayName, role, department_id: departmentId, is_active: input.isActive }
  });
  return { id: userId };
}

async function createDepartment(admin: AdminClient, actorId: string, input: Input) {
  assertKeys(input, ["action", "name", "approverId"]);
  const name = requiredString(input.name, 80);
  const approverId = optionalUuid(input.approverId);
  await assertApprover(admin, approverId);
  const { data, error } = await admin.from("workflow_departments")
    .insert({ name, approver_id: approverId })
    .select("id")
    .single();
  if (error) throw conflictOrDatabase(error.message);
  await writeAudit(admin, actorId, "department_created", "部署を追加しました", { department_id: data.id, name, approver_id: approverId });
  return data;
}

async function updateDepartment(admin: AdminClient, actorId: string, input: Input) {
  assertKeys(input, ["action", "departmentId", "name", "approverId", "isActive"]);
  const departmentId = requiredUuid(input.departmentId);
  const name = requiredString(input.name, 80);
  const approverId = optionalUuid(input.approverId);
  if (typeof input.isActive !== "boolean") throw new SafeError("invalid_department", 400);
  await assertApprover(admin, approverId);
  const { data, error } = await admin.from("workflow_departments")
    .update({ name, approver_id: approverId, is_active: input.isActive })
    .eq("id", departmentId)
    .select("id")
    .maybeSingle();
  if (error) throw conflictOrDatabase(error.message);
  if (!data) throw new SafeError("department_not_found", 404);
  await writeAudit(admin, actorId, "department_updated", "部署情報を変更しました", { department_id: departmentId, name, approver_id: approverId, is_active: input.isActive });
  return data;
}

async function createCategory(admin: AdminClient, actorId: string, input: Input) {
  assertKeys(input, ["action", "name", "sortOrder"]);
  const name = requiredString(input.name, 80);
  const sortOrder = requiredInteger(input.sortOrder, 0, 100000);
  const { data, error } = await admin.from("workflow_categories")
    .insert({ name, sort_order: sortOrder })
    .select("id")
    .single();
  if (error) throw conflictOrDatabase(error.message);
  await writeAudit(admin, actorId, "category_created", "カテゴリを追加しました", { category_id: data.id, name, sort_order: sortOrder });
  return data;
}

async function updateCategory(admin: AdminClient, actorId: string, input: Input) {
  assertKeys(input, ["action", "categoryId", "name", "sortOrder", "isActive"]);
  const categoryId = requiredUuid(input.categoryId);
  const name = requiredString(input.name, 80);
  const sortOrder = requiredInteger(input.sortOrder, 0, 100000);
  if (typeof input.isActive !== "boolean") throw new SafeError("invalid_category", 400);
  const { data, error } = await admin.from("workflow_categories")
    .update({ name, sort_order: sortOrder, is_active: input.isActive })
    .eq("id", categoryId)
    .select("id")
    .maybeSingle();
  if (error) throw conflictOrDatabase(error.message);
  if (!data) throw new SafeError("category_not_found", 404);
  await writeAudit(admin, actorId, "category_updated", "カテゴリ情報を変更しました", { category_id: categoryId, name, sort_order: sortOrder, is_active: input.isActive });
  return data;
}

async function assertDepartment(admin: AdminClient, departmentId: string | null) {
  if (!departmentId) return;
  const { data, error } = await admin.from("workflow_departments")
    .select("id")
    .eq("id", departmentId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new SafeError("database_error", 500);
  if (!data) throw new SafeError("invalid_department", 400);
}

async function assertApprover(admin: AdminClient, approverId: string | null) {
  if (!approverId) return;
  const { data, error } = await admin.from("workflow_users")
    .select("id")
    .eq("id", approverId)
    .eq("role", "approver")
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new SafeError("database_error", 500);
  if (!data) throw new SafeError("invalid_approver", 400);
}

async function writeAudit(admin: AdminClient, actorId: string, action: string, summary: string, metadata: Record<string, unknown>) {
  const { error } = await admin.from("workflow_audit_logs").insert({
    request_id: null,
    actor_id: actorId,
    action,
    summary,
    metadata
  });
  if (error) throw new SafeError("database_error", 500);
}

function assertKeys(input: Input, allowed: string[]) {
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw new SafeError("bad_request", 400);
}

function requiredString(value: unknown, max: number, trim = true) {
  if (typeof value !== "string") throw new SafeError("bad_request", 400);
  const normalized = trim ? value.trim() : value;
  if (normalized.length < 1 || normalized.length > max || CONTROL_PATTERN.test(normalized)) {
    throw new SafeError("bad_request", 400);
  }
  return normalized;
}

function requiredUuid(value: unknown) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new SafeError("bad_request", 400);
  return value;
}

function optionalUuid(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return requiredUuid(value);
}

function requiredRole(value: unknown) {
  if (typeof value !== "string" || !ROLES.has(value)) throw new SafeError("invalid_role", 400);
  return value;
}

function requiredInteger(value: unknown, min: number, max: number) {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new SafeError("bad_request", 400);
  return Number(value);
}

function conflictOrDatabase(message: string) {
  return /duplicate|unique/i.test(message) ? new SafeError("already_exists", 409) : new SafeError("database_error", 500);
}

class SafeError extends Error {
  constructor(public code: string, public status: number) {
    super(code);
  }
}

function safeLogValue(error: unknown) {
  return error instanceof Error ? error.name : typeof error;
}

function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function jsonResponse(value: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

function errorResponse(code: string, status: number, headers: Record<string, string>) {
  return jsonResponse({ error: code }, status, headers);
}
