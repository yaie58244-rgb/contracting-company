-- The owner wants to choose for every employee, managers included, whether
-- they may edit property files. The per-person setting now wins over the
-- manager/super admin shortcut for properties:edit only. "Follow the role"
-- (null) keeps the old behaviour, so nothing changes until the owner picks.

create or replace function public.has_permission(p_module text,p_action text) returns boolean
language sql stable security definer set search_path=public as $$
  select case
    when p_module='properties' and p_action='edit'
      and (select me.can_edit_property from profiles me where me.id=(auth.uid()::text) and me.is_active) is not null
      then (select me.can_edit_property from profiles me where me.id=(auth.uid()::text) and me.is_active)
    when public.current_app_role() in ('super_admin','manager') then true
    else exists(select 1 from profiles p join roles r on r.id=p.role_id join role_permissions rp on rp.role_id=r.id
      join permissions x on x.id=rp.permission_id
      where p.id=(auth.uid()::text) and p.is_active and rp.allowed and x.module=p_module and x.action=p_action)
  end
$$;
