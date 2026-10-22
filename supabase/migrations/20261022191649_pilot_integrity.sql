-- Integrity, atomic employee maintenance and shared-person validation.
drop policy network_read on public.networks;
create policy network_read on public.networks for select to authenticated using(exists(select 1 from public.memberships m where m.network_id=networks.id and m.user_id=(select auth.uid()) and m.active));
-- All writes go through authorized, revision-checked operations. Prevent API bypasses.
revoke insert,update,delete on public.sectors,public.shift_templates,public.unit_assignments,public.qualifications,public.absences,public.coverage_requirements,public.vacancies,public.scenarios,public.people,public.job_roles,public.access_invites,public.memberships,public.units from authenticated;
create function private.validate_settings() returns trigger language plpgsql set search_path='' as $$
declare p jsonb;d jsonb;i integer;begin
 p=new.settings->'policy';
 if p is null or jsonb_typeof(p)<>'object' or (p->>'weeklyHours') is null or (p->>'dailyHours') is null or (p->>'restHours') is null or (p->>'maxWorkDays') is null or (p->>'maxConsecutive') is null
 or (p->>'weeklyHours')::numeric not between 1 and 44 or (p->>'dailyHours')::numeric not between 1 and 12 or (p->>'restHours')::int not between 11 and 48 or (p->>'maxWorkDays')::int not between 1 and 6 or (p->>'maxConsecutive')::int not between 1 and 6 then raise exception 'Informe um perfil de planejamento válido.';end if;
 for i in 0..6 loop
  d=new.settings->'opening'->i::text;
  if d is null or (d->>'open') is null or (d->>'close') is null or (d->>'open')::time >= (d->>'close')::time then raise exception 'Informe abertura anterior ao fechamento em todos os dias.';end if;
 end loop;
 return new;
end $$;
create trigger validate_settings before insert or update of settings on public.units for each row execute function private.validate_settings();
revoke all on function private.validate_settings() from public,anon,authenticated;

create function private.save_employee(p_unit uuid,p_revision integer,p_assignment uuid,p_person jsonb,p_details jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare u public.units;a public.unit_assignments;rid uuid;v integer;begin
 if not private.can_manage(p_unit) then raise exception 'Sem permissão para manter a equipe.';end if;
 select * into u from public.units where id=p_unit for update;
 if u.revision<>p_revision then raise exception 'Outra pessoa atualizou os dados. Recarregue.' using errcode='40001';end if;
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
create function public.save_employee(p_unit uuid,p_revision integer,p_assignment uuid,p_person jsonb,p_details jsonb) returns uuid language sql security invoker set search_path='' as $$ select private.save_employee(p_unit,p_revision,p_assignment,p_person,p_details); $$;
revoke all on function private.save_employee(uuid,integer,uuid,jsonb,jsonb),public.save_employee(uuid,integer,uuid,jsonb,jsonb) from public,anon;
grant execute on function private.save_employee(uuid,integer,uuid,jsonb,jsonb),public.save_employee(uuid,integer,uuid,jsonb,jsonb) to authenticated;

-- Keep the last published commitment while a different draft is being revised.
-- This helper is callable only by database-owned validators, never by API clients.
create function private.commitments(p_schedule uuid) returns setof public.schedule_entries language sql stable set search_path='' as $$
 select e.* from public.schedule_entries e
 union
 select x.* from public.schedules s join public.published_schedules p on p.schedule_id=s.id and p.version=s.published_version
 cross join lateral jsonb_populate_recordset(null::public.schedule_entries,p.snapshot->'entries') x
 where s.status='draft' and s.published_version>0 and s.id<>p_schedule;
$$;
revoke all on function private.commitments(uuid) from public,anon,authenticated;

create or replace function private.rule_applies(r public.coverage_requirements,d date) returns boolean language sql stable set search_path='' as $$
 select d>=r.effective_from and (r.effective_until is null or d<=r.effective_until) and (case when r.on_date is not null then r.on_date=d else (extract(isodow from d)::int-1)=any(r.weekdays) end)
 and not exists(select 1 from public.coverage_requirements x where x.overrides_id=r.id and x.unit_id=r.unit_id and x.on_date=d and d>=x.effective_from and (x.effective_until is null or d<=x.effective_until));
$$;

create or replace function private.schedule_issues(p_schedule uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.schedules; u public.units; a record; e record; r public.coverage_requirements; d date; slot time; qty integer; hrs numeric; wd integer; max_week numeric; issues jsonb='[]'; pol jsonb; rest numeric; previous_end timestamp; span_start timestamp; span_end timestamp; seq integer;future_seq integer;begin
 select * into s from public.schedules where id=p_schedule;
 if s.id is null or not private.can_read(s.unit_id) then raise exception 'Escala não encontrada ou acesso negado.';end if;
 select * into u from public.units where id=s.unit_id;pol=coalesce(u.settings->'policy','{}');
 for a in select x.*,p.weekly_hours,p.active person_active,p.contract_confirmed from public.unit_assignments x join public.people p on p.id=x.person_id where x.unit_id=s.unit_id and x.active and x.starts_on<=s.week_start+6 and (x.ends_on is null or x.ends_on>=s.week_start) loop
  select coalesce(sum(hours),0),count(distinct work_date) into hrs,wd from (select schedule_id,work_date,max(extract(epoch from ((end_time-start_time)-(break_end-break_start)))/3600) hours from private.commitments(p_schedule) where person_id=a.person_id and work_date between s.week_start and s.week_start+6 and kind='work' group by schedule_id,work_date) totals;
  max_week=least(a.weekly_hours,coalesce((pol->>'weeklyHours')::numeric,40));
  if hrs>max_week then issues=issues||jsonb_build_array(jsonb_build_object('code','weekly','level','block','personId',a.person_id,'message','Carga semanal excedida','detail',hrs||'h / '||max_week||'h'));end if;
  if wd>coalesce((pol->>'maxWorkDays')::int,5) then issues=issues||jsonb_build_array(jsonb_build_object('code','days','level','block','personId',a.person_id,'message','Dias de trabalho acima do perfil configurado'));end if;
  if not a.contract_confirmed then issues=issues||jsonb_build_array(jsonb_build_object('code','contract','level','warning','personId',a.person_id,'message','Jornada contratual ainda não confirmada'));end if;
  for d in select generate_series(s.week_start::timestamp,(s.week_start+6)::timestamp,'1 day')::date loop
   if d<a.starts_on or (a.ends_on is not null and d>a.ends_on) then continue;end if;
   if not exists(select 1 from public.schedule_entries where schedule_id=s.id and assignment_id=a.id and work_date=d) then issues=issues||jsonb_build_array(jsonb_build_object('code','missing','level','block','personId',a.person_id,'date',d,'message','Dia sem turno, folga ou ausência'));end if;
  end loop;
 end loop;
 for e in select en.*,a.weekdays,a.starts_on,a.ends_on,a.active assignment_active,p.active person_active from public.schedule_entries en join public.unit_assignments a on a.id=en.assignment_id join public.people p on p.id=en.person_id where en.schedule_id=s.id and en.kind='work' loop
  if not e.assignment_active or not e.person_active or e.work_date<e.starts_on or (e.ends_on is not null and e.work_date>e.ends_on) then issues=issues||jsonb_build_array(jsonb_build_object('code','inactive','level','block','personId',e.person_id,'date',e.work_date,'message','Pessoa ou vínculo indisponível'));end if;
  if not (extract(isodow from e.work_date)::int-1)=any(e.weekdays) then issues=issues||jsonb_build_array(jsonb_build_object('code','availability','level','block','personId',e.person_id,'date',e.work_date,'message','Dia fora da disponibilidade cadastrada'));end if;
  if exists(select 1 from public.absences x where x.assignment_id=e.assignment_id and e.work_date between x.starts_on and x.ends_on) then issues=issues||jsonb_build_array(jsonb_build_object('code','absence','level','block','personId',e.person_id,'date',e.work_date,'message','Conflito com ausência'));end if;
  if not exists(select 1 from public.unit_assignments x where x.id=e.assignment_id and x.sector_id=e.sector_id and x.role_id=e.role_id) and not exists(select 1 from public.qualifications q where q.assignment_id=e.assignment_id and q.sector_id=e.sector_id and q.role_id=e.role_id and (q.valid_until is null or q.valid_until>=e.work_date)) then issues=issues||jsonb_build_array(jsonb_build_object('code','skill','level','block','personId',e.person_id,'date',e.work_date,'message','Função não habilitada'));end if;
  hrs=extract(epoch from ((e.end_time-e.start_time)-(e.break_end-e.break_start)))/3600;
  if hrs>coalesce((pol->>'dailyHours')::numeric,8) then issues=issues||jsonb_build_array(jsonb_build_object('code','daily','level','block','personId',e.person_id,'date',e.work_date,'message','Jornada diária acima do perfil'));end if;
  if extract(epoch from e.break_end-e.break_start)/60 < (case when hrs>6 then 60 when hrs>4 then 15 else 0 end) then issues=issues||jsonb_build_array(jsonb_build_object('code','break','level','block','personId',e.person_id,'date',e.work_date,'message','Intervalo insuficiente no perfil'));end if;
  span_start=e.work_date+e.start_time;span_end=e.work_date+e.end_time;
  if exists(select 1 from private.commitments(p_schedule) x where x.person_id=e.person_id and x.id<>e.id and x.kind='work' and x.work_date+x.start_time<span_end and x.work_date+x.end_time>span_start) then issues=issues||jsonb_build_array(jsonb_build_object('code','overlap','level','block','personId',e.person_id,'date',e.work_date,'message','Jornadas sobrepostas, inclusive entre unidades'));end if;
  if exists(select 1 from private.commitments(p_schedule) x where x.person_id=e.person_id and x.id<>e.id and x.kind='work' and ((x.work_date+x.end_time<=span_start and span_start-(x.work_date+x.end_time)<make_interval(hours=>coalesce((pol->>'restHours')::int,11))) or (x.work_date+x.start_time>=span_end and (x.work_date+x.start_time)-span_end<make_interval(hours=>coalesce((pol->>'restHours')::int,11))))) then issues=issues||jsonb_build_array(jsonb_build_object('code','rest','level','block','personId',e.person_id,'date',e.work_date,'message','Descanso insuficiente entre jornadas'));end if;
  seq=1;
  while exists(select 1 from private.commitments(p_schedule) x where x.person_id=e.person_id and x.kind='work' and x.work_date=e.work_date-seq) loop seq=seq+1;exit when seq>14;end loop;
  future_seq=1;while exists(select 1 from private.commitments(p_schedule) x where x.person_id=e.person_id and x.kind='work' and x.work_date=e.work_date+future_seq) loop future_seq=future_seq+1;exit when future_seq>14;end loop;
  if seq+future_seq-1>coalesce((pol->>'maxConsecutive')::int,5) then issues=issues||jsonb_build_array(jsonb_build_object('code','sequence','level','block','personId',e.person_id,'date',e.work_date,'message','Sequência de trabalho excedida'));end if;
 end loop;
 for r in select * from public.coverage_requirements where unit_id=s.unit_id loop
  for d in select generate_series(s.week_start::timestamp,(s.week_start+6)::timestamp,'1 day')::date loop
   if not private.rule_applies(r,d) then continue;end if;
   if r.mode='daily' then
    select count(distinct en.person_id) into qty from public.schedule_entries en where en.schedule_id=s.id and en.work_date=d and en.kind='work' and en.sector_id=r.sector_id and (r.role_id is null or en.role_id=r.role_id);
   else
    select coalesce(min(c),0) into qty from (
     select count(distinct en.person_id) c from generate_series((d+r.start_time)::timestamp,(d+r.end_time)::timestamp-interval '1 microsecond',interval '30 min') t
     left join public.schedule_entries en on en.schedule_id=s.id and en.work_date=d and en.kind='work' and en.sector_id=r.sector_id and (r.role_id is null or en.role_id=r.role_id) and en.start_time<=t::time and en.end_time>= least(t+interval '30 min',d+r.end_time)::time and not (en.break_start<least(t+interval '30 min',d+r.end_time)::time and en.break_end>t::time)
     and (r.mode<>'opening' or exists(select 1 from public.unit_assignments x where x.id=en.assignment_id and x.can_open)) group by t
    ) q;
   end if;
   if qty<r.minimum then issues=issues||jsonb_build_array(jsonb_build_object('code','coverage','level',case when r.blocking and r.confirmed then 'block' else 'warning' end,'date',d,'requirementId',r.id,'message','Cobertura abaixo do mínimo','detail',qty||' / '||r.minimum,'provisional',not r.confirmed));end if;
  end loop;
 end loop;
 if not coalesce((u.settings->>'policyReviewed')::boolean,false) then issues=issues||jsonb_build_array(jsonb_build_object('code','policy_review','level','warning','message','Perfil de jornada ainda não revisado com as regras aplicáveis'));end if;
 if not coalesce((u.settings->>'operationConfirmed')::boolean,false) then issues=issues||jsonb_build_array(jsonb_build_object('code','operation_review','level','warning','message','Horários iniciais da operação a revisar'));end if;
 return issues;
end $$;

create or replace function private.publish_schedule(p_schedule uuid,p_revision integer,p_unit_revision integer,p_ack_warnings boolean) returns integer language plpgsql security definer set search_path='' as $$
declare s public.schedules;u public.units;issues jsonb;v integer;begin
 select * into s from public.schedules where id=p_schedule;
 if s.id is null or not private.can_manage(s.unit_id) then raise exception 'Sem permissão para publicar.';end if;
 select * into u from public.units where id=s.unit_id for update;
 select * into s from public.schedules where id=p_schedule for update;
 if s.revision<>p_revision or u.revision<>p_unit_revision then raise exception 'Dados alterados. Recarregue e revise novamente.' using errcode='40001';end if;
 if s.status<>'draft' then raise exception 'A escala já está publicada.';end if;
 perform 1 from public.people p where p.id in(select person_id from public.schedule_entries where schedule_id=s.id) order by p.id for update;
 issues=private.schedule_issues(s.id);
 if exists(select 1 from jsonb_array_elements(issues) i where i->>'level'='block') then raise exception 'Existem impedimentos a corrigir antes de publicar.';end if;
 if jsonb_array_length(issues)>0 and not p_ack_warnings then raise exception 'Revise e confirme os avisos antes de publicar.';end if;
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
