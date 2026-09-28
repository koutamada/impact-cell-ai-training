begin;

-- The admin-users Edge Function uses the server-only Secret Key, which maps
-- to service_role. Keep browser roles read-only and grant only the table
-- operations required by the verified admin actions.
grant usage on schema public to service_role;

grant select, insert, update
  on table public.workflow_users
  to service_role;

grant select, insert, update
  on table public.workflow_departments
  to service_role;

grant select, insert, update
  on table public.workflow_categories
  to service_role;

grant insert
  on table public.workflow_audit_logs
  to service_role;

grant usage, select
  on sequence public.workflow_audit_logs_id_seq
  to service_role;

commit;
