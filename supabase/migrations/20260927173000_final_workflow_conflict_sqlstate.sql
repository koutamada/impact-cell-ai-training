-- 40001 is PostgreSQL's serialization_failure and may be retried by the
-- connection layer. Version mismatches are application conflicts, so expose
-- them as ordinary PL/pgSQL exceptions instead.
do $migration$
declare
  function_name text;
  function_oid oid;
  function_ddl text;
  changed_count integer := 0;
  conflict_functions constant text[] := array[
    'workflow_update_request',
    'workflow_delete_request',
    'workflow_submit_request',
    'workflow_approve_request',
    'workflow_reject_request',
    'workflow_return_request',
    'workflow_assign_request',
    'workflow_start_request',
    'workflow_complete_request'
  ];
begin
  for function_name, function_oid in
    select procedure.proname, procedure.oid
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = any (conflict_functions)
    order by procedure.proname
  loop
    function_ddl := pg_catalog.pg_get_functiondef(function_oid);

    if function_ddl not like '%errcode = ''40001''%' then
      raise exception 'Expected 40001 conflict marker was not found in %', function_name;
    end if;

    function_ddl := replace(
      function_ddl,
      'errcode = ''40001''',
      'errcode = ''P0001'''
    );
    execute function_ddl;
    changed_count := changed_count + 1;
  end loop;

  if changed_count <> cardinality(conflict_functions) then
    raise exception 'Expected % conflict functions, updated %',
      cardinality(conflict_functions),
      changed_count;
  end if;
end
$migration$;
