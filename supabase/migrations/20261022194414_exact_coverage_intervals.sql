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
 for e in select en.*,ja.weekdays,ja.starts_on,ja.ends_on,ja.active assignment_active,p.active person_active from public.schedule_entries en join public.unit_assignments ja on ja.id=en.assignment_id join public.people p on p.id=en.person_id where en.schedule_id=s.id and en.kind='work' loop
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
    with points as (
     select r.start_time boundary union select r.end_time
     union select v.boundary from public.schedule_entries en cross join lateral (values(en.start_time),(en.end_time),(en.break_start),(en.break_end)) v(boundary)
     where en.schedule_id=s.id and en.work_date=d and en.kind='work' and en.sector_id=r.sector_id and (r.role_id is null or en.role_id=r.role_id) and v.boundary>r.start_time and v.boundary<r.end_time
    ), segments as (select boundary slot_start,lead(boundary) over(order by boundary) slot_end from points), counts as (
     select z.slot_start,count(distinct en.person_id) c from segments z
     left join public.schedule_entries en on en.schedule_id=s.id and en.work_date=d and en.kind='work' and en.sector_id=r.sector_id and (r.role_id is null or en.role_id=r.role_id) and en.start_time<=z.slot_start and en.end_time>=z.slot_end and not(en.break_start<z.slot_end and en.break_end>z.slot_start)
     and (r.mode<>'opening' or exists(select 1 from public.unit_assignments x where x.id=en.assignment_id and x.can_open))
     where z.slot_end is not null group by z.slot_start
    ) select coalesce(min(c),0) into qty from counts;
   end if;
   if qty<r.minimum then issues=issues||jsonb_build_array(jsonb_build_object('code','coverage','level',case when r.blocking and r.confirmed then 'block' else 'warning' end,'date',d,'requirementId',r.id,'message','Cobertura abaixo do mínimo','detail',qty||' / '||r.minimum,'provisional',not r.confirmed));end if;
  end loop;
 end loop;
 if not coalesce((u.settings->>'policyReviewed')::boolean,false) then issues=issues||jsonb_build_array(jsonb_build_object('code','policy_review','level','warning','message','Perfil de jornada ainda não revisado com as regras aplicáveis'));end if;
 if not coalesce((u.settings->>'operationConfirmed')::boolean,false) then issues=issues||jsonb_build_array(jsonb_build_object('code','operation_review','level','warning','message','Horários iniciais da operação a revisar'));end if;
 return issues;
end $$;
