begin;

create type public.workflow_user_role as enum (
  'requester',
  'approver',
  'worker',
  'admin'
);

create type public.workflow_request_status as enum (
  'draft',
  'pending_approval',
  'approved',
  'in_progress',
  'completed',
  'rejected',
  'returned'
);

create type public.workflow_request_priority as enum (
  'low',
  'normal',
  'high',
  'urgent'
);

create type public.workflow_approval_action as enum (
  'approved',
  'rejected',
  'returned'
);

create table public.workflow_departments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  approver_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workflow_departments_name_valid check (
    name = btrim(name)
    and char_length(name) between 1 and 80
    and name !~ '[\x00-\x1F\x7F-\x9F]'
  )
);

create unique index workflow_departments_name_unique
  on public.workflow_departments (lower(name));

create table public.workflow_users (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role public.workflow_user_role not null,
  department_id uuid references public.workflow_departments(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workflow_users_display_name_valid check (
    display_name = btrim(display_name)
    and char_length(display_name) between 1 and 80
    and display_name !~ '[\x00-\x1F\x7F-\x9F]'
  ),
  constraint workflow_users_department_required check (
    role = 'admin' or department_id is not null
  )
);

alter table public.workflow_departments
  add constraint workflow_departments_approver_fk
  foreign key (approver_id) references public.workflow_users(id) on delete restrict;

create index workflow_users_role_active_idx
  on public.workflow_users (role, is_active, display_name);

create index workflow_users_department_idx
  on public.workflow_users (department_id, is_active);

create table public.workflow_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workflow_categories_name_valid check (
    name = btrim(name)
    and char_length(name) between 1 and 80
    and name !~ '[\x00-\x1F\x7F-\x9F]'
  ),
  constraint workflow_categories_sort_order_valid check (sort_order >= 0)
);

create unique index workflow_categories_name_unique
  on public.workflow_categories (lower(name));

create table public.workflow_requests (
  id uuid primary key default gen_random_uuid(),
  request_number bigint generated always as identity unique,
  title text not null,
  description text not null,
  category_id uuid not null references public.workflow_categories(id) on delete restrict,
  priority public.workflow_request_priority not null default 'normal',
  desired_due_date date not null,
  requester_id uuid not null references public.workflow_users(id) on delete restrict,
  department_id uuid not null references public.workflow_departments(id) on delete restrict,
  approver_id uuid references public.workflow_users(id) on delete restrict,
  assignee_id uuid references public.workflow_users(id) on delete restrict,
  status public.workflow_request_status not null default 'draft',
  submitted_at timestamptz,
  approved_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint workflow_requests_title_valid check (
    title = btrim(title)
    and char_length(title) between 1 and 120
    and title !~ '[\x00-\x1F\x7F-\x9F]'
  ),
  constraint workflow_requests_description_valid check (
    description = btrim(description)
    and char_length(description) between 1 and 5000
    and description !~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]'
  ),
  constraint workflow_requests_version_valid check (version >= 1),
  constraint workflow_requests_timestamps_valid check (
    (status in ('draft', 'returned') or submitted_at is not null)
    and (status not in ('approved', 'in_progress', 'completed') or approved_at is not null)
    and (status not in ('in_progress', 'completed') or started_at is not null)
    and (status <> 'completed' or completed_at is not null)
  )
);

create index workflow_requests_requester_idx
  on public.workflow_requests (requester_id, updated_at desc, id desc);

create index workflow_requests_approver_status_idx
  on public.workflow_requests (approver_id, status, desired_due_date, id);

create index workflow_requests_assignee_status_idx
  on public.workflow_requests (assignee_id, status, desired_due_date, id);

create index workflow_requests_admin_filter_idx
  on public.workflow_requests (status, category_id, priority, desired_due_date, id);

create index workflow_requests_title_search_idx
  on public.workflow_requests using gin (to_tsvector('simple', title || ' ' || description));

create table public.workflow_approval_records (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.workflow_requests(id) on delete cascade,
  approver_id uuid not null references public.workflow_users(id) on delete restrict,
  action public.workflow_approval_action not null,
  reason text,
  created_at timestamptz not null default now(),
  constraint workflow_approval_records_reason_valid check (
    (action = 'approved' and reason is null)
    or (
      action in ('rejected', 'returned')
      and reason = btrim(reason)
      and char_length(reason) between 1 and 1000
      and reason !~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]'
    )
  )
);

create index workflow_approval_records_request_idx
  on public.workflow_approval_records (request_id, created_at, id);

create table public.workflow_comments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.workflow_requests(id) on delete cascade,
  author_id uuid not null references public.workflow_users(id) on delete restrict,
  body text not null,
  created_at timestamptz not null default now(),
  constraint workflow_comments_body_valid check (
    body = btrim(body)
    and char_length(body) between 1 and 2000
    and body !~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]'
  )
);

create index workflow_comments_request_idx
  on public.workflow_comments (request_id, created_at, id);

create table public.workflow_attachments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.workflow_requests(id) on delete cascade,
  storage_path text not null unique,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  uploaded_by uuid not null references public.workflow_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint workflow_attachments_path_valid check (
    storage_path = btrim(storage_path)
    and char_length(storage_path) between 1 and 500
    and storage_path !~ '[\x00-\x1F\x7F-\x9F]'
  ),
  constraint workflow_attachments_name_valid check (
    original_name = btrim(original_name)
    and char_length(original_name) between 1 and 255
    and original_name !~ '[\x00-\x1F\x7F-\x9F]'
  ),
  constraint workflow_attachments_mime_valid check (
    mime_type in ('image/jpeg', 'image/png', 'application/pdf')
  ),
  constraint workflow_attachments_size_valid check (
    size_bytes between 1 and 10485760
  )
);

create index workflow_attachments_request_idx
  on public.workflow_attachments (request_id, created_at, id);

create table public.workflow_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.workflow_users(id) on delete cascade,
  request_id uuid references public.workflow_requests(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint workflow_notifications_type_valid check (
    type ~ '^[a-z][a-z0-9_]{0,49}$'
  ),
  constraint workflow_notifications_title_valid check (
    title = btrim(title)
    and char_length(title) between 1 and 120
    and title !~ '[\x00-\x1F\x7F-\x9F]'
  ),
  constraint workflow_notifications_body_valid check (
    body = btrim(body)
    and char_length(body) between 1 and 500
    and body !~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]'
  ),
  constraint workflow_notifications_read_valid check (
    (is_read = false and read_at is null)
    or (is_read = true and read_at is not null)
  )
);

create index workflow_notifications_recipient_idx
  on public.workflow_notifications (recipient_id, is_read, created_at desc, id desc);

create table public.workflow_audit_logs (
  id bigint generated always as identity primary key,
  request_id uuid references public.workflow_requests(id) on delete set null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null,
  from_status public.workflow_request_status,
  to_status public.workflow_request_status,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint workflow_audit_logs_action_valid check (
    action ~ '^[a-z][a-z0-9_]{0,49}$'
  ),
  constraint workflow_audit_logs_summary_valid check (
    summary = btrim(summary)
    and char_length(summary) between 1 and 300
    and summary !~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]'
  ),
  constraint workflow_audit_logs_metadata_object check (
    jsonb_typeof(metadata) = 'object'
  )
);

create index workflow_audit_logs_request_idx
  on public.workflow_audit_logs (request_id, created_at, id);

create index workflow_audit_logs_created_idx
  on public.workflow_audit_logs (created_at desc, id desc);

create or replace function public.workflow_set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger workflow_departments_set_updated_at
before update on public.workflow_departments
for each row execute function public.workflow_set_updated_at();

create trigger workflow_users_set_updated_at
before update on public.workflow_users
for each row execute function public.workflow_set_updated_at();

create trigger workflow_categories_set_updated_at
before update on public.workflow_categories
for each row execute function public.workflow_set_updated_at();

create trigger workflow_requests_set_updated_at
before update on public.workflow_requests
for each row execute function public.workflow_set_updated_at();

create or replace function public.workflow_current_user_is_active()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.workflow_users u
    where u.id = (select auth.uid())
      and u.is_active = true
  );
$$;

create or replace function public.workflow_current_user_role()
returns public.workflow_user_role
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select u.role
  from public.workflow_users u
  where u.id = (select auth.uid())
    and u.is_active = true;
$$;

create or replace function public.workflow_can_view_request(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.workflow_requests r
    join public.workflow_users u on u.id = (select auth.uid())
    where r.id = p_request_id
      and u.is_active = true
      and (
        u.role = 'admin'
        or r.requester_id = u.id
        or r.approver_id = u.id
        or r.assignee_id = u.id
      )
  );
$$;

create or replace function public.workflow_can_manage_attachment(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.workflow_requests r
    join public.workflow_users u on u.id = (select auth.uid())
    where r.id = p_request_id
      and u.is_active = true
      and u.role = 'requester'
      and r.requester_id = u.id
      and r.status in ('draft', 'returned')
  );
$$;

create or replace function public.workflow_attachment_request_id(p_name text)
returns uuid
language plpgsql
immutable
security invoker
set search_path = pg_catalog
as $$
declare
  parts text[];
begin
  parts := string_to_array(p_name, '/');
  if array_length(parts, 1) < 3 then
    return null;
  end if;
  return parts[2]::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

alter table public.workflow_departments enable row level security;
alter table public.workflow_users enable row level security;
alter table public.workflow_categories enable row level security;
alter table public.workflow_requests enable row level security;
alter table public.workflow_approval_records enable row level security;
alter table public.workflow_comments enable row level security;
alter table public.workflow_attachments enable row level security;
alter table public.workflow_notifications enable row level security;
alter table public.workflow_audit_logs enable row level security;

create policy workflow_departments_select
on public.workflow_departments for select
to authenticated
using (
  public.workflow_current_user_is_active()
  and (is_active = true or public.workflow_current_user_role() = 'admin')
);

create policy workflow_users_select
on public.workflow_users for select
to authenticated
using (
  public.workflow_current_user_is_active()
  and (is_active = true or public.workflow_current_user_role() = 'admin')
);

create policy workflow_categories_select
on public.workflow_categories for select
to authenticated
using (
  public.workflow_current_user_is_active()
  and (is_active = true or public.workflow_current_user_role() = 'admin')
);

create policy workflow_requests_select
on public.workflow_requests for select
to authenticated
using (
  public.workflow_current_user_is_active()
  and (
    requester_id = (select auth.uid())
    or approver_id = (select auth.uid())
    or assignee_id = (select auth.uid())
    or public.workflow_current_user_role() = 'admin'
  )
);

create policy workflow_approval_records_select
on public.workflow_approval_records for select
to authenticated
using (public.workflow_can_view_request(request_id));

create policy workflow_comments_select
on public.workflow_comments for select
to authenticated
using (public.workflow_can_view_request(request_id));

create policy workflow_attachments_select
on public.workflow_attachments for select
to authenticated
using (public.workflow_can_view_request(request_id));

create policy workflow_notifications_select
on public.workflow_notifications for select
to authenticated
using (
  public.workflow_current_user_is_active()
  and recipient_id = (select auth.uid())
);

create policy workflow_audit_logs_select
on public.workflow_audit_logs for select
to authenticated
using (
  public.workflow_current_user_is_active()
  and (
    public.workflow_current_user_role() = 'admin'
    or (request_id is not null and public.workflow_can_view_request(request_id))
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'workflow-request-attachments',
  'workflow-request-attachments',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'application/pdf']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy workflow_storage_select
on storage.objects for select
to authenticated
using (
  bucket_id = 'workflow-request-attachments'
  and public.workflow_can_view_request(public.workflow_attachment_request_id(name))
);

create policy workflow_storage_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'workflow-request-attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and public.workflow_can_manage_attachment(public.workflow_attachment_request_id(name))
);

create policy workflow_storage_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'workflow-request-attachments'
  and owner_id = (select auth.uid()::text)
  and public.workflow_can_manage_attachment(public.workflow_attachment_request_id(name))
);

insert into public.workflow_categories (name, sort_order)
values
  ('システム改修', 10),
  ('備品購入', 20),
  ('データ抽出', 30),
  ('資料作成', 40),
  ('アカウント発行', 50),
  ('その他', 60);

revoke all privileges on table public.workflow_departments from public, anon, authenticated;
revoke all privileges on table public.workflow_users from public, anon, authenticated;
revoke all privileges on table public.workflow_categories from public, anon, authenticated;
revoke all privileges on table public.workflow_requests from public, anon, authenticated;
revoke all privileges on table public.workflow_approval_records from public, anon, authenticated;
revoke all privileges on table public.workflow_comments from public, anon, authenticated;
revoke all privileges on table public.workflow_attachments from public, anon, authenticated;
revoke all privileges on table public.workflow_notifications from public, anon, authenticated;
revoke all privileges on table public.workflow_audit_logs from public, anon, authenticated;

grant select on table public.workflow_departments to authenticated;
grant select on table public.workflow_users to authenticated;
grant select on table public.workflow_categories to authenticated;
grant select on table public.workflow_requests to authenticated;
grant select on table public.workflow_approval_records to authenticated;
grant select on table public.workflow_comments to authenticated;
grant select on table public.workflow_attachments to authenticated;
grant select on table public.workflow_notifications to authenticated;
grant select on table public.workflow_audit_logs to authenticated;

revoke all on function public.workflow_set_updated_at() from public, anon, authenticated;
revoke all on function public.workflow_current_user_is_active() from public, anon, authenticated;
revoke all on function public.workflow_current_user_role() from public, anon, authenticated;
revoke all on function public.workflow_can_view_request(uuid) from public, anon, authenticated;
revoke all on function public.workflow_can_manage_attachment(uuid) from public, anon, authenticated;
revoke all on function public.workflow_attachment_request_id(text) from public, anon, authenticated;

grant execute on function public.workflow_current_user_is_active() to authenticated;
grant execute on function public.workflow_current_user_role() to authenticated;
grant execute on function public.workflow_can_view_request(uuid) to authenticated;
grant execute on function public.workflow_can_manage_attachment(uuid) to authenticated;
grant execute on function public.workflow_attachment_request_id(text) to authenticated;

grant usage on type public.workflow_user_role to authenticated, service_role;
grant usage on type public.workflow_request_status to authenticated, service_role;
grant usage on type public.workflow_request_priority to authenticated, service_role;
grant usage on type public.workflow_approval_action to authenticated, service_role;

commit;
