-- The sidebar shows only the pages the signed-in user may open. role_permissions
-- is readable by super_admin only, so each user reads their own role and allowed
-- module/action pairs through this function.
create or replace function public.my_permissions()
returns table(role text, module text, action text)
language sql stable security definer set search_path=public,pg_temp as $$
  select r.name::text, x.module::text, x.action::text
  from public.profiles p
  join public.roles r on r.id=p.role_id
  left join public.role_permissions rp on rp.role_id=r.id and rp.allowed
  left join public.permissions x on x.id=rp.permission_id
  where p.id=(auth.uid()::text) and p.is_active
$$;
revoke all on function public.my_permissions() from public,anon;
grant execute on function public.my_permissions() to authenticated;
