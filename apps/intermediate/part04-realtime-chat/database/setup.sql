begin;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id),
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.profiles
  alter column created_at set default now(),
  alter column updated_at set default now();

alter table public.messages
  alter column created_at set default now();

alter table public.profiles drop constraint if exists profiles_username_valid;
alter table public.profiles add constraint profiles_username_valid check (
  username = btrim(username)
  and char_length(username) between 2 and 30
  and username !~ '^[[:space:]]|[[:space:]]$'
  and username !~ '[[:cntrl:]]'
);

alter table public.messages drop constraint if exists messages_body_valid;
alter table public.messages add constraint messages_body_valid check (
  body = btrim(body, E' \t\n\r\f\013')
  and char_length(body) between 1 and 1000
  and body !~ '^[[:space:]]|[[:space:]]$'
  and replace(replace(replace(body, E'\t', ''), E'\n', ''), E'\r', '') !~ '[[:cntrl:]]'
);

drop index if exists public.profiles_username_casefold_unique;
create unique index profiles_username_casefold_unique
  on public.profiles (lower(btrim(username)));

drop index if exists public.messages_created_at_id_desc_idx;
create index messages_created_at_id_desc_idx
  on public.messages (created_at desc, id desc);

create or replace function public.set_profile_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all privileges on function public.set_profile_updated_at() from public, anon, authenticated;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_profile_updated_at();

alter table public.profiles enable row level security;
alter table public.messages enable row level security;

drop policy if exists profiles_authenticated_select on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists messages_authenticated_select on public.messages;
drop policy if exists messages_insert_own on public.messages;

create policy profiles_authenticated_select
on public.profiles for select
to authenticated
using (true);

create policy profiles_insert_own
on public.profiles for insert
to authenticated
with check (id = (select auth.uid()));

create policy profiles_update_own
on public.profiles for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy messages_authenticated_select
on public.messages for select
to authenticated
using (true);

create policy messages_insert_own
on public.messages for insert
to authenticated
with check (user_id = (select auth.uid()));

revoke all privileges on table public.profiles from anon, authenticated;
revoke all privileges on table public.messages from anon, authenticated;

revoke select (id, username, created_at, updated_at),
  insert (id, username, created_at, updated_at),
  update (id, username, created_at, updated_at)
on public.profiles from anon, authenticated;

revoke select (id, user_id, body, created_at),
  insert (id, user_id, body, created_at),
  update (id, user_id, body, created_at)
on public.messages from anon, authenticated;

grant usage on schema public to authenticated;
grant select (id, username) on public.profiles to authenticated;
grant insert (id, username) on public.profiles to authenticated;
grant update (username) on public.profiles to authenticated;
grant select (id, user_id, body, created_at) on public.messages to authenticated;
grant insert (user_id, body) on public.messages to authenticated;

revoke all privileges on sequence public.messages_id_seq from anon, authenticated;
grant usage on sequence public.messages_id_seq to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end;
$$;

commit;

-- Profile creation is intentionally separate from Auth signup.
-- After authentication, the client inserts only (id, username) for auth.uid().
