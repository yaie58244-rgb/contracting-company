-- Staff attendance sessions with manager visibility and termination controls.
create table public.work_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.profiles(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by text references public.profiles(id),
  check(ended_at is null or ended_at>=started_at)
);
create unique index work_sessions_one_active_per_user on public.work_sessions(user_id) where ended_at is null;
create index work_sessions_history_idx on public.work_sessions(started_at desc);
alter table public.work_sessions enable row level security;
create policy "staff can read own sessions and managers read all" on public.work_sessions for select
  using(user_id=(auth.uid()::text) or public.current_app_role() in ('super_admin','manager'));
grant select on public.work_sessions to authenticated;

insert into public.permissions(module,action)
values('work_sessions','view'),('work_sessions','start'),('work_sessions','end'),('work_sessions','terminate') on conflict(module,action) do nothing;
insert into public.role_permissions(role_id,permission_id,allowed)
select r.id,p.id,case when r.name in ('super_admin','manager') then true when p.action in ('view','start','end') then true else false end
from public.roles r cross join public.permissions p
where p.module='work_sessions' and r.name<>'viewer'
on conflict(role_id,permission_id) do nothing;

create or replace function public.list_work_sessions()
returns table(id uuid,user_id text,full_name text,started_at timestamptz,ended_at timestamptz,ended_by_name text)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if (auth.uid()::text) is null or not public.has_permission('work_sessions','view') then raise exception 'You cannot view work sessions'; end if;
  return query
  select s.id,s.user_id,p.full_name,s.started_at,s.ended_at,e.full_name
  from public.work_sessions s join public.profiles p on p.id=s.user_id left join public.profiles e on e.id=s.ended_by
  where public.current_app_role() in ('super_admin','manager') or s.user_id=(auth.uid()::text)
  order by s.started_at desc limit 500;
end;
$$;
revoke all on function public.list_work_sessions() from public,anon;
grant execute on function public.list_work_sessions() to authenticated;

create or replace function public.start_work_session()
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare actor_id text:=(auth.uid()::text); session_id uuid;
begin
  if actor_id is null or not public.has_permission('work_sessions','start') then raise exception 'You cannot start a work session'; end if;
  if exists(select 1 from public.work_sessions where user_id=actor_id and ended_at is null) then raise exception 'لديك جلسة عمل مفتوحة بالفعل'; end if;
  insert into public.work_sessions(user_id) values(actor_id) returning id into session_id;
  return session_id;
end;
$$;
revoke all on function public.start_work_session() from public,anon;
grant execute on function public.start_work_session() to authenticated;

create or replace function public.end_work_session()
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if (auth.uid()::text) is null or not public.has_permission('work_sessions','end') then raise exception 'You cannot end a work session'; end if;
  update public.work_sessions set ended_at=now(),ended_by=(auth.uid()::text)
  where user_id=(auth.uid()::text) and ended_at is null;
  if not found then raise exception 'لا توجد جلسة عمل مفتوحة'; end if;
end;
$$;
revoke all on function public.end_work_session() from public,anon;
grant execute on function public.end_work_session() to authenticated;

create or replace function public.terminate_work_session(p_session_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if (auth.uid()::text) is null or public.current_app_role() not in ('super_admin','manager') then raise exception 'Only managers can terminate another work session'; end if;
  update public.work_sessions set ended_at=now(),ended_by=(auth.uid()::text) where id=p_session_id and ended_at is null;
  if not found then raise exception 'Active work session was not found'; end if;
end;
$$;
revoke all on function public.terminate_work_session(uuid) from public,anon;
grant execute on function public.terminate_work_session(uuid) to authenticated;
