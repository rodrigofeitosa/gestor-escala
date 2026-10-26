-- Domain revision conflicts are HTTP 409, never transient PostgreSQL serialization errors.
-- PostgREST 14 retries SQLSTATE 40001 indefinitely; preserve every permission and version guard.
do $migration$
declare routine record; definition text; changed integer=0;
begin
 for routine in
 select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='private' and p.prokind='f' and p.proname in
 ('guard_configuration','save_schedule','mutate_configuration','revise_schedule','publish_schedule','save_employee')
 and p.prosrc like '%40001%'
 loop
  definition=pg_get_functiondef(routine.oid);
  execute replace(definition,'''40001''','''PT409''');
  changed=changed+1;
 end loop;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.prosrc like '%40001%') then
  raise exception 'Há conflitos de revisão ainda usando SQLSTATE reservado.';
 end if;
end $migration$;
notify pgrst,'reload schema';
