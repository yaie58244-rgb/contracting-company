-- The owner decides per employee whether they may edit property files:
-- profiles.can_edit_property is null (follow the role), true (allowed) or
-- false (blocked). Super admins and managers can always edit. has_permission
-- is the one check every property edit function and the update policy use,
-- so the switch applies everywhere at once.

alter table public.profiles add column if not exists can_edit_property boolean;

create or replace function public.has_permission(p_module text,p_action text) returns boolean
language sql stable security definer set search_path=public as $$
  select case
    when public.current_app_role() in ('super_admin','manager') then true
    when p_module='properties' and p_action='edit'
      and (select me.can_edit_property from profiles me where me.id=(auth.uid()::text) and me.is_active) is not null
      then (select me.can_edit_property from profiles me where me.id=(auth.uid()::text) and me.is_active)
    else exists(select 1 from profiles p join roles r on r.id=p.role_id join role_permissions rp on rp.role_id=r.id
      join permissions x on x.id=rp.permission_id
      where p.id=(auth.uid()::text) and p.is_active and rp.allowed and x.module=p_module and x.action=p_action)
  end
$$;

-- The users page sets the switch: 'role' (follow the role), 'allow' or 'deny'.
drop function if exists public.update_employee_profile(text,uuid,boolean,boolean,boolean,boolean);
create function public.update_employee_profile(
  p_profile_id text,p_role_id uuid default null,p_is_active boolean default null,
  p_phone_visible boolean default null,p_price_visible boolean default null,p_can_add_property boolean default null,
  p_can_edit_property text default null
)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if (auth.uid()::text) is null or not public.has_permission('users','edit') then raise exception 'User edit permission is required'; end if;
  if p_role_id is not null and not exists(select 1 from public.roles where id=p_role_id) then raise exception 'Role is unavailable'; end if;
  if p_can_edit_property is not null and p_can_edit_property not in ('role','allow','deny') then raise exception 'Unknown property edit setting'; end if;
  update public.profiles set role_id=coalesce(p_role_id,role_id),is_active=coalesce(p_is_active,is_active),
    phone_visible=coalesce(p_phone_visible,phone_visible),price_visible=coalesce(p_price_visible,price_visible),
    can_add_property=coalesce(p_can_add_property,can_add_property),
    can_edit_property=case p_can_edit_property when 'role' then null when 'allow' then true when 'deny' then false else can_edit_property end,
    updated_at=now()
  where id=p_profile_id;
  if not found then raise exception 'Employee profile was not found'; end if;
end;
$$;
revoke all on function public.update_employee_profile(text,uuid,boolean,boolean,boolean,boolean,text) from public,anon;
grant execute on function public.update_employee_profile(text,uuid,boolean,boolean,boolean,boolean,text) to authenticated;
