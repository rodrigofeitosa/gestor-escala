-- Pilot schema. Operational data and access emails are deliberately not seeded here.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table public.networks (
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 120), created_at timestamptz not null default now()
);
create table public.units (
 id uuid primary key default gen_random_uuid(), network_id uuid not null references public.networks(id),
 name text not null check(length(name) between 1 and 120), code text not null, timezone text not null default 'America/Sao_Paulo',
 settings jsonb not null default '{}', revision integer not null default 1, active boolean not null default true,
 unique(network_id,code), unique(id,network_id)
);
create table public.memberships (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id), network_id uuid not null references public.networks(id),
 unit_id uuid, role text not null check(role in ('owner','manager','viewer')), active boolean not null default true,
 foreign key(unit_id,network_id) references public.units(id,network_id), check(role='owner' or unit_id is not null),
 unique nulls not distinct(user_id,network_id,unit_id)
);
create table public.access_invites (
 id uuid primary key default gen_random_uuid(), network_id uuid not null references public.networks(id), unit_id uuid,
 email text not null check(email=lower(trim(email)) and position('@' in email)>1), role text not null check(role in ('owner','manager','viewer')),
 created_at timestamptz not null default now(), accepted_at timestamptz, revoked boolean not null default false,
 foreign key(unit_id,network_id) references public.units(id,network_id), check(role='owner' or unit_id is not null),
 unique nulls not distinct(network_id,unit_id,email)
);
create table public.sectors (
 id uuid primary key default gen_random_uuid(), unit_id uuid not null references public.units(id), name text not null check(length(name) between 1 and 100),
 active boolean not null default true, unique(unit_id,name), unique(id,unit_id)
);
create table public.job_roles (
 id uuid primary key default gen_random_uuid(), network_id uuid not null references public.networks(id), name text not null check(length(name) between 1 and 100), unique(network_id,name), unique(id,network_id)
);
create table public.people (
 id uuid primary key default gen_random_uuid(), network_id uuid not null references public.networks(id),
 name text not null check(length(trim(name)) between 1 and 100), external_id text check(length(external_id)<=40),
 weekly_hours numeric not null default 40 check(weekly_hours>0 and weekly_hours<=44), active boolean not null default true,
 contract_confirmed boolean not null default false, notes text not null default '' check(length(notes)<=1500),
 unique(network_id,external_id), unique(id,network_id)
);
create table public.shift_templates (
 id uuid primary key default gen_random_uuid(), unit_id uuid not null references public.units(id), name text not null,
 start_time time not null, end_time time not null, break_start time not null, break_end time not null, active boolean not null default true,
 check(start_time<break_start and break_start<break_end and break_end<end_time), unique(id,unit_id), unique(unit_id,name)
);
create table public.unit_assignments (
 id uuid primary key default gen_random_uuid(), unit_id uuid not null, network_id uuid not null,
 person_id uuid not null, sector_id uuid not null, role_id uuid not null, preferred_shift_id uuid,
 weekdays integer[] not null default array[0,1,2,3,4,5,6], scheduling_mode text not null default 'variable' check(scheduling_mode in ('variable','fixed')),
 can_open boolean not null default false, active boolean not null default true, notes text not null default '' check(length(notes)<=1500),
 starts_on date not null default current_date, ends_on date,
 foreign key(unit_id,network_id) references public.units(id,network_id), foreign key(person_id,network_id) references public.people(id,network_id),
 foreign key(role_id,network_id) references public.job_roles(id,network_id), foreign key(sector_id,unit_id) references public.sectors(id,unit_id),
 foreign key(preferred_shift_id,unit_id) references public.shift_templates(id,unit_id),
 check(weekdays<@array[0,1,2,3,4,5,6]), check(ends_on is null or ends_on>=starts_on), unique(unit_id,person_id), unique(id,unit_id)
);
create table public.qualifications (
 id uuid primary key default gen_random_uuid(), unit_id uuid not null references public.units(id), assignment_id uuid not null,
 network_id uuid not null, sector_id uuid not null, role_id uuid not null, valid_until date,
 foreign key(unit_id,network_id) references public.units(id,network_id), foreign key(assignment_id,unit_id) references public.unit_assignments(id,unit_id),
 foreign key(sector_id,unit_id) references public.sectors(id,unit_id), foreign key(role_id,network_id) references public.job_roles(id,network_id), unique(assignment_id,sector_id,role_id)
);
create table public.absences (
 id uuid primary key default gen_random_uuid(), unit_id uuid not null references public.units(id), assignment_id uuid not null,
 starts_on date not null, ends_on date not null, kind text not null default 'Indisponibilidade' check(length(kind)<=100),
 foreign key(assignment_id,unit_id) references public.unit_assignments(id,unit_id), check(ends_on>=starts_on)
);
create table public.coverage_requirements (
 id uuid primary key default gen_random_uuid(), unit_id uuid not null, network_id uuid not null, sector_id uuid not null, role_id uuid,
 weekdays integer[] not null default array[5,6], on_date date, overrides_id uuid references public.coverage_requirements(id),
 mode text not null default 'daily' check(mode in ('daily','simultaneous','opening')), minimum integer not null check(minimum between 0 and 100),
 start_time time, end_time time, confirmed boolean not null default false, blocking boolean not null default false,
 effective_from date not null default current_date, effective_until date,
 source_note text not null default '' check(length(source_note)<=1500), review_note text not null default '' check(length(review_note)<=1500),
 foreign key(unit_id,network_id) references public.units(id,network_id), foreign key(sector_id,unit_id) references public.sectors(id,unit_id),
 foreign key(role_id,network_id) references public.job_roles(id,network_id),
 check(weekdays<@array[0,1,2,3,4,5,6]), check(mode='daily' or (start_time is not null and end_time is not null and end_time>start_time)),
 check(effective_until is null or effective_until>=effective_from), check(overrides_id is null or on_date is not null)
);
create table public.vacancies (
 id uuid primary key default gen_random_uuid(), unit_id uuid not null, network_id uuid not null, sector_id uuid not null, role_id uuid not null,
 quantity integer not null default 1 check(quantity between 1 and 100), status text not null default 'open' check(status in ('open','filled','cancelled')),
 notes text not null default '' check(length(notes)<=1500),
 foreign key(unit_id,network_id) references public.units(id,network_id), foreign key(sector_id,unit_id) references public.sectors(id,unit_id), foreign key(role_id,network_id) references public.job_roles(id,network_id)
);
create table public.schedules (
 id uuid primary key default gen_random_uuid(), unit_id uuid not null references public.units(id), week_start date not null,
 status text not null default 'draft' check(status in ('draft','published')), revision integer not null default 1, published_version integer not null default 0,
 updated_at timestamptz not null default now(), updated_by uuid references auth.users(id),
 check(extract(isodow from week_start)=1), unique(unit_id,week_start), unique(id,unit_id)
);
create table public.schedule_entries (
 id uuid primary key default gen_random_uuid(), schedule_id uuid not null, unit_id uuid not null, network_id uuid not null,
 assignment_id uuid not null, person_id uuid not null, work_date date not null, kind text not null check(kind in ('work','off','absence')),
 sector_id uuid not null, role_id uuid not null, start_time time, end_time time, break_start time, break_end time, locked boolean not null default false,
 foreign key(schedule_id,unit_id) references public.schedules(id,unit_id), foreign key(unit_id,network_id) references public.units(id,network_id),
 foreign key(assignment_id,unit_id) references public.unit_assignments(id,unit_id), foreign key(person_id,network_id) references public.people(id,network_id),
 foreign key(sector_id,unit_id) references public.sectors(id,unit_id), foreign key(role_id,network_id) references public.job_roles(id,network_id),
 check(kind<>'work' or (start_time is not null and end_time>start_time and break_start>start_time and break_end>break_start and break_end<end_time)),
 unique(schedule_id,person_id,work_date)
);
create table public.published_schedules (
 id uuid primary key default gen_random_uuid(), schedule_id uuid not null, unit_id uuid not null, version integer not null,
 snapshot jsonb not null, published_at timestamptz not null default now(), published_by uuid not null references auth.users(id),
 foreign key(schedule_id,unit_id) references public.schedules(id,unit_id), unique(schedule_id,version)
);
create table public.scenarios (
 id uuid primary key default gen_random_uuid(), unit_id uuid not null references public.units(id), name text not null check(length(name) between 1 and 100),
 proposal jsonb not null default '[]', created_at timestamptz not null default now(), created_by uuid references auth.users(id)
);
create table public.audit_events (
 id bigint generated always as identity primary key, network_id uuid not null references public.networks(id), unit_id uuid,
 actor_id uuid references auth.users(id), entity text not null, action text not null, record_id text, details jsonb not null default '{}', created_at timestamptz not null default now(),
 foreign key(unit_id,network_id) references public.units(id,network_id)
);
create table public.import_batches (
 id uuid primary key default gen_random_uuid(), unit_id uuid not null references public.units(id), file_name text not null check(length(file_name)<=200),
 imported_count integer not null check(imported_count>=0), skipped_count integer not null check(skipped_count>=0), created_by uuid references auth.users(id), created_at timestamptz not null default now()
);

create index memberships_user on public.memberships(user_id,network_id,unit_id) where active;
create index invites_email on public.access_invites(email) where not revoked;
create index units_network on public.units(network_id);
create index sectors_unit on public.sectors(unit_id);
create index roles_network on public.job_roles(network_id);
create index people_network on public.people(network_id);
create index assignments_person on public.unit_assignments(person_id);
create index assignments_unit on public.unit_assignments(unit_id,active);
create index qualifications_assignment on public.qualifications(assignment_id);
create index absences_assignment_dates on public.absences(assignment_id,starts_on,ends_on);
create index requirements_unit on public.coverage_requirements(unit_id,effective_from);
create index entries_person_date on public.schedule_entries(person_id,work_date);
create index entries_schedule on public.schedule_entries(schedule_id);
create index events_unit_date on public.audit_events(unit_id,created_at desc);
create index scenarios_unit on public.scenarios(unit_id);
create index imports_unit on public.import_batches(unit_id);

create function private.is_owner(p_network uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.memberships where user_id=(select auth.uid()) and network_id=p_network and role='owner' and active);
$$;
create function private.can_read(p_unit uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.memberships m join public.units u on u.network_id=m.network_id where u.id=p_unit and m.user_id=(select auth.uid()) and m.active and (m.role='owner' or m.unit_id=u.id));
$$;
create function private.can_manage(p_unit uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.memberships m join public.units u on u.network_id=m.network_id where u.id=p_unit and m.user_id=(select auth.uid()) and m.active and (m.role='owner' or (m.unit_id=u.id and m.role='manager')));
$$;
create function private.can_read_person(p_person uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.people p where p.id=p_person and private.is_owner(p.network_id)) or exists(select 1 from public.unit_assignments a where a.person_id=p_person and private.can_read(a.unit_id));
$$;
create function private.can_manage_person(p_person uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.people p where p.id=p_person and private.is_owner(p.network_id)) or
 (exists(select 1 from public.unit_assignments a where a.person_id=p_person and private.can_manage(a.unit_id)) and not exists(select 1 from public.unit_assignments a where a.person_id=p_person and a.active and not private.can_manage(a.unit_id)));
$$;
revoke all on all functions in schema private from public,anon;
grant execute on all functions in schema private to authenticated;

do $$ declare t text; begin
 foreach t in array array['networks','units','memberships','access_invites','sectors','job_roles','people','shift_templates','unit_assignments','qualifications','absences','coverage_requirements','vacancies','schedules','schedule_entries','published_schedules','scenarios','audit_events','import_batches'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 end loop;
end $$;
grant select on public.networks,public.units,public.memberships,public.access_invites,public.sectors,public.job_roles,public.people,public.shift_templates,public.unit_assignments,public.qualifications,public.absences,public.coverage_requirements,public.vacancies,public.schedules,public.schedule_entries,public.published_schedules,public.scenarios,public.audit_events,public.import_batches to authenticated;
grant insert,update,delete on public.sectors,public.shift_templates,public.unit_assignments,public.qualifications,public.absences,public.coverage_requirements,public.vacancies,public.scenarios to authenticated;
grant insert,update on public.people,public.job_roles,public.access_invites,public.memberships to authenticated;
grant update on public.units to authenticated;
create policy network_read on public.networks for select to authenticated using(exists(select 1 from public.memberships m where m.network_id=id and m.user_id=(select auth.uid()) and m.active));
create policy unit_read on public.units for select to authenticated using(private.can_read(id));
create policy unit_update on public.units for update to authenticated using(private.can_manage(id)) with check(private.can_manage(id));
create policy member_read on public.memberships for select to authenticated using(user_id=(select auth.uid()) or private.is_owner(network_id));
create policy member_insert on public.memberships for insert to authenticated with check(private.is_owner(network_id));
create policy member_update on public.memberships for update to authenticated using(private.is_owner(network_id)) with check(private.is_owner(network_id));
create policy invite_owner on public.access_invites for all to authenticated using(private.is_owner(network_id)) with check(private.is_owner(network_id));
create policy role_read on public.job_roles for select to authenticated using(exists(select 1 from public.memberships m where m.network_id=job_roles.network_id and m.user_id=(select auth.uid()) and m.active));
create policy role_insert on public.job_roles for insert to authenticated with check(exists(select 1 from public.memberships m where m.network_id=job_roles.network_id and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','manager')));
create policy role_update on public.job_roles for update to authenticated using(private.is_owner(network_id)) with check(private.is_owner(network_id));
create policy people_read on public.people for select to authenticated using(private.can_read_person(id));
create policy people_update on public.people for update to authenticated using(private.can_manage_person(id)) with check(private.can_manage_person(id));
create policy people_insert on public.people for insert to authenticated with check(private.is_owner(network_id));
do $$ declare t text; begin
 foreach t in array array['sectors','shift_templates','unit_assignments','qualifications','absences','coverage_requirements','vacancies','scenarios'] loop
 execute format('create policy unit_select on public.%I for select to authenticated using(private.can_read(unit_id))',t);
 execute format('create policy unit_insert on public.%I for insert to authenticated with check(private.can_manage(unit_id))',t);
 execute format('create policy unit_update on public.%I for update to authenticated using(private.can_manage(unit_id)) with check(private.can_manage(unit_id))',t);
 execute format('create policy unit_delete on public.%I for delete to authenticated using(private.can_manage(unit_id))',t);
 end loop;
 foreach t in array array['schedules','schedule_entries','published_schedules','audit_events','import_batches'] loop
 execute format('create policy unit_select on public.%I for select to authenticated using(private.can_read(unit_id))',t);
 end loop;
end $$;

-- Reject attempts to change tenancy or overwrite stale configuration, including direct API calls.
create function private.guard_configuration() returns trigger language plpgsql security definer set search_path='' as $$
declare v_unit uuid; v_network uuid; v_revision integer; begin
 if TG_OP='UPDATE' then
  if (to_jsonb(new)->>'unit_id') is distinct from (to_jsonb(old)->>'unit_id') or (to_jsonb(new)->>'network_id') is distinct from (to_jsonb(old)->>'network_id') then raise exception 'Não é permitido transferir registros por edição.'; end if;
  if TG_TABLE_NAME='unit_assignments' and (to_jsonb(new)->>'person_id') is distinct from (to_jsonb(old)->>'person_id') then raise exception 'Vínculo da pessoa não pode ser substituído.'; end if;
 end if;
 if TG_TABLE_NAME='units' then
  if TG_OP='UPDATE' and new.revision<>old.revision then raise exception 'Recarregue os dados antes de salvar.' using errcode='40001'; end if;
  if jsonb_typeof(new.settings)<>'object' then raise exception 'Configuração inválida'; end if;
  new.revision=old.revision+1; return new;
 end if;
 v_unit=coalesce((to_jsonb(new)->>'unit_id')::uuid,(to_jsonb(old)->>'unit_id')::uuid);
 if v_unit is not null then
  perform 1 from public.units where id=v_unit for update;
  update public.units set revision=revision where id=v_unit;
 end if;
 if TG_TABLE_NAME='people' then
  perform 1 from public.units where id in(select unit_id from public.unit_assignments where person_id=coalesce((to_jsonb(new)->>'id')::uuid,(to_jsonb(old)->>'id')::uuid)) order by id for update;
  update public.units set revision=revision where id in(select unit_id from public.unit_assignments where person_id=coalesce((to_jsonb(new)->>'id')::uuid,(to_jsonb(old)->>'id')::uuid));
 end if;
 if TG_TABLE_NAME='coverage_requirements' and TG_OP<>'DELETE' then
  if new.overrides_id is not null and not exists(select 1 from public.coverage_requirements where id=new.overrides_id and unit_id=new.unit_id and overrides_id is null) then raise exception 'A regra substituída deve pertencer à mesma unidade.';end if;
 end if;
 if TG_OP='DELETE' then return old; end if; return new;
end $$;
create trigger config_version before update on public.units for each row execute function private.guard_configuration();
create trigger person_version before update on public.people for each row execute function private.guard_configuration();
create trigger role_tenancy before update on public.job_roles for each row execute function private.guard_configuration();
do $$ declare t text; begin
 foreach t in array array['sectors','shift_templates','unit_assignments','qualifications','absences','coverage_requirements','vacancies','scenarios'] loop
 execute format('create trigger config_change before insert or update or delete on public.%I for each row execute function private.guard_configuration()',t);
 end loop;
end $$;
create function private.audit_change() returns trigger language plpgsql security definer set search_path='' as $$
declare r jsonb; u uuid; n uuid; begin
 r=case when TG_OP='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 u=case when TG_TABLE_NAME='units' then (r->>'id')::uuid else (r->>'unit_id')::uuid end;
 n=(r->>'network_id')::uuid;
 if n is null and u is not null then select network_id into n from public.units where id=u; end if;
 if n is not null then insert into public.audit_events(network_id,unit_id,actor_id,entity,action,record_id) values(n,u,auth.uid(),TG_TABLE_NAME,TG_OP,r->>'id'); end if;
 if TG_OP='DELETE' then return old; end if;return new;
end $$;
do $$ declare t text; begin
 foreach t in array array['units','people','unit_assignments','qualifications','coverage_requirements','shift_templates','absences','vacancies','access_invites','memberships','scenarios'] loop
 execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function private.audit_change()',t);
 end loop;
end $$;

create function private.accept_access() returns integer language plpgsql security definer set search_path='' as $$
declare mail text; accepted integer; begin
 if auth.uid() is null then raise exception 'Entre na sua conta.'; end if;
 select lower(email) into mail from auth.users where id=auth.uid() and email_confirmed_at is not null;
 if mail is null then raise exception 'Confirme seu e-mail para acessar.'; end if;
 with accepted_invites as (
  update public.access_invites set accepted_at=now() where email=mail and not revoked and accepted_at is null returning *
 ), inserted as (
  insert into public.memberships(user_id,network_id,unit_id,role) select auth.uid(),network_id,unit_id,role from accepted_invites
  on conflict(user_id,network_id,unit_id) do update set role=excluded.role, active=true returning 1
 ) select count(*) into accepted from inserted;
 return accepted;
end $$;
create function public.accept_access() returns integer language sql security invoker set search_path='' as $$ select private.accept_access(); $$;

create function private.create_unit(p_network uuid,p_name text,p_code text) returns uuid language plpgsql security definer set search_path='' as $$
declare new_unit uuid; begin
 if not private.is_owner(p_network) then raise exception 'Apenas administradores da rede podem adicionar unidades.';end if;
 insert into public.units(network_id,name,code,settings) values(p_network,trim(p_name),trim(p_code),'{"opening":{"0":{"open":"07:00","close":"21:00"},"1":{"open":"07:00","close":"21:00"},"2":{"open":"07:00","close":"21:00"},"3":{"open":"07:00","close":"21:00"},"4":{"open":"07:00","close":"21:00"},"5":{"open":"07:00","close":"21:00"},"6":{"open":"08:00","close":"20:00"}},"policy":{"weeklyHours":40,"dailyHours":8,"restHours":11,"maxWorkDays":5,"maxConsecutive":5},"operationConfirmed":false,"policyReviewed":false}') returning id into new_unit;
 return new_unit;
end $$;
create function public.create_unit(p_network uuid,p_name text,p_code text) returns uuid language sql security invoker set search_path='' as $$ select private.create_unit(p_network,p_name,p_code); $$;

create function private.add_person(p_unit uuid,p_name text,p_external text,p_hours numeric,p_sector uuid,p_role uuid,p_weekdays integer[],p_shift uuid,p_confirmed boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare n uuid; p uuid; a uuid;begin
 if not private.can_manage(p_unit) then raise exception 'Sem permissão para cadastrar nesta unidade.';end if;
 select network_id into n from public.units where id=p_unit for update;
 if not exists(select 1 from public.sectors where id=p_sector and unit_id=p_unit) or not exists(select 1 from public.job_roles where id=p_role and network_id=n) then raise exception 'Setor ou função inválidos.';end if;
 insert into public.people(network_id,name,external_id,weekly_hours,contract_confirmed) values(n,trim(p_name),nullif(trim(p_external),''),p_hours,p_confirmed) returning id into p;
 insert into public.unit_assignments(unit_id,network_id,person_id,sector_id,role_id,weekdays,preferred_shift_id) values(p_unit,n,p,p_sector,p_role,p_weekdays,p_shift) returning id into a;
 return a;
end $$;
create function public.add_person(p_unit uuid,p_name text,p_external text,p_hours numeric,p_sector uuid,p_role uuid,p_weekdays integer[],p_shift uuid,p_confirmed boolean) returns uuid language sql security invoker set search_path='' as $$ select private.add_person(p_unit,p_name,p_external,p_hours,p_sector,p_role,p_weekdays,p_shift,p_confirmed); $$;

create function private.rule_applies(r public.coverage_requirements,d date) returns boolean language sql stable set search_path='' as $$
 select d>=r.effective_from and (r.effective_until is null or d<=r.effective_until) and (case when r.on_date is not null then r.on_date=d else (extract(isodow from d)::int-1)=any(r.weekdays) end)
 and not exists(select 1 from public.coverage_requirements x where x.overrides_id=r.id and x.unit_id=r.unit_id and x.on_date=d);
$$;

create function private.schedule_issues(p_schedule uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.schedules; u public.units; a record; e record; r public.coverage_requirements; d date; slot time; qty integer; hrs numeric; wd integer; max_week numeric; issues jsonb='[]'; pol jsonb; rest numeric; previous_end timestamp; span_start timestamp; span_end timestamp; seq integer;begin
 select * into s from public.schedules where id=p_schedule;
 if s.id is null or not private.can_read(s.unit_id) then raise exception 'Escala não encontrada ou acesso negado.';end if;
 select * into u from public.units where id=s.unit_id;pol=coalesce(u.settings->'policy','{}');
 for a in select x.*,p.weekly_hours,p.active person_active,p.contract_confirmed from public.unit_assignments x join public.people p on p.id=x.person_id where x.unit_id=s.unit_id and x.active and x.starts_on<=s.week_start+6 and (x.ends_on is null or x.ends_on>=s.week_start) loop
  select coalesce(sum(extract(epoch from ((end_time-start_time)-(break_end-break_start)))/3600),0), count(*) filter(where kind='work') into hrs,wd from public.schedule_entries where schedule_id=s.id and assignment_id=a.id and kind='work';
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
  if exists(select 1 from public.schedule_entries x where x.person_id=e.person_id and x.id<>e.id and x.kind='work' and x.work_date+x.start_time<span_end and x.work_date+x.end_time>span_start) then issues=issues||jsonb_build_array(jsonb_build_object('code','overlap','level','block','personId',e.person_id,'date',e.work_date,'message','Jornadas sobrepostas, inclusive entre unidades'));end if;
  if exists(select 1 from public.schedule_entries x where x.person_id=e.person_id and x.id<>e.id and x.kind='work' and ((x.work_date+x.end_time<=span_start and span_start-(x.work_date+x.end_time)<make_interval(hours=>coalesce((pol->>'restHours')::int,11))) or (x.work_date+x.start_time>=span_end and (x.work_date+x.start_time)-span_end<make_interval(hours=>coalesce((pol->>'restHours')::int,11))))) then issues=issues||jsonb_build_array(jsonb_build_object('code','rest','level','block','personId',e.person_id,'date',e.work_date,'message','Descanso insuficiente entre jornadas'));end if;
  seq=1;
  while exists(select 1 from public.schedule_entries x where x.person_id=e.person_id and x.kind='work' and x.work_date=e.work_date-seq) loop seq=seq+1;exit when seq>14;end loop;
  if seq>coalesce((pol->>'maxConsecutive')::int,5) then issues=issues||jsonb_build_array(jsonb_build_object('code','sequence','level','block','personId',e.person_id,'date',e.work_date,'message','Sequência de trabalho excedida'));end if;
 end loop;
 for r in select * from public.coverage_requirements where unit_id=s.unit_id loop
  for d in select generate_series(s.week_start::timestamp,(s.week_start+6)::timestamp,'1 day')::date loop
   if not private.rule_applies(r,d) then continue;end if;
   if r.mode='daily' then
    select count(distinct en.person_id) into qty from public.schedule_entries en where en.schedule_id=s.id and en.work_date=d and en.kind='work' and en.sector_id=r.sector_id and (r.role_id is null or en.role_id=r.role_id);
   else
    select coalesce(min(c),0) into qty from (
     select count(distinct en.person_id) c from generate_series((d+r.start_time)::timestamp,(d+r.end_time)::timestamp-interval '30 min',interval '30 min') t
     left join public.schedule_entries en on en.schedule_id=s.id and en.work_date=d and en.kind='work' and en.sector_id=r.sector_id and (r.role_id is null or en.role_id=r.role_id) and en.start_time<=t::time and en.end_time>= (t+interval '30 min')::time and not (en.break_start<(t+interval '30 min')::time and en.break_end>t::time)
     and (r.mode<>'opening' or exists(select 1 from public.unit_assignments x where x.id=en.assignment_id and x.can_open)) group by t
    ) q;
   end if;
   if qty<r.minimum then issues=issues||jsonb_build_array(jsonb_build_object('code','coverage','level',case when r.blocking and r.confirmed then 'block' else 'warning' end,'date',d,'requirementId',r.id,'message','Cobertura abaixo do mínimo','detail',qty||' / '||r.minimum,'provisional',not r.confirmed));end if;
  end loop;
 end loop;
 if not coalesce((u.settings->>'policyReviewed')::boolean,false) then issues=issues||jsonb_build_array(jsonb_build_object('code','policy_review','level','warning','message','Perfil de jornada ainda não revisado com as regras aplicáveis'));end if;
 return issues;
end $$;
create function public.schedule_issues(p_schedule uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.schedule_issues(p_schedule); $$;

create function private.save_schedule(p_unit uuid,p_week date,p_revision integer,p_unit_revision integer,p_entries jsonb,p_reason text default '') returns public.schedules language plpgsql security definer set search_path='' as $$
declare u public.units;s public.schedules;v record;begin
 if not private.can_manage(p_unit) then raise exception 'Sem permissão para alterar a escala.';end if;
 if jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries)>2000 then raise exception 'Escala inválida.';end if;
 select * into u from public.units where id=p_unit for update;
 if u.revision<>p_unit_revision then raise exception 'A configuração mudou. Recarregue antes de salvar.' using errcode='40001';end if;
 select * into s from public.schedules where unit_id=p_unit and week_start=p_week for update;
 if s.id is null then
  if p_revision<>0 then raise exception 'A escala mudou. Recarregue.' using errcode='40001';end if;
  insert into public.schedules(unit_id,week_start,updated_by) values(p_unit,p_week,auth.uid()) returning * into s;
 else
  if s.revision<>p_revision then raise exception 'Outra pessoa atualizou a escala. Recarregue.' using errcode='40001';end if;
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
create function public.save_schedule(p_unit uuid,p_week date,p_revision integer,p_unit_revision integer,p_entries jsonb,p_reason text default '') returns public.schedules language sql security invoker set search_path='' as $$ select private.save_schedule(p_unit,p_week,p_revision,p_unit_revision,p_entries,p_reason); $$;

create function private.publish_schedule(p_schedule uuid,p_revision integer,p_unit_revision integer,p_ack_warnings boolean) returns integer language plpgsql security definer set search_path='' as $$
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
 'people',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'weekly_hours',p.weekly_hours)) from public.people p where p.id in(select person_id from public.schedule_entries where schedule_id=s.id)),'[]'),
 'sectors',coalesce((select jsonb_agg(to_jsonb(x)) from public.sectors x where unit_id=s.unit_id),'[]'),
 'roles',coalesce((select jsonb_agg(to_jsonb(x)) from public.job_roles x where network_id=u.network_id),'[]')));
 update public.schedules set status='published',published_version=v,revision=revision+1,updated_at=now(),updated_by=auth.uid() where id=s.id;
 insert into public.audit_events(network_id,unit_id,actor_id,entity,action,record_id,details) values(u.network_id,s.unit_id,auth.uid(),'schedules','publish',s.id::text,jsonb_build_object('version',v));
 return v;
end $$;
create function public.publish_schedule(p_schedule uuid,p_revision integer,p_unit_revision integer,p_ack_warnings boolean) returns integer language sql security invoker set search_path='' as $$ select private.publish_schedule(p_schedule,p_revision,p_unit_revision,p_ack_warnings); $$;
create function private.revise_schedule(p_schedule uuid,p_revision integer,p_reason text) returns public.schedules language plpgsql security definer set search_path='' as $$
declare s public.schedules;n uuid;begin
 select * into s from public.schedules where id=p_schedule for update;
 if not private.can_manage(s.unit_id) then raise exception 'Sem permissão para revisar.';end if;
 if s.revision<>p_revision then raise exception 'Escala alterada. Recarregue.' using errcode='40001';end if;
 if s.status<>'published' or length(trim(p_reason))<3 then raise exception 'Informe o motivo da revisão da escala publicada.';end if;
 update public.schedules set status='draft',revision=revision+1,updated_at=now(),updated_by=auth.uid() where id=s.id returning * into s;
 select network_id into n from public.units where id=s.unit_id;
 insert into public.audit_events(network_id,unit_id,actor_id,entity,action,record_id,details) values(n,s.unit_id,auth.uid(),'schedules','revise',s.id::text,jsonb_build_object('reason',left(p_reason,500)));
 return s;
end $$;
create function public.revise_schedule(p_schedule uuid,p_revision integer,p_reason text) returns public.schedules language sql security invoker set search_path='' as $$ select private.revise_schedule(p_schedule,p_revision,p_reason); $$;

create function private.import_people(p_unit uuid,p_file text,p_rows jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb; n uuid; c integer=0; skipped integer=0;begin
 if not private.can_manage(p_unit) then raise exception 'Sem permissão para importar.';end if;
 select network_id into n from public.units where id=p_unit for update;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>500 then raise exception 'Limite de 500 registros por importação.';end if;
 for r in select * from jsonb_array_elements(p_rows) loop
  if nullif(trim(r->>'external_id'),'') is null or nullif(trim(r->>'name'),'') is null then raise exception 'Identificador e nome são obrigatórios.';end if;
  if exists(select 1 from public.people where network_id=n and external_id=r->>'external_id') then skipped=skipped+1;continue;end if;
  perform private.add_person(p_unit,r->>'name',r->>'external_id',coalesce((r->>'weekly_hours')::numeric,40),(r->>'sector_id')::uuid,(r->>'role_id')::uuid,array[0,1,2,3,4,5,6],null,false);
  c=c+1;
 end loop;
 insert into public.import_batches(unit_id,file_name,imported_count,skipped_count,created_by) values(p_unit,left(p_file,200),c,skipped,auth.uid());
 return jsonb_build_object('imported',c,'skipped',skipped);
end $$;
create function public.import_people(p_unit uuid,p_file text,p_rows jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.import_people(p_unit,p_file,p_rows); $$;

-- New functions are never executable anonymously. Private helpers perform their own authorization.
revoke all on all functions in schema private from public,anon;
grant execute on all functions in schema private to authenticated;
revoke all on function public.accept_access(),public.create_unit(uuid,text,text),public.add_person(uuid,text,text,numeric,uuid,uuid,integer[],uuid,boolean),public.schedule_issues(uuid),public.save_schedule(uuid,date,integer,integer,jsonb,text),public.publish_schedule(uuid,integer,integer,boolean),public.revise_schedule(uuid,integer,text),public.import_people(uuid,text,jsonb) from public,anon;
grant execute on function public.accept_access(),public.create_unit(uuid,text,text),public.add_person(uuid,text,text,numeric,uuid,uuid,integer[],uuid,boolean),public.schedule_issues(uuid),public.save_schedule(uuid,date,integer,integer,jsonb,text),public.publish_schedule(uuid,integer,integer,boolean),public.revise_schedule(uuid,integer,text),public.import_people(uuid,text,jsonb) to authenticated;

create function private.mutate_configuration(p_unit uuid,p_revision integer,p_table text,p_record jsonb,p_delete boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.units;r jsonb;rid uuid;cols text;sets text;predicate text;col text;network_table boolean;begin
 if not private.can_manage(p_unit) then raise exception 'Sem permissão para manter os dados desta unidade.';end if;
 if p_table<>all(array['units','sectors','job_roles','people','shift_templates','unit_assignments','qualifications','absences','coverage_requirements','vacancies','scenarios']) then raise exception 'Cadastro inválido.';end if;
 if jsonb_typeof(p_record)<>'object' then raise exception 'Dados inválidos.';end if;
 select * into u from public.units where id=p_unit for update;
 if u.revision<>p_revision then raise exception 'Outra pessoa atualizou a configuração. Recarregue antes de salvar.' using errcode='40001';end if;
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
create function public.mutate_configuration(p_unit uuid,p_revision integer,p_table text,p_record jsonb,p_delete boolean default false) returns jsonb language sql security invoker set search_path='' as $$ select private.mutate_configuration(p_unit,p_revision,p_table,p_record,p_delete); $$;

create function private.set_access(p_network uuid,p_unit uuid,p_email text,p_role text,p_revoke boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare mail text=lower(trim(p_email));uid uuid;begin
 if not private.is_owner(p_network) then raise exception 'Apenas o administrador pode gerenciar acessos.';end if;
 if p_role not in ('owner','manager','viewer') or (p_role<>'owner' and p_unit is null) then raise exception 'Perfil ou unidade inválidos.';end if;
 if p_unit is not null and not exists(select 1 from public.units where id=p_unit and network_id=p_network) then raise exception 'Unidade inválida.';end if;
 select id into uid from auth.users where lower(email)=mail and email_confirmed_at is not null;
 if uid=auth.uid() and p_revoke then raise exception 'Não revogue seu próprio acesso.';end if;
 insert into public.access_invites(network_id,unit_id,email,role,revoked,accepted_at) values(p_network,p_unit,mail,p_role,p_revoke,case when uid is not null then now() end)
 on conflict(network_id,unit_id,email) do update set role=excluded.role,revoked=excluded.revoked,accepted_at=excluded.accepted_at;
 if uid is not null then
  insert into public.memberships(user_id,network_id,unit_id,role,active) values(uid,p_network,p_unit,p_role,not p_revoke)
  on conflict(user_id,network_id,unit_id) do update set role=excluded.role,active=excluded.active;
 end if;
end $$;
create function public.set_access(p_network uuid,p_unit uuid,p_email text,p_role text,p_revoke boolean default false) returns void language sql security invoker set search_path='' as $$ select private.set_access(p_network,p_unit,p_email,p_role,p_revoke); $$;
revoke all on function private.mutate_configuration(uuid,integer,text,jsonb,boolean),private.set_access(uuid,uuid,text,text,boolean) from public,anon;
grant execute on function private.mutate_configuration(uuid,integer,text,jsonb,boolean),private.set_access(uuid,uuid,text,text,boolean) to authenticated;
revoke all on function public.mutate_configuration(uuid,integer,text,jsonb,boolean),public.set_access(uuid,uuid,text,text,boolean) from public,anon;
grant execute on function public.mutate_configuration(uuid,integer,text,jsonb,boolean),public.set_access(uuid,uuid,text,text,boolean) to authenticated;
