-- Property search and phone search ran past the 8 second Data API timeout
-- because the visibility rule called security-definer helpers (each one a
-- role lookup query) for all ~54k properties before the search filters
-- narrowed the rows. Wrapping the per-user parts in scalar subqueries makes
-- PostgreSQL evaluate them once per statement (InitPlan) instead of per row.

create or replace view public.properties_safe as
select p.id,p.code,p.client_id,p.type_id,p.offer_type_id,p.location_type_id,p.area_id,p.block,p.plot,p.street,p.avenue,p.floor,p.building_type,p.area_m2,
  case when exists(select 1 from public.profiles me where me.id=(auth.uid()::text) and me.price_visible) then p.asking_price_kwd else null::numeric end as asking_price_kwd,
  p.details,p.notes,p.assigned_to,p.created_by,p.status,p.entry_date,p.latitude,p.longitude,p.created_at,p.updated_at,
  (p.latitude is not null and p.longitude is not null) as has_map,
  exists(select 1 from public.property_phones pp where pp.property_id=p.id) as has_contact,
  (p.area_id is not null and (nullif(trim(p.block),'') is not null or nullif(trim(p.plot),'') is not null)) as has_location,
  (select max(c.created_at) from public.comments c where c.property_id=p.id or c.client_id=p.client_id) as last_contact_at,
  p.sector,p.distribution,p.rooms_details,p.source_excel
from public.properties p
where p.deleted_at is null and (
  -- Roles that see every record: decided once for the whole statement.
  (select public.current_app_role()) in ('super_admin','manager','viewer','accountant','data_entry','marketer')
  -- Imported Excel rows are shared with everyone who may view properties.
  or ((select public.has_permission('properties','view')) and exists(select 1 from public.excel_import_rows r where r.property_id=p.id))
  -- Remaining roles (sales agent, call center): the original per-row owner rule.
  or public.can_view_record(p.assigned_to));
grant select on public.properties_safe to authenticated;

-- Phone search: find the matching numbers first, then check visibility only for those rows.
create or replace function public.find_records_by_phone(p_query text)
returns table(client_id uuid,property_id uuid)
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor_id text:=(auth.uid()::text); normalized text; can_clients boolean; can_properties boolean;
begin
  normalized:=regexp_replace(translate(coalesce(p_query,''),'٠١٢٣٤٥٦٧٨٩','0123456789'),'\D','','g');
  if length(normalized)=11 and left(normalized,3)='965' then normalized:=right(normalized,8); end if;
  if actor_id is null then raise exception 'Authentication is required'; end if;
  if length(normalized)<4 then raise exception 'Enter at least four phone digits'; end if;
  if not exists(select 1 from public.profiles where id=actor_id and phone_visible) then raise exception 'Phone search is not enabled for this user'; end if;
  can_clients:=public.has_permission('clients','view');
  can_properties:=public.has_permission('properties','view');
  if not can_clients and not can_properties then raise exception 'Insufficient permission to search'; end if;
  insert into public.audit_logs(actor_id,action,entity_type,metadata)
  values(actor_id,'search','phone',jsonb_build_object('last_four',right(normalized,4)));
  return query
  with client_hits as materialized (
    select distinct cp.client_id from public.client_phones cp
    join public.clients c on c.id=cp.client_id and c.deleted_at is null
    where can_clients and cp.normalized_phone like '%'||normalized||'%'
    limit 1000
  ),
  property_hits as materialized (
    select distinct pp.property_id from public.property_phones pp
    where can_properties and pp.normalized_phone like '%'||normalized||'%'
    limit 1000
  )
  select h.client_id,v.id
  from client_hits h
  left join public.properties_safe v on v.client_id=h.client_id and can_properties
  union
  select v.client_id,v.id
  from property_hits h
  join public.properties_safe v on v.id=h.property_id;
end;
$$;
revoke all on function public.find_records_by_phone(text) from public,anon;
grant execute on function public.find_records_by_phone(text) to authenticated;

-- Row-level policies: same rules as before, with the per-user checks wrapped in
-- scalar subqueries so they run once per statement instead of once per row.
alter policy "clients team read" on public.clients
  using (deleted_at is null and (select public.has_permission('clients','view')));

alter policy "properties scoped read" on public.properties
  using (deleted_at is null and (
    (select public.current_app_role()) in ('super_admin','manager','viewer','accountant','data_entry','marketer')
    or ((select public.has_permission('properties','view')) and exists(select 1 from public.excel_import_rows r where r.property_id=properties.id))
    or public.can_view_record(assigned_to)));

alter policy "property phones visible to authorized roles" on public.property_phones
  using ((select exists(select 1 from public.profiles me where me.id=(auth.uid()::text) and me.phone_visible))
    and exists(select 1 from public.properties p where p.id=property_phones.property_id and (
      (select public.current_app_role()) in ('super_admin','manager','viewer','accountant','data_entry','marketer')
      or ((select public.has_permission('properties','view')) and exists(select 1 from public.excel_import_rows r where r.property_id=p.id))
      or public.can_view_record(p.assigned_to))));

alter policy "comments visible to client team" on public.comments
  using ((client_id is not null and (select public.has_permission('clients','view')))
    or (property_id is not null and exists(select 1 from public.properties p where p.id=comments.property_id and (
      (select public.current_app_role()) in ('super_admin','manager','viewer','accountant','data_entry','marketer')
      or public.can_view_record(p.assigned_to)))));

alter policy "active lookups readable" on public.lookups
  using (is_active or (select public.current_app_role()) in ('super_admin','manager'));

alter policy "profiles self or authorized staff readers" on public.profiles
  using (id=(select auth.uid()::text) or (select public.has_permission('users','view')));

alter policy "lookup admins edit" on public.lookups
  using ((select public.current_app_role()) in ('super_admin','manager'))
  with check ((select public.current_app_role()) in ('super_admin','manager'));
