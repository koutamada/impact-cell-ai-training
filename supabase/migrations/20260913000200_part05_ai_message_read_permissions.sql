begin;

-- Edge Functionはコンテキスト構築と保存結果取得に、この列だけを直接読む。
revoke all privileges on table public.ai_messages from service_role;
grant select (id, conversation_id, role, content, request_id, status, created_at)
  on public.ai_messages to service_role;

-- ai_conversationsの公開対象列idを、同テーブルのRLS経由で参照する。
-- 非公開列user_idをai_messages側のPolicyから直接参照しない。
drop policy if exists part05_ai_messages_select_own on public.ai_messages;
create policy part05_ai_messages_select_own on public.ai_messages
  for select to authenticated using (exists (
    select 1 from public.ai_conversations c
    where c.id = ai_messages.conversation_id
  ));

commit;
