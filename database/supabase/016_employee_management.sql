-- Make the first workspace account its administrator and support safe
-- employee creation/maintenance through Neon Auth + permission checked RPCs.
create or replace function public.bootstrap_current_profile()
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare auth_user auth.users%rowtype; new_name text;
begin
  if (auth.uid()::text) is null then raise exception 'Authentication is required'; end if;
  select * into auth_user from auth.users where id=(auth.uid()::text)::uuid;
  if not found then raise exception 'Auth user was not found'; end if;
  new_name:=coalesce(nullif(coalesce(auth_user.raw_user_meta_data->>'name',''),''),split_part(auth_user.email,'@',1));
  if exists(select 1 from public.profiles where id=auth_user.id::text)
     and (select count(*) from public.profiles)=1
     and not exists(select 1 from public.profiles where role_id=(select id from public.roles where name='super_admin')) then
    update public.profiles set role_id=(select id from public.roles where name='super_admin') where id=auth_user.id::text;
  end if;
  insert into public.profiles(id,auth_user_id,full_name,email,role_id)
  select auth_user.id::text,auth_user.id,new_name,auth_user.email,
    (select id from public.roles where name=case when not exists(select 1 from public.profiles) then 'super_admin' else 'viewer' end)
  on conflict(id) do update set email=excluded.email,full_name=coalesce(nullif(public.profiles.full_name,''),excluded.full_name);
  return auth_user.id::text;
end;
$$;

create or replace function public.can_manage_users()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select (auth.uid()::text) is not null and public.has_permission('users','create')
$$;
revoke all on function public.can_manage_users() from public,anon;
grant execute on function public.can_manage_users() to authenticated;

drop policy if exists "profiles self or managers read" on public.profiles;
drop policy if exists "profiles self or authorized staff readers" on public.profiles;
create policy "profiles self or authorized staff readers" on public.profiles for select
using(id=(auth.uid()::text) or public.has_permission('users','view'));

create or replace function public.create_employee_profile(
  p_auth_user_id uuid,p_name text,p_email text,p_role_id uuid,
  p_phone_visible boolean default false,p_price_visible boolean default false
)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare actor_id text:=(auth.uid()::text)::text; auth_user auth.users%rowtype; created_id text;
begin
  if actor_id is null or not public.has_permission('users','create') then raise exception 'User create permission is required'; end if;
  if p_name is null or length(trim(p_name))<2 or p_email is null or position('@' in p_email)=0 then raise exception 'Valid name and email are required'; end if;
  if not exists(select 1 from public.roles where id=p_role_id) then raise exception 'Role is unavailable'; end if;
  select * into auth_user from auth.users where id=p_auth_user_id;
  if not found then raise exception 'Auth user was not found yet'; end if;
  insert into public.profiles(id,auth_user_id,full_name,email,role_id,manager_id,phone_visible,price_visible)
  values(auth_user.id::text,auth_user.id,trim(p_name),lower(trim(p_email)),p_role_id,actor_id,p_phone_visible,p_price_visible)
  returning id into created_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_data)
  values(actor_id,'create','profile',created_id,jsonb_build_object('full_name',trim(p_name),'email',lower(trim(p_email)),'role_id',p_role_id));
  return created_id;
end;
$$;
revoke all on function public.create_employee_profile(uuid,text,text,uuid,boolean,boolean) from public,anon;
grant execute on function public.create_employee_profile(uuid,text,text,uuid,boolean,boolean) to authenticated;

create or replace function public.update_employee_profile(
  p_profile_id text,p_role_id uuid default null,p_is_active boolean default null,
  p_phone_visible boolean default null,p_price_visible boolean default null
)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if (auth.uid()::text) is null or not public.has_permission('users','edit') then raise exception 'User edit permission is required'; end if;
  if p_role_id is not null and not exists(select 1 from public.roles where id=p_role_id) then raise exception 'Role is unavailable'; end if;
  update public.profiles set role_id=coalesce(p_role_id,role_id),is_active=coalesce(p_is_active,is_active),
    phone_visible=coalesce(p_phone_visible,phone_visible),price_visible=coalesce(p_price_visible,price_visible),updated_at=now()
  where id=p_profile_id;
  if not found then raise exception 'Employee profile was not found'; end if;
end;
$$;
revoke all on function public.update_employee_profile(text,uuid,boolean,boolean,boolean) from public,anon;
grant execute on function public.update_employee_profile(text,uuid,boolean,boolean,boolean) to authenticated;
