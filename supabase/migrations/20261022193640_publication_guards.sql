-- Reject incomplete work entries even when called outside the browser.
alter table public.schedule_entries drop constraint schedule_entries_check;
alter table public.schedule_entries add constraint schedule_entries_work_times check(kind<>'work' or (start_time is not null and end_time is not null and break_start is not null and break_end is not null and start_time<break_start and break_start<break_end and break_end<end_time));


create or replace function private.save_schedule(p_unit uuid,p_week date,p_revision integer,p_unit_revision integer,p_entries jsonb,p_reason text default '') returns public.schedules language plpgsql security definer set search_path='' as $$
declare u public.units;s public.schedules;v record;begin
 if not private.can_manage(p_unit) then raise exception 'Sem permissão para alterar a escala.';end if;
 if jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries)>2000 then raise exception 'Escala inválida.';end if;
 select * into u from public.units where id=p_unit for update;
 if u.revision is distinct from p_unit_revision then raise exception 'A configuração mudou. Recarregue antes de salvar.' using errcode='40001';end if;
 select * into s from public.schedules where unit_id=p_unit and week_start=p_week for update;
 if s.id is null then
  if p_revision is distinct from 0 then raise exception 'A escala mudou. Recarregue.' using errcode='40001';end if;
  insert into public.schedules(unit_id,week_start,updated_by) values(p_unit,p_week,auth.uid()) returning * into s;
 else
  if s.revision is distinct from p_revision then raise exception 'Outra pessoa atualizou a escala. Recarregue.' using errcode='40001';end if;
  if s.status='published' then raise exception 'Abra uma revisão antes de alterar a versão publicada.';end if;
  update public.schedules set revision=revision+1,updated_at=now(),updated_by=auth.uid() where id=s.id returning * into s;
 end if;
 for v in select * from jsonb_to_recordset(p_entries) as x(assignment_id uuid,person_id uuid,work_date date,kind text,sector_id uuid,role_id uuid,start_time time,end_time time,break_start time,break_end time,locked boolean) loop
  if v.work_date<p_week or v.work_date>p_week+6 or not exists(select 1 from public.unit_assignments a where a.id=v.assignment_id and a.unit_id=p_unit and a.person_id=v.person_id) then raise exception 'Pessoa, unidade ou data inválida na escala.';end if;
 end loop;
 delete from public.schedule_entries where schedule_id=s.id;
 insert into public.schedule_entries(schedule_id,unit_id,network_id,assignment_id,person_id,work_date,kind,sector_id,role_id,start_time,end_time,break_start,break_end,locked)
 select s.id,p_unit,u.network_id,x.assignment_id,x.person_id,x.work_date,x.kind,x.sector_id,x.role_id,case when x.kind='work' then x.start_time end,case when x.kind='work' then x.end_time end,case when x.kind='work' then x.break_start end,case when x.kind='work' then x.break_end end,coalesce(x.locked,false)
 from jsonb_to_recordset(p_entries) as x(assignment_id uuid,person_id uuid,work_date date,kind text,sector_id uuid,role_id uuid,start_time time,end_time time,break_start time,break_end time,locked boolean);
 insert into public.audit_events(network_id,unit_id,actor_id,entity,action,record_id,details) values(u.network_id,p_unit,auth.uid(),'schedules','save',s.id::text,jsonb_build_object('reason',left(p_reason,500),'revision',s.revision));
 return s;
end $$;

create or replace function private.revise_schedule(p_schedule uuid,p_revision integer,p_reason text) returns public.schedules language plpgsql security definer set search_path='' as $$
declare s public.schedules;n uuid;begin
 select * into s from public.schedules where id=p_schedule for update;
 if not private.can_manage(s.unit_id) then raise exception 'Sem permissão para revisar.';end if;
 if s.revision is distinct from p_revision then raise exception 'Escala alterada. Recarregue.' using errcode='40001';end if;
 if s.status<>'published' or coalesce(length(trim(p_reason)),0)<3 then raise exception 'Informe o motivo da revisão da escala publicada.';end if;
 update public.schedules set status='draft',revision=revision+1,updated_at=now(),updated_by=auth.uid() where id=s.id returning * into s;
 select network_id into n from public.units where id=s.unit_id;
 insert into public.audit_events(network_id,unit_id,actor_id,entity,action,record_id,details) values(n,s.unit_id,auth.uid(),'schedules','revise',s.id::text,jsonb_build_object('reason',left(p_reason,500)));
 return s;
end $$;

create or replace function private.mutate_configuration(p_unit uuid,p_revision integer,p_table text,p_record jsonb,p_delete boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.units;r jsonb;rid uuid;cols text;sets text;predicate text;col text;network_table boolean;begin
 if not private.can_manage(p_unit) then raise exception 'Sem permissão para manter os dados desta unidade.';end if;
 if p_table<>all(array['units','sectors','job_roles','people','shift_templates','unit_assignments','qualifications','absences','coverage_requirements','vacancies','scenarios']) then raise exception 'Cadastro inválido.';end if;
 if jsonb_typeof(p_record)<>'object' then raise exception 'Dados inválidos.';end if;
 select * into u from public.units where id=p_unit for update;
 if u.revision is distinct from p_revision then raise exception 'Outra pessoa atualizou a configuração. Recarregue antes de salvar.' using errcode='40001';end if;
 rid=nullif(p_record->>'id','')::uuid;
 r=p_record-'id'-'network_id'-'unit_id'-'revision'-'created_at'-'created_by';
 if p_table in ('people','job_roles') then
  if p_table='people' then
   if rid is null or not exists(select 1 from public.unit_assignments where person_id=rid and unit_id=p_unit) or not private.can_manage_person(rid) then raise exception 'Pessoa sem autorização de manutenção.';end if;
  elsif rid is not null and not private.is_owner(u.network_id) then raise exception 'Apenas o administrador pode renomear funções da rede.';end if;
  predicate='id=$2 and network_id=$3';r=r||jsonb_build_object('network_id',u.network_id);
 elsif p_table='units' then
  if rid is distinct from p_unit or p_delete then raise exception 'Unidade inválida.';end if;
  r=r-'code'-'active';predicate='id=$2 and id=$3';
 else
  predicate='id=$2 and unit_id=$3';r=r||jsonb_build_object('unit_id',p_unit);
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name=p_table and column_name='network_id') then r=r||jsonb_build_object('network_id',u.network_id);end if;
 end if;
 if p_table='unit_assignments' then
  if rid is null then raise exception 'Cadastre a pessoa pelo fluxo da equipe.';end if;
  r=r-'person_id';
 end if;
 if p_delete then
  if p_table not in ('qualifications','absences','coverage_requirements','vacancies','scenarios') then raise exception 'Use a desativação para preservar o histórico.';end if;
  execute format('delete from public.%I t where %s returning to_jsonb(t)',p_table,predicate) into r using r,rid,p_unit;
 else
  select string_agg(format('%I',key),','),string_agg(format('%1$I=x.%1$I',key),',') into cols,sets from jsonb_object_keys(r) key
  where key in(select column_name from information_schema.columns where table_schema='public' and table_name=p_table);
  if cols is null then raise exception 'Nenhum campo válido para salvar.';end if;
  if rid is null then
   execute format('insert into public.%1$I(%2$s) select %2$s from jsonb_populate_record(null::public.%1$I,$1) returning to_jsonb(%1$I)',p_table,cols) into r using r;
  else
   execute format('update public.%1$I t set %2$s from jsonb_populate_record(null::public.%1$I,$1) x where t.%3$s returning to_jsonb(t)',p_table,sets,replace(predicate,' and ',' and t.')) into r using r,rid,case when p_table in('people','job_roles') then u.network_id else p_unit end;
  end if;
 end if;
 if r is null then raise exception 'Registro não encontrado nesta unidade.';end if;
 if p_table='job_roles' then update public.units set revision=revision where network_id=u.network_id;end if;
 return r;
end $$;

create or replace function private.publish_schedule(p_schedule uuid,p_revision integer,p_unit_revision integer,p_ack_warnings boolean) returns integer language plpgsql security definer set search_path='' as $$
declare s public.schedules;u public.units;issues jsonb;v integer;begin
 select * into s from public.schedules where id=p_schedule;
 if s.id is null or not private.can_manage(s.unit_id) then raise exception 'Sem permissão para publicar.';end if;
 select * into u from public.units where id=s.unit_id for update;
 select * into s from public.schedules where id=p_schedule for update;
 if s.revision is distinct from p_revision or u.revision is distinct from p_unit_revision then raise exception 'Dados alterados. Recarregue e revise novamente.' using errcode='40001';end if;
 if s.status<>'draft' then raise exception 'A escala já está publicada.';end if;
 perform 1 from public.people p where p.id in(select person_id from public.schedule_entries where schedule_id=s.id) order by p.id for update;
 issues=private.schedule_issues(s.id);
 if exists(select 1 from jsonb_array_elements(issues) i where i->>'level'='block') then raise exception 'Existem impedimentos a corrigir antes de publicar.';end if;
 if jsonb_array_length(issues)>0 and p_ack_warnings is not true then raise exception 'Revise e confirme os avisos antes de publicar.';end if;
 v=s.published_version+1;
 insert into public.published_schedules(schedule_id,unit_id,version,published_by,snapshot) values(s.id,s.unit_id,v,auth.uid(),jsonb_build_object(
 'unit',to_jsonb(u),'issues',issues,'entries',coalesce((select jsonb_agg(to_jsonb(e)) from public.schedule_entries e where schedule_id=s.id),'[]'),
 'requirements',coalesce((select jsonb_agg(to_jsonb(r)) from public.coverage_requirements r where unit_id=s.unit_id),'[]'),
 'people',coalesce((select jsonb_agg(to_jsonb(p)) from public.people p where p.id in(select person_id from public.schedule_entries where schedule_id=s.id)),'[]'),
 'assignments',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('person',to_jsonb(p))) from public.unit_assignments a join public.people p on p.id=a.person_id where a.unit_id=s.unit_id),'[]'),
 'qualifications',coalesce((select jsonb_agg(to_jsonb(q)) from public.qualifications q where q.unit_id=s.unit_id),'[]'),
 'absences',coalesce((select jsonb_agg(to_jsonb(a)) from public.absences a where a.unit_id=s.unit_id),'[]'),
 'sectors',coalesce((select jsonb_agg(to_jsonb(x)) from public.sectors x where unit_id=s.unit_id),'[]'),
 'roles',coalesce((select jsonb_agg(to_jsonb(x)) from public.job_roles x where network_id=u.network_id),'[]')));
 update public.schedules set status='published',published_version=v,revision=revision+1,updated_at=now(),updated_by=auth.uid() where id=s.id;
 insert into public.audit_events(network_id,unit_id,actor_id,entity,action,record_id,details) values(u.network_id,s.unit_id,auth.uid(),'schedules','publish',s.id::text,jsonb_build_object('version',v));
 return v;
end $$;

create or replace function private.save_employee(p_unit uuid,p_revision integer,p_assignment uuid,p_person jsonb,p_details jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare u public.units;a public.unit_assignments;rid uuid;v integer;begin
 if not private.can_manage(p_unit) then raise exception 'Sem permissão para manter a equipe.';end if;
 select * into u from public.units where id=p_unit for update;
 if u.revision is distinct from p_revision then raise exception 'Outra pessoa atualizou os dados. Recarregue.' using errcode='40001';end if;
 if jsonb_typeof(p_person)<>'object' or jsonb_typeof(p_details)<>'object' then raise exception 'Dados inválidos.';end if;
 if p_assignment is null then
  select private.add_person(p_unit,p_person->>'name',p_person->>'external_id',(p_person->>'weekly_hours')::numeric,(p_details->>'sector_id')::uuid,(p_details->>'role_id')::uuid,array(select jsonb_array_elements_text(p_details->'weekdays')::int),(p_details->>'preferred_shift_id')::uuid,coalesce((p_person->>'contract_confirmed')::boolean,false)) into rid;
 else
  select * into a from public.unit_assignments where id=p_assignment and unit_id=p_unit;
  if a.id is null or not private.can_manage_person(a.person_id) then raise exception 'Sem permissão para editar os dados compartilhados desta pessoa.';end if;
  rid=a.id;
  perform private.mutate_configuration(p_unit,p_revision,'people',jsonb_build_object('id',a.person_id,'name',p_person->>'name','external_id',nullif(trim(p_person->>'external_id'),''),'weekly_hours',(p_person->>'weekly_hours')::numeric,'contract_confirmed',coalesce((p_person->>'contract_confirmed')::boolean,false)),false);
 end if;
 select revision into v from public.units where id=p_unit;
 perform private.mutate_configuration(p_unit,v,'unit_assignments',(p_details-'person_id')||jsonb_build_object('id',rid),false);
 return rid;
end $$;