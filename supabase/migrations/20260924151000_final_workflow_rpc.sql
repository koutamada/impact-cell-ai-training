begin;

create or replace function public.workflow_assert_actor(
  p_allowed_roles public.workflow_user_role[] default null
)
returns public.workflow_users
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.workflow_users%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '28000', message = 'workflow_auth_required';
  end if;

  select * into actor
  from public.workflow_users
  where id = (select auth.uid())
    and is_active = true;

  if not found then
    raise exception using errcode = '42501', message = 'workflow_user_unavailable';
  end if;

  if p_allowed_roles is not null and not (actor.role = any(p_allowed_roles)) then
    raise exception using errcode = '42501', message = 'workflow_role_forbidden';
  end if;

  return actor;
end;
$$;

create or replace function public.workflow_write_audit(
  p_request_id uuid,
  p_actor_id uuid,
  p_action text,
  p_from_status public.workflow_request_status,
  p_to_status public.workflow_request_status,
  p_summary text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.workflow_audit_logs (
    request_id,
    actor_id,
    action,
    from_status,
    to_status,
    summary,
    metadata
  ) values (
    p_request_id,
    p_actor_id,
    p_action,
    p_from_status,
    p_to_status,
    p_summary,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

create or replace function public.workflow_write_notification(
  p_recipient_id uuid,
  p_request_id uuid,
  p_type text,
  p_title text,
  p_body text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_recipient_id is null then
    return;
  end if;

  if not exists (
    select 1
    from public.workflow_users
    where id = p_recipient_id and is_active = true
  ) then
    return;
  end if;

  insert into public.workflow_notifications (
    recipient_id,
    request_id,
    type,
    title,
    body
  ) values (
    p_recipient_id,
    p_request_id,
    p_type,
    p_title,
    p_body
  );
end;
$$;

create or replace function public.workflow_get_my_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.workflow_users%rowtype;
  department_name text;
begin
  actor := public.workflow_assert_actor(null);

  select d.name into department_name
  from public.workflow_departments d
  where d.id = actor.department_id;

  return jsonb_build_object(
    'id', actor.id,
    'display_name', actor.display_name,
    'role', actor.role,
    'department_id', actor.department_id,
    'department_name', department_name
  );
end;
$$;

create or replace function public.workflow_create_request(
  p_title text,
  p_description text,
  p_category_id uuid,
  p_priority public.workflow_request_priority,
  p_desired_due_date date
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.workflow_users%rowtype;
  created_request public.workflow_requests%rowtype;
begin
  actor := public.workflow_assert_actor(array['requester']::public.workflow_user_role[]);

  if actor.department_id is null then
    raise exception using errcode = '55000', message = 'workflow_department_required';
  end if;

  p_title := btrim(p_title);
  p_description := btrim(p_description);

  if not exists (
    select 1 from public.workflow_categories
    where id = p_category_id and is_active = true
  ) then
    raise exception using errcode = '22023', message = 'workflow_category_invalid';
  end if;

  insert into public.workflow_requests (
    title,
    description,
    category_id,
    priority,
    desired_due_date,
    requester_id,
    department_id
  ) values (
    p_title,
    p_description,
    p_category_id,
    p_priority,
    p_desired_due_date,
    actor.id,
    actor.department_id
  )
  returning * into created_request;

  perform public.workflow_write_audit(
    created_request.id,
    actor.id,
    'created',
    null,
    'draft',
    '案件を下書きとして作成しました',
    jsonb_build_object('request_number', created_request.request_number)
  );

  return jsonb_build_object(
    'id', created_request.id,
    'request_number', created_request.request_number,
    'status', created_request.status,
    'version', created_request.version
  );
end;
$$;

create or replace function public.workflow_update_request(
  p_request_id uuid,
  p_expected_version integer,
  p_title text,
  p_description text,
  p_category_id uuid,
  p_priority public.workflow_request_priority,
  p_desired_due_date date
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.workflow_users%rowtype;
  target public.workflow_requests%rowtype;
begin
  actor := public.workflow_assert_actor(array['requester']::public.workflow_user_role[]);

  select * into target
  from public.workflow_requests
  where id = p_request_id
    and requester_id = actor.id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'workflow_request_unavailable';
  end if;

  if target.status not in ('draft', 'returned') then
    raise exception using errcode = '55000', message = 'workflow_request_not_editable';
  end if;

  if target.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'workflow_version_conflict';
  end if;

  if not exists (
    select 1 from public.workflow_categories
    where id = p_category_id and is_active = true
  ) then
    raise exception using errcode = '22023', message = 'workflow_category_invalid';
  end if;

  update public.workflow_requests
  set title = btrim(p_title),
      description = btrim(p_description),
      category_id = p_category_id,
      priority = p_priority,
      desired_due_date = p_desired_due_date,
      version = version + 1
  where id = target.id
  returning * into target;

  perform public.workflow_write_audit(
    target.id,
    actor.id,
    'updated',
    target.status,
    target.status,
    '案件内容を変更しました'
  );

  return jsonb_build_object(
    'id', target.id,
    'status', target.status,
    'version', target.version
  );
end;
$$;

create or replace function public.workflow_delete_request(
  p_request_id uuid,
  p_expected_version integer
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.workflow_users%rowtype;
  target public.workflow_requests%rowtype;
begin
  actor := public.workflow_assert_actor(array['requester']::public.workflow_user_role[]);

  select * into target
  from public.workflow_requests
  where id = p_request_id
    and requester_id = actor.id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'workflow_request_unavailable';
  end if;

  if target.status not in ('draft', 'returned') then
    raise exception using errcode = '55000', message = 'workflow_request_not_deletable';
  end if;

  if target.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'workflow_version_conflict';
  end if;

  if exists (
    select 1 from public.workflow_attachments
    where request_id = target.id
  ) then
    raise exception using errcode = '55000', message = 'workflow_attachments_must_be_deleted_first';
  end if;

  perform public.workflow_write_audit(
    target.id,
    actor.id,
    'deleted',
    target.status,
    null,
    '下書き案件を削除しました',
    jsonb_build_object(
      'request_number', target.request_number,
      'title', target.title
    )
  );

  delete from public.workflow_requests where id = target.id;
  return true;
end;
$$;

create or replace function public.workflow_submit_request(
  p_request_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.workflow_users%rowtype;
  target public.workflow_requests%rowtype;
  assigned_approver public.workflow_users%rowtype;
  previous_status public.workflow_request_status;
  audit_action text;
begin
  actor := public.workflow_assert_actor(array['requester']::public.workflow_user_role[]);

  select * into target
  from public.workflow_requests
  where id = p_request_id
    and requester_id = actor.id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'workflow_request_unavailable';
  end if;

  if target.status not in ('draft', 'returned') then
    raise exception using errcode = '55000', message = 'workflow_request_not_submittable';
  end if;

  if target.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'workflow_version_conflict';
  end if;

  select u.* into assigned_approver
  from public.workflow_departments d
  join public.workflow_users u on u.id = d.approver_id
  where d.id = target.department_id
    and d.is_active = true
    and u.is_active = true
    and u.role = 'approver';

  if not found then
    raise exception using errcode = '55000', message = 'workflow_approver_unavailable';
  end if;

  previous_status := target.status;
  audit_action := case when previous_status = 'returned' then 'resubmitted' else 'submitted' end;

  update public.workflow_requests
  set status = 'pending_approval',
      approver_id = assigned_approver.id,
      submitted_at = now(),
      version = version + 1
  where id = target.id
  returning * into target;

  perform public.workflow_write_notification(
    assigned_approver.id,
    target.id,
    'approval_requested',
    '承認待ち案件があります',
    format('案件 #%s「%s」が申請されました。', target.request_number, target.title)
  );

  perform public.workflow_write_audit(
    target.id,
    actor.id,
    audit_action,
    previous_status,
    'pending_approval',
    case when previous_status = 'returned'
      then '案件を再申請しました'
      else '案件を申請しました'
    end,
    jsonb_build_object('approver_id', assigned_approver.id)
  );

  return jsonb_build_object(
    'id', target.id,
    'status', target.status,
    'version', target.version,
    'approver_id', target.approver_id
  );
end;
$$;

create or replace function public.workflow_approve_request(
  p_request_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.workflow_users%rowtype;
  target public.workflow_requests%rowtype;
begin
  actor := public.workflow_assert_actor(array['approver']::public.workflow_user_role[]);

  select * into target
  from public.workflow_requests
  where id = p_request_id
    and approver_id = actor.id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'workflow_request_unavailable';
  end if;
  if target.status <> 'pending_approval' then
    raise exception using errcode = '55000', message = 'workflow_request_not_pending';
  end if;
  if target.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'workflow_version_conflict';
  end if;

  insert into public.workflow_approval_records (request_id, approver_id, action)
  values (target.id, actor.id, 'approved');

  update public.workflow_requests
  set status = 'approved',
      approved_at = now(),
      version = version + 1
  where id = target.id
  returning * into target;

  perform public.workflow_write_notification(
    target.requester_id,
    target.id,
    'request_approved',
    '依頼が承認されました',
    format('案件 #%s「%s」が承認されました。', target.request_number, target.title)
  );

  perform public.workflow_write_audit(
    target.id,
    actor.id,
    'approved',
    'pending_approval',
    'approved',
    '案件を承認しました'
  );

  return jsonb_build_object('id', target.id, 'status', target.status, 'version', target.version);
end;
$$;

create or replace function public.workflow_reject_request(
  p_request_id uuid,
  p_expected_version integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.workflow_users%rowtype;
  target public.workflow_requests%rowtype;
begin
  actor := public.workflow_assert_actor(array['approver']::public.workflow_user_role[]);
  p_reason := btrim(p_reason);

  if p_reason is null or char_length(p_reason) not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'workflow_reason_required';
  end if;

  select * into target
  from public.workflow_requests
  where id = p_request_id
    and approver_id = actor.id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'workflow_request_unavailable';
  end if;
  if target.status <> 'pending_approval' then
    raise exception using errcode = '55000', message = 'workflow_request_not_pending';
  end if;
  if target.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'workflow_version_conflict';
  end if;

  insert into public.workflow_approval_records (request_id, approver_id, action, reason)
  values (target.id, actor.id, 'rejected', p_reason);

  update public.workflow_requests
  set status = 'rejected',
      version = version + 1
  where id = target.id
  returning * into target;

  perform public.workflow_write_notification(
    target.requester_id,
    target.id,
    'request_rejected',
    '依頼が却下されました',
    format('案件 #%s「%s」が却下されました。', target.request_number, target.title)
  );

  perform public.workflow_write_audit(
    target.id,
    actor.id,
    'rejected',
    'pending_approval',
    'rejected',
    '案件を却下しました',
    jsonb_build_object('reason', p_reason)
  );

  return jsonb_build_object('id', target.id, 'status', target.status, 'version', target.version);
end;
$$;

create or replace function public.workflow_return_request(
  p_request_id uuid,
  p_expected_version integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.workflow_users%rowtype;
  target public.workflow_requests%rowtype;
begin
  actor := public.workflow_assert_actor(array['approver']::public.workflow_user_role[]);
  p_reason := btrim(p_reason);

  if p_reason is null or char_length(p_reason) not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'workflow_reason_required';
  end if;

  select * into target
  from public.workflow_requests
  where id = p_request_id
    and approver_id = actor.id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'workflow_request_unavailable';
  end if;
  if target.status <> 'pending_approval' then
    raise exception using errcode = '55000', message = 'workflow_request_not_pending';
  end if;
  if target.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'workflow_version_conflict';
  end if;

  insert into public.workflow_approval_records (request_id, approver_id, action, reason)
  values (target.id, actor.id, 'returned', p_reason);

  update public.workflow_requests
  set status = 'returned',
      version = version + 1
  where id = target.id
  returning * into target;

  perform public.workflow_write_notification(
    target.requester_id,
    target.id,
    'request_returned',
    '依頼が差し戻されました',
    format('案件 #%s「%s」が差し戻されました。', target.request_number, target.title)
  );

  perform public.workflow_write_audit(
    target.id,
    actor.id,
    'returned',
    'pending_approval',
    'returned',
    '案件を差し戻しました',
    jsonb_build_object('reason', p_reason)
  );

  return jsonb_build_object('id', target.id, 'status', target.status, 'version', target.version);
end;
$$;

create or replace function public.workflow_assign_request(
  p_request_id uuid,
  p_expected_version integer,
  p_assignee_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.workflow_users%rowtype;
  target public.workflow_requests%rowtype;
  assignee public.workflow_users%rowtype;
  previous_assignee_id uuid;
  audit_action text;
begin
  actor := public.workflow_assert_actor(array['admin']::public.workflow_user_role[]);

  select * into assignee
  from public.workflow_users
  where id = p_assignee_id
    and role = 'worker'
    and is_active = true;

  if not found then
    raise exception using errcode = '22023', message = 'workflow_assignee_invalid';
  end if;

  select * into target
  from public.workflow_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'workflow_request_unavailable';
  end if;
  if target.status not in ('approved', 'in_progress') then
    raise exception using errcode = '55000', message = 'workflow_request_not_assignable';
  end if;
  if target.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'workflow_version_conflict';
  end if;

  previous_assignee_id := target.assignee_id;
  if previous_assignee_id = assignee.id then
    return jsonb_build_object(
      'id', target.id,
      'status', target.status,
      'version', target.version,
      'assignee_id', target.assignee_id,
      'unchanged', true
    );
  end if;

  audit_action := case when previous_assignee_id is null then 'assigned' else 'reassigned' end;

  update public.workflow_requests
  set assignee_id = assignee.id,
      version = version + 1
  where id = target.id
  returning * into target;

  perform public.workflow_write_notification(
    assignee.id,
    target.id,
    'request_assigned',
    '新しい案件が割り当てられました',
    format('案件 #%s「%s」の担当者に設定されました。', target.request_number, target.title)
  );

  if previous_assignee_id is not null then
    perform public.workflow_write_notification(
      previous_assignee_id,
      target.id,
      'request_unassigned',
      '案件の担当が変更されました',
      format('案件 #%s「%s」の担当から外れました。', target.request_number, target.title)
    );
  end if;

  perform public.workflow_write_audit(
    target.id,
    actor.id,
    audit_action,
    target.status,
    target.status,
    case when previous_assignee_id is null
      then '担当者を設定しました'
      else '担当者を変更しました'
    end,
    jsonb_build_object(
      'previous_assignee_id', previous_assignee_id,
      'assignee_id', assignee.id
    )
  );

  return jsonb_build_object(
    'id', target.id,
    'status', target.status,
    'version', target.version,
    'assignee_id', target.assignee_id,
    'unchanged', false
  );
end;
$$;

create or replace function public.workflow_start_request(
  p_request_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.workflow_users%rowtype;
  target public.workflow_requests%rowtype;
begin
  actor := public.workflow_assert_actor(array['worker']::public.workflow_user_role[]);

  select * into target
  from public.workflow_requests
  where id = p_request_id
    and assignee_id = actor.id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'workflow_request_unavailable';
  end if;
  if target.status <> 'approved' then
    raise exception using errcode = '55000', message = 'workflow_request_not_startable';
  end if;
  if target.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'workflow_version_conflict';
  end if;

  update public.workflow_requests
  set status = 'in_progress',
      started_at = now(),
      version = version + 1
  where id = target.id
  returning * into target;

  perform public.workflow_write_notification(
    target.requester_id,
    target.id,
    'request_started',
    '担当者が作業を開始しました',
    format('案件 #%s「%s」の対応が開始されました。', target.request_number, target.title)
  );

  perform public.workflow_write_audit(
    target.id,
    actor.id,
    'started',
    'approved',
    'in_progress',
    '案件の対応を開始しました'
  );

  return jsonb_build_object('id', target.id, 'status', target.status, 'version', target.version);
end;
$$;

create or replace function public.workflow_complete_request(
  p_request_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.workflow_users%rowtype;
  target public.workflow_requests%rowtype;
begin
  actor := public.workflow_assert_actor(array['worker']::public.workflow_user_role[]);

  select * into target
  from public.workflow_requests
  where id = p_request_id
    and assignee_id = actor.id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'workflow_request_unavailable';
  end if;
  if target.status <> 'in_progress' then
    raise exception using errcode = '55000', message = 'workflow_request_not_completable';
  end if;
  if target.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'workflow_version_conflict';
  end if;

  update public.workflow_requests
  set status = 'completed',
      completed_at = now(),
      version = version + 1
  where id = target.id
  returning * into target;

  perform public.workflow_write_notification(
    target.requester_id,
    target.id,
    'request_completed',
    '依頼が完了しました',
    format('案件 #%s「%s」が完了しました。', target.request_number, target.title)
  );

  perform public.workflow_write_audit(
    target.id,
    actor.id,
    'completed',
    'in_progress',
    'completed',
    '案件を完了しました'
  );

  return jsonb_build_object('id', target.id, 'status', target.status, 'version', target.version);
end;
$$;

create or replace function public.workflow_add_comment(
  p_request_id uuid,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.workflow_users%rowtype;
  target public.workflow_requests%rowtype;
  created_comment public.workflow_comments%rowtype;
  recipient_id uuid;
begin
  actor := public.workflow_assert_actor(null);
  p_body := btrim(p_body);

  if not public.workflow_can_view_request(p_request_id) then
    raise exception using errcode = '42501', message = 'workflow_request_unavailable';
  end if;

  select * into target from public.workflow_requests where id = p_request_id;

  insert into public.workflow_comments (request_id, author_id, body)
  values (target.id, actor.id, p_body)
  returning * into created_comment;

  for recipient_id in
    select distinct participant_id
    from unnest(array[target.requester_id, target.approver_id, target.assignee_id]) as participant_id
    where participant_id is not null
      and participant_id <> actor.id
  loop
    perform public.workflow_write_notification(
      recipient_id,
      target.id,
      'comment_added',
      '案件にコメントが追加されました',
      format('案件 #%s「%s」にコメントが追加されました。', target.request_number, target.title)
    );
  end loop;

  perform public.workflow_write_audit(
    target.id,
    actor.id,
    'commented',
    target.status,
    target.status,
    'コメントを追加しました',
    jsonb_build_object('comment_id', created_comment.id)
  );

  return jsonb_build_object(
    'id', created_comment.id,
    'request_id', created_comment.request_id,
    'author_id', created_comment.author_id,
    'body', created_comment.body,
    'created_at', created_comment.created_at
  );
end;
$$;

create or replace function public.workflow_add_attachment(
  p_request_id uuid,
  p_storage_path text,
  p_original_name text,
  p_mime_type text,
  p_size_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, storage
as $$
declare
  actor public.workflow_users%rowtype;
  target public.workflow_requests%rowtype;
  created_attachment public.workflow_attachments%rowtype;
  attachment_count integer;
begin
  actor := public.workflow_assert_actor(array['requester']::public.workflow_user_role[]);

  select * into target
  from public.workflow_requests
  where id = p_request_id
    and requester_id = actor.id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'workflow_request_unavailable';
  end if;
  if target.status not in ('draft', 'returned') then
    raise exception using errcode = '55000', message = 'workflow_attachment_not_editable';
  end if;
  if p_storage_path not like actor.id::text || '/' || target.id::text || '/%' then
    raise exception using errcode = '22023', message = 'workflow_attachment_path_invalid';
  end if;

  select count(*) into attachment_count
  from public.workflow_attachments
  where request_id = target.id;

  if attachment_count >= 5 then
    raise exception using errcode = '54000', message = 'workflow_attachment_limit';
  end if;

  if not exists (
    select 1
    from storage.objects
    where bucket_id = 'workflow-request-attachments'
      and name = p_storage_path
      and owner_id = actor.id::text
  ) then
    raise exception using errcode = '55000', message = 'workflow_attachment_object_unavailable';
  end if;

  insert into public.workflow_attachments (
    request_id,
    storage_path,
    original_name,
    mime_type,
    size_bytes,
    uploaded_by
  ) values (
    target.id,
    p_storage_path,
    btrim(p_original_name),
    p_mime_type,
    p_size_bytes,
    actor.id
  )
  returning * into created_attachment;

  perform public.workflow_write_audit(
    target.id,
    actor.id,
    'attachment_added',
    target.status,
    target.status,
    '添付ファイルを追加しました',
    jsonb_build_object(
      'attachment_id', created_attachment.id,
      'original_name', created_attachment.original_name
    )
  );

  return to_jsonb(created_attachment) - 'storage_path';
end;
$$;

create or replace function public.workflow_delete_attachment(
  p_attachment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.workflow_users%rowtype;
  target public.workflow_attachments%rowtype;
  request_row public.workflow_requests%rowtype;
begin
  actor := public.workflow_assert_actor(array['requester']::public.workflow_user_role[]);

  select a.* into target
  from public.workflow_attachments a
  join public.workflow_requests r on r.id = a.request_id
  where a.id = p_attachment_id
    and a.uploaded_by = actor.id
    and r.requester_id = actor.id
  for update of a;

  if not found then
    raise exception using errcode = '42501', message = 'workflow_attachment_unavailable';
  end if;

  select * into request_row
  from public.workflow_requests
  where id = target.request_id
  for update;

  if request_row.status not in ('draft', 'returned') then
    raise exception using errcode = '55000', message = 'workflow_attachment_not_editable';
  end if;

  delete from public.workflow_attachments where id = target.id;

  perform public.workflow_write_audit(
    request_row.id,
    actor.id,
    'attachment_deleted',
    request_row.status,
    request_row.status,
    '添付ファイルを削除しました',
    jsonb_build_object('original_name', target.original_name)
  );

  return jsonb_build_object(
    'id', target.id,
    'storage_path', target.storage_path
  );
end;
$$;

create or replace function public.workflow_mark_notification_read(
  p_notification_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.workflow_users%rowtype;
begin
  actor := public.workflow_assert_actor(null);

  update public.workflow_notifications
  set is_read = true,
      read_at = coalesce(read_at, now())
  where id = p_notification_id
    and recipient_id = actor.id;

  if not found then
    raise exception using errcode = '42501', message = 'workflow_notification_unavailable';
  end if;

  return true;
end;
$$;

create or replace function public.workflow_mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.workflow_users%rowtype;
  affected integer;
begin
  actor := public.workflow_assert_actor(null);

  update public.workflow_notifications
  set is_read = true,
      read_at = now()
  where recipient_id = actor.id
    and is_read = false;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

create or replace function public.workflow_get_dashboard_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.workflow_users%rowtype;
  result jsonb;
begin
  actor := public.workflow_assert_actor(null);

  if actor.role = 'requester' then
    select jsonb_build_object(
      'total', count(*),
      'pending_approval', count(*) filter (where status = 'pending_approval'),
      'in_progress', count(*) filter (where status = 'in_progress'),
      'completed', count(*) filter (where status = 'completed'),
      'returned', count(*) filter (where status = 'returned')
    ) into result
    from public.workflow_requests
    where requester_id = actor.id;
  elsif actor.role = 'approver' then
    select jsonb_build_object(
      'pending_approval', count(*) filter (where status = 'pending_approval'),
      'high_priority', count(*) filter (
        where status = 'pending_approval' and priority in ('high', 'urgent')
      ),
      'due_within_3_days', count(*) filter (
        where status = 'pending_approval'
          and desired_due_date between current_date and current_date + 3
      )
    ) into result
    from public.workflow_requests
    where approver_id = actor.id;
  elsif actor.role = 'worker' then
    select jsonb_build_object(
      'not_started', count(*) filter (where status = 'approved'),
      'in_progress', count(*) filter (where status = 'in_progress'),
      'overdue', count(*) filter (
        where status in ('approved', 'in_progress') and desired_due_date < current_date
      )
    ) into result
    from public.workflow_requests
    where assignee_id = actor.id;
  else
    select jsonb_build_object(
      'total', count(*),
      'draft', count(*) filter (where status = 'draft'),
      'pending_approval', count(*) filter (where status = 'pending_approval'),
      'approved', count(*) filter (where status = 'approved'),
      'in_progress', count(*) filter (where status = 'in_progress'),
      'completed', count(*) filter (where status = 'completed'),
      'rejected', count(*) filter (where status = 'rejected'),
      'returned', count(*) filter (where status = 'returned'),
      'unassigned', count(*) filter (where status = 'approved' and assignee_id is null),
      'overdue', count(*) filter (
        where status in ('approved', 'in_progress') and desired_due_date < current_date
      )
    ) into result
    from public.workflow_requests;
  end if;

  return result;
end;
$$;

revoke all on function public.workflow_assert_actor(public.workflow_user_role[]) from public, anon, authenticated;
revoke all on function public.workflow_write_audit(uuid, uuid, text, public.workflow_request_status, public.workflow_request_status, text, jsonb) from public, anon, authenticated;
revoke all on function public.workflow_write_notification(uuid, uuid, text, text, text) from public, anon, authenticated;

revoke all on function public.workflow_get_my_context() from public, anon, authenticated;
revoke all on function public.workflow_create_request(text, text, uuid, public.workflow_request_priority, date) from public, anon, authenticated;
revoke all on function public.workflow_update_request(uuid, integer, text, text, uuid, public.workflow_request_priority, date) from public, anon, authenticated;
revoke all on function public.workflow_delete_request(uuid, integer) from public, anon, authenticated;
revoke all on function public.workflow_submit_request(uuid, integer) from public, anon, authenticated;
revoke all on function public.workflow_approve_request(uuid, integer) from public, anon, authenticated;
revoke all on function public.workflow_reject_request(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.workflow_return_request(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.workflow_assign_request(uuid, integer, uuid) from public, anon, authenticated;
revoke all on function public.workflow_start_request(uuid, integer) from public, anon, authenticated;
revoke all on function public.workflow_complete_request(uuid, integer) from public, anon, authenticated;
revoke all on function public.workflow_add_comment(uuid, text) from public, anon, authenticated;
revoke all on function public.workflow_add_attachment(uuid, text, text, text, bigint) from public, anon, authenticated;
revoke all on function public.workflow_delete_attachment(uuid) from public, anon, authenticated;
revoke all on function public.workflow_mark_notification_read(uuid) from public, anon, authenticated;
revoke all on function public.workflow_mark_all_notifications_read() from public, anon, authenticated;
revoke all on function public.workflow_get_dashboard_stats() from public, anon, authenticated;

grant execute on function public.workflow_get_my_context() to authenticated;
grant execute on function public.workflow_create_request(text, text, uuid, public.workflow_request_priority, date) to authenticated;
grant execute on function public.workflow_update_request(uuid, integer, text, text, uuid, public.workflow_request_priority, date) to authenticated;
grant execute on function public.workflow_delete_request(uuid, integer) to authenticated;
grant execute on function public.workflow_submit_request(uuid, integer) to authenticated;
grant execute on function public.workflow_approve_request(uuid, integer) to authenticated;
grant execute on function public.workflow_reject_request(uuid, integer, text) to authenticated;
grant execute on function public.workflow_return_request(uuid, integer, text) to authenticated;
grant execute on function public.workflow_assign_request(uuid, integer, uuid) to authenticated;
grant execute on function public.workflow_start_request(uuid, integer) to authenticated;
grant execute on function public.workflow_complete_request(uuid, integer) to authenticated;
grant execute on function public.workflow_add_comment(uuid, text) to authenticated;
grant execute on function public.workflow_add_attachment(uuid, text, text, text, bigint) to authenticated;
grant execute on function public.workflow_delete_attachment(uuid) to authenticated;
grant execute on function public.workflow_mark_notification_read(uuid) to authenticated;
grant execute on function public.workflow_mark_all_notifications_read() to authenticated;
grant execute on function public.workflow_get_dashboard_stats() to authenticated;

commit;
