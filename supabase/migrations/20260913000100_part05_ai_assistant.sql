begin;

create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '新しい会話',
  generation_status text not null default 'idle',
  active_request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_requests (
  id uuid primary key,
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'processing',
  error_code text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.ai_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  role text not null,
  content text not null,
  request_id uuid not null,
  status text not null,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ai_conversations_title_check' and conrelid = 'public.ai_conversations'::regclass) then
    alter table public.ai_conversations add constraint ai_conversations_title_check
      check (title = btrim(title) and char_length(title) between 1 and 60 and title !~ '[[:cntrl:]]');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_conversations_generation_check' and conrelid = 'public.ai_conversations'::regclass) then
    alter table public.ai_conversations add constraint ai_conversations_generation_check
      check ((generation_status = 'idle' and active_request_id is null)
        or (generation_status = 'generating' and active_request_id is not null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_requests_status_check' and conrelid = 'public.ai_requests'::regclass) then
    alter table public.ai_requests add constraint ai_requests_status_check
      check (status in ('processing', 'completed', 'failed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_requests_error_code_check' and conrelid = 'public.ai_requests'::regclass) then
    alter table public.ai_requests add constraint ai_requests_error_code_check
      check (error_code is null or (char_length(error_code) between 1 and 50 and error_code ~ '^[a-z0-9_]+$'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_messages_role_check' and conrelid = 'public.ai_messages'::regclass) then
    alter table public.ai_messages add constraint ai_messages_role_check
      check (role in ('user', 'assistant'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_messages_status_check' and conrelid = 'public.ai_messages'::regclass) then
    alter table public.ai_messages add constraint ai_messages_status_check
      check ((role = 'user' and status in ('pending', 'completed', 'failed'))
        or (role = 'assistant' and status = 'completed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_messages_content_check' and conrelid = 'public.ai_messages'::regclass) then
    alter table public.ai_messages add constraint ai_messages_content_check
      check (content = btrim(content)
        and content !~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]'
        and ((role = 'user' and char_length(content) between 1 and 2000)
          or (role = 'assistant' and char_length(content) between 1 and 12000)));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_messages_conversation_request_role_key' and conrelid = 'public.ai_messages'::regclass) then
    alter table public.ai_messages add constraint ai_messages_conversation_request_role_key
      unique (conversation_id, request_id, role);
  end if;
end
$$;

create index if not exists ai_conversations_user_updated_idx
  on public.ai_conversations (user_id, updated_at desc, id desc);
create index if not exists ai_messages_conversation_created_idx
  on public.ai_messages (conversation_id, created_at desc, id desc);
create index if not exists ai_requests_user_started_idx
  on public.ai_requests (user_id, started_at desc);

create or replace function public.part05_set_ai_conversations_updated_at()
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

drop trigger if exists part05_ai_conversations_updated_at on public.ai_conversations;
create trigger part05_ai_conversations_updated_at
before update on public.ai_conversations
for each row execute function public.part05_set_ai_conversations_updated_at();

create or replace function public.part05_title_from_question(p_content text)
returns text
language plpgsql
immutable
security invoker
set search_path = pg_catalog, public
as $$
declare
  normalized text;
begin
  normalized := btrim(regexp_replace(p_content, '[[:space:]]+', ' ', 'g'));
  if char_length(normalized) <= 60 then
    return normalized;
  end if;
  return substr(normalized, 1, 59) || '…';
end;
$$;

create or replace function public.part05_claim_ai_turn(
  p_user_id uuid,
  p_conversation_id uuid,
  p_request_id uuid,
  p_content text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target public.ai_conversations%rowtype;
  request_row public.ai_requests%rowtype;
  message_row public.ai_messages%rowtype;
  recent_count integer;
begin
  if p_user_id is null or p_conversation_id is null or p_request_id is null then
    raise exception using errcode = '22023', message = 'part05_invalid_request';
  end if;
  if p_content is null or p_content <> btrim(p_content)
    or char_length(p_content) not between 1 and 2000
    or p_content ~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]' then
    raise exception using errcode = '22023', message = 'part05_invalid_content';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 502025));

  select * into target
    from public.ai_conversations
    where id = p_conversation_id and user_id = p_user_id
    for update;
  if not found then
    raise exception using errcode = '42501', message = 'part05_conversation_unavailable';
  end if;

  select * into request_row from public.ai_requests where id = p_request_id;
  if found then
    if request_row.user_id <> p_user_id or request_row.conversation_id <> p_conversation_id then
      raise exception using errcode = '42501', message = 'part05_request_unavailable';
    end if;
    if request_row.status = 'completed' then
      return jsonb_build_object('outcome', 'completed');
    end if;
    if request_row.status = 'processing' then
      raise exception using errcode = '55000', message = 'part05_request_in_progress';
    end if;
  end if;

  if target.generation_status = 'generating' then
    raise exception using errcode = '55000', message = 'part05_conversation_busy';
  end if;

  select count(*) into recent_count
    from public.ai_requests
    where user_id = p_user_id and started_at >= now() - interval '5 minutes';
  if request_row.id is null and recent_count >= 10 then
    raise exception using errcode = '54000', message = 'part05_rate_limit';
  end if;

  if request_row.id is null then
    insert into public.ai_requests (id, conversation_id, user_id, status)
      values (p_request_id, p_conversation_id, p_user_id, 'processing');
    insert into public.ai_messages (conversation_id, role, content, request_id, status)
      values (p_conversation_id, 'user', p_content, p_request_id, 'pending')
      returning * into message_row;
  else
    update public.ai_requests
      set status = 'processing', error_code = null, started_at = now(), finished_at = null
      where id = p_request_id;
    update public.ai_messages
      set status = 'pending'
      where conversation_id = p_conversation_id and request_id = p_request_id and role = 'user'
      returning * into message_row;
    if not found or message_row.content <> p_content then
      raise exception using errcode = '22023', message = 'part05_retry_content_mismatch';
    end if;
  end if;

  update public.ai_conversations
    set generation_status = 'generating',
        active_request_id = p_request_id
    where id = p_conversation_id;

  return jsonb_build_object(
    'outcome', case when request_row.id is null then 'claimed' else 'retried' end,
    'message_id', message_row.id::text
  );
end;
$$;

create or replace function public.part05_complete_ai_turn(
  p_user_id uuid,
  p_conversation_id uuid,
  p_request_id uuid,
  p_content text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target public.ai_conversations%rowtype;
  assistant_row public.ai_messages%rowtype;
  user_content text;
  is_first boolean;
begin
  if p_content is null or p_content <> btrim(p_content)
    or char_length(p_content) not between 1 and 12000
    or p_content ~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]' then
    raise exception using errcode = '22023', message = 'part05_invalid_ai_content';
  end if;
  select * into target from public.ai_conversations
    where id = p_conversation_id and user_id = p_user_id for update;
  if not found or target.generation_status <> 'generating' or target.active_request_id <> p_request_id then
    raise exception using errcode = '55000', message = 'part05_stale_completion';
  end if;
  if not exists (select 1 from public.ai_requests where id = p_request_id
    and conversation_id = p_conversation_id and user_id = p_user_id and status = 'processing') then
    raise exception using errcode = '55000', message = 'part05_request_not_processing';
  end if;

  insert into public.ai_messages (conversation_id, role, content, request_id, status)
    values (p_conversation_id, 'assistant', p_content, p_request_id, 'completed')
    returning * into assistant_row;
  update public.ai_messages set status = 'completed'
    where conversation_id = p_conversation_id and request_id = p_request_id and role = 'user'
    returning content into user_content;
  if user_content is null then
    raise exception using errcode = '55000', message = 'part05_user_message_unavailable';
  end if;
  select not exists (
    select 1 from public.ai_messages
    where conversation_id = p_conversation_id and role = 'user'
      and request_id <> p_request_id and status = 'completed'
  ) into is_first;
  update public.ai_requests set status = 'completed', error_code = null, finished_at = now()
    where id = p_request_id;
  update public.ai_conversations
    set generation_status = 'idle', active_request_id = null,
        title = case when is_first and title = '新しい会話'
          then public.part05_title_from_question(user_content) else title end
    where id = p_conversation_id;

  return jsonb_build_object('outcome', 'completed', 'message_id', assistant_row.id::text);
end;
$$;

create or replace function public.part05_fail_ai_turn(
  p_user_id uuid,
  p_conversation_id uuid,
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
  update public.ai_requests set status = 'failed', error_code = p_error_code, finished_at = now()
    where id = p_request_id and conversation_id = p_conversation_id
      and user_id = p_user_id and status = 'processing';
  if not found then return false; end if;
  update public.ai_messages set status = 'failed'
    where conversation_id = p_conversation_id and request_id = p_request_id and role = 'user';
  update public.ai_conversations set generation_status = 'idle', active_request_id = null
    where id = p_conversation_id and user_id = p_user_id and active_request_id = p_request_id;
  return true;
end;
$$;

alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_requests enable row level security;

drop policy if exists part05_ai_conversations_select_own on public.ai_conversations;
create policy part05_ai_conversations_select_own on public.ai_conversations
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists part05_ai_conversations_insert_own on public.ai_conversations;
create policy part05_ai_conversations_insert_own on public.ai_conversations
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists part05_ai_conversations_delete_own on public.ai_conversations;
create policy part05_ai_conversations_delete_own on public.ai_conversations
  for delete to authenticated using (user_id = (select auth.uid()));
drop policy if exists part05_ai_messages_select_own on public.ai_messages;
create policy part05_ai_messages_select_own on public.ai_messages
  for select to authenticated using (exists (
    select 1 from public.ai_conversations c
    where c.id = ai_messages.conversation_id and c.user_id = (select auth.uid())
  ));

revoke all privileges on table public.ai_conversations from anon, authenticated;
revoke all privileges on table public.ai_messages from anon, authenticated;
revoke all privileges on table public.ai_requests from anon, authenticated;
revoke select (id, user_id, title, generation_status, active_request_id, created_at, updated_at),
  insert (id, user_id, title, generation_status, active_request_id, created_at, updated_at),
  update (id, user_id, title, generation_status, active_request_id, created_at, updated_at)
  on public.ai_conversations from anon, authenticated;
revoke select (id, conversation_id, role, content, request_id, status, created_at),
  insert (id, conversation_id, role, content, request_id, status, created_at),
  update (id, conversation_id, role, content, request_id, status, created_at)
  on public.ai_messages from anon, authenticated;
revoke select (id, conversation_id, user_id, status, error_code, started_at, finished_at),
  insert (id, conversation_id, user_id, status, error_code, started_at, finished_at),
  update (id, conversation_id, user_id, status, error_code, started_at, finished_at)
  on public.ai_requests from anon, authenticated;

grant usage on schema public to authenticated;
grant select (id, title, generation_status, created_at, updated_at)
  on public.ai_conversations to authenticated;
grant insert (user_id) on public.ai_conversations to authenticated;
grant delete on public.ai_conversations to authenticated;
grant select (id, conversation_id, role, content, request_id, status, created_at)
  on public.ai_messages to authenticated;

revoke all on function public.part05_set_ai_conversations_updated_at() from public, anon, authenticated;
revoke all on function public.part05_title_from_question(text) from public, anon, authenticated;
revoke all on function public.part05_claim_ai_turn(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.part05_complete_ai_turn(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.part05_fail_ai_turn(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.part05_claim_ai_turn(uuid, uuid, uuid, text) to service_role;
grant execute on function public.part05_complete_ai_turn(uuid, uuid, uuid, text) to service_role;
grant execute on function public.part05_fail_ai_turn(uuid, uuid, uuid, text) to service_role;

revoke all on sequence public.ai_messages_id_seq from anon, authenticated;

commit;
