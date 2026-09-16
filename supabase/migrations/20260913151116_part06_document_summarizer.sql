begin;

create table public.document_summary_requests (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'processing',
  input_format text not null,
  document_hash text not null,
  result_hash text,
  error_code text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint document_summary_requests_status_check
    check (status in ('processing', 'generated', 'completed', 'failed')),
  constraint document_summary_requests_format_check
    check (input_format in ('direct', 'txt', 'markdown', 'pdf', 'doc', 'docx', 'ppt', 'pptx')),
  constraint document_summary_requests_document_hash_check
    check (document_hash ~ '^[0-9a-f]{64}$'),
  constraint document_summary_requests_result_hash_check
    check ((status in ('processing', 'failed') and result_hash is null)
      or (status in ('generated', 'completed') and result_hash ~ '^[0-9a-f]{64}$')),
  constraint document_summary_requests_error_check
    check (error_code is null or error_code ~ '^[a-z0-9_]{1,50}$')
);

create table public.document_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null references public.document_summary_requests(id) on delete cascade,
  source_name text not null,
  document_hash text not null,
  input_format text not null,
  coverage text not null,
  detail text not null,
  document_language text not null,
  summary_items jsonb not null,
  created_at timestamptz not null default now(),
  constraint document_summaries_user_request_key unique (user_id, request_id),
  constraint document_summaries_source_name_check
    check (source_name = btrim(source_name) and char_length(source_name) between 1 and 255
      and source_name !~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]'),
  constraint document_summaries_document_hash_check check (document_hash ~ '^[0-9a-f]{64}$'),
  constraint document_summaries_format_check
    check (input_format in ('direct', 'txt', 'markdown', 'pdf', 'doc', 'docx', 'ppt', 'pptx')),
  constraint document_summaries_coverage_check check (coverage in ('key_points', 'comprehensive')),
  constraint document_summaries_detail_check check (detail in ('brief', 'standard', 'detailed')),
  constraint document_summaries_language_check
    check (char_length(document_language) between 2 and 16
      and document_language ~ '^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$'),
  constraint document_summaries_items_check
    check (jsonb_typeof(summary_items) = 'array'
      and jsonb_array_length(summary_items) between 1 and 30
      and octet_length(summary_items::text) <= 262144)
);

create index document_summaries_user_created_idx
  on public.document_summaries (user_id, created_at desc, id desc);
create index document_summary_requests_user_started_idx
  on public.document_summary_requests (user_id, started_at desc);

alter table public.document_summaries enable row level security;
alter table public.document_summary_requests enable row level security;

create policy part06_document_summaries_select_own on public.document_summaries
  for select to authenticated using (user_id = (select auth.uid()));
create policy part06_document_summaries_delete_own on public.document_summaries
  for delete to authenticated using (user_id = (select auth.uid()));

-- The Edge Function reaches these tables only through the narrowly scoped
-- security-definer RPCs below.  Keep service_role from bypassing that boundary.
revoke all privileges on table public.document_summaries from anon, authenticated, service_role;
revoke all privileges on table public.document_summary_requests from anon, authenticated, service_role;
revoke select (id, user_id, request_id, source_name, document_hash, input_format, coverage, detail,
  document_language, summary_items, created_at),
  insert (id, user_id, request_id, source_name, document_hash, input_format, coverage, detail,
  document_language, summary_items, created_at),
  update (id, user_id, request_id, source_name, document_hash, input_format, coverage, detail,
  document_language, summary_items, created_at)
  on public.document_summaries from anon, authenticated;
revoke select (id, user_id, status, input_format, document_hash, result_hash, error_code, started_at, finished_at),
  insert (id, user_id, status, input_format, document_hash, result_hash, error_code, started_at, finished_at),
  update (id, user_id, status, input_format, document_hash, result_hash, error_code, started_at, finished_at)
  on public.document_summary_requests from anon, authenticated;

grant usage on schema public to authenticated, service_role;
grant select (id, request_id, source_name, document_hash, input_format, coverage, detail,
  document_language, summary_items, created_at) on public.document_summaries to authenticated;
grant delete on public.document_summaries to authenticated;

create or replace function public.part06_claim_summary_request(
  p_user_id uuid,
  p_request_id uuid,
  p_input_format text,
  p_document_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  existing public.document_summary_requests%rowtype;
  saved public.document_summaries%rowtype;
  history_count integer;
  recent_count integer;
begin
  if p_user_id is null or p_request_id is null
    or p_input_format not in ('direct', 'txt', 'markdown', 'pdf', 'doc', 'docx', 'ppt', 'pptx')
    or p_document_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'part06_invalid_request';
  end if;

  -- A transaction-scoped lock derived from the full UUID text serializes Part 6 work per user.
  -- hashtextextended returns bigint directly, avoiding lossy UUID casts or two-int truncation.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 602026));

  update public.document_summary_requests
    set status = 'failed', error_code = 'expired_processing', result_hash = null, finished_at = now()
    where user_id = p_user_id and status = 'processing'
      and started_at < now() - interval '65 seconds';
  select * into existing from public.document_summary_requests where id = p_request_id;
  if found then
    if existing.user_id <> p_user_id or existing.input_format <> p_input_format
      or existing.document_hash <> p_document_hash then
      raise exception using errcode = '42501', message = 'part06_request_unavailable';
    end if;
    if existing.status = 'completed' then
      select * into saved from public.document_summaries
        where user_id = p_user_id and request_id = p_request_id;
      if not found then
        raise exception using errcode = '55000', message = 'part06_saved_result_unavailable';
      end if;
      return jsonb_build_object('outcome', 'completed', 'result', to_jsonb(saved) - 'user_id');
    end if;
    if existing.status in ('processing', 'generated') then
      raise exception using errcode = '55000', message = 'part06_request_busy';
    end if;
    raise exception using errcode = '55000', message = 'part06_failed_request';
  end if;

  select count(*) into history_count from public.document_summaries where user_id = p_user_id;
  if history_count >= 100 then
    raise exception using errcode = '54000', message = 'part06_history_limit_reached';
  end if;
  if exists (select 1 from public.document_summary_requests
    where user_id = p_user_id and status = 'processing') then
    raise exception using errcode = '55000', message = 'part06_user_busy';
  end if;
  select count(*) into recent_count from public.document_summary_requests
    where user_id = p_user_id and started_at >= now() - interval '1 hour';
  if recent_count >= 10 then
    raise exception using errcode = '54000', message = 'part06_rate_limit';
  end if;

  insert into public.document_summary_requests (id, user_id, input_format, document_hash)
    values (p_request_id, p_user_id, p_input_format, p_document_hash);
  return jsonb_build_object('outcome', 'claimed');
end;
$$;

create or replace function public.part06_mark_summary_generated(
  p_user_id uuid,
  p_request_id uuid,
  p_result_hash text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_result_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'part06_invalid_result_hash';
  end if;
  update public.document_summary_requests
    set status = 'generated', result_hash = p_result_hash, error_code = null
    where id = p_request_id and user_id = p_user_id and status = 'processing';
  if found then return true; end if;
  if exists (select 1 from public.document_summary_requests
    where id = p_request_id and user_id = p_user_id and status in ('generated', 'completed') and result_hash = p_result_hash) then
    return true;
  end if;
  raise exception using errcode = '55000', message = 'part06_request_not_processing';
end;
$$;

create or replace function public.part06_complete_summary_request(
  p_user_id uuid,
  p_request_id uuid,
  p_result_hash text,
  p_source_name text,
  p_document_hash text,
  p_input_format text,
  p_coverage text,
  p_detail text,
  p_document_language text,
  p_summary_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  request_row public.document_summary_requests%rowtype;
  result_row public.document_summaries%rowtype;
  history_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 602026));
  select * into request_row from public.document_summary_requests
    where id = p_request_id and user_id = p_user_id for update;
  if found and request_row.status = 'completed' and request_row.result_hash = p_result_hash then
    select * into result_row from public.document_summaries
      where user_id = p_user_id and request_id = p_request_id;
    if found then return to_jsonb(result_row) - 'user_id'; end if;
  end if;
  if not found or request_row.status <> 'generated' or request_row.result_hash <> p_result_hash
    or request_row.document_hash <> p_document_hash or request_row.input_format <> p_input_format then
    raise exception using errcode = '55000', message = 'part06_generated_result_unavailable';
  end if;
  select count(*) into history_count from public.document_summaries where user_id = p_user_id;
  if history_count >= 100 then
    raise exception using errcode = '54000', message = 'part06_history_limit_reached';
  end if;
  insert into public.document_summaries (
    user_id, request_id, source_name, document_hash, input_format, coverage, detail,
    document_language, summary_items
  ) values (
    p_user_id, p_request_id, p_source_name, p_document_hash, p_input_format, p_coverage, p_detail,
    p_document_language, p_summary_items
  ) returning * into result_row;
  update public.document_summary_requests
    set status = 'completed', error_code = null, finished_at = now()
    where id = p_request_id;
  return to_jsonb(result_row) - 'user_id';
exception
  when unique_violation then
    select * into result_row from public.document_summaries
      where user_id = p_user_id and request_id = p_request_id;
    if found then return to_jsonb(result_row) - 'user_id'; end if;
    raise;
end;
$$;

create or replace function public.part06_fail_summary_request(
  p_user_id uuid,
  p_request_id uuid,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_error_code is null or p_error_code !~ '^[a-z0-9_]{1,50}$' then
    p_error_code := 'generation_failed';
  end if;
  update public.document_summary_requests
    set status = 'failed', error_code = p_error_code, result_hash = null, finished_at = now()
    where id = p_request_id and user_id = p_user_id and status = 'processing';
  return found;
end;
$$;

revoke all on function public.part06_claim_summary_request(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.part06_mark_summary_generated(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.part06_complete_summary_request(uuid, uuid, text, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.part06_fail_summary_request(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.part06_claim_summary_request(uuid, uuid, text, text) to service_role;
grant execute on function public.part06_mark_summary_generated(uuid, uuid, text) to service_role;
grant execute on function public.part06_complete_summary_request(uuid, uuid, text, text, text, text, text, text, text, jsonb) to service_role;
grant execute on function public.part06_fail_summary_request(uuid, uuid, text) to service_role;

commit;
