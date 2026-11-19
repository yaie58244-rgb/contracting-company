alter table public.properties
  add column if not exists sector text,
  add column if not exists distribution text;

create or replace view public.properties_safe with (security_barrier=true) as
select p.id,p.code,p.client_id,p.type_id,p.offer_type_id,p.location_type_id,p.area_id,p.block,p.plot,p.street,p.avenue,p.floor,p.building_type,p.area_m2,
  case when exists(select 1 from public.profiles me where me.id=(auth.uid()::text) and me.price_visible) then p.asking_price_kwd else null::numeric end as asking_price_kwd,
  p.details,p.notes,p.assigned_to,p.created_by,p.status,p.entry_date,p.latitude,p.longitude,p.created_at,p.updated_at,
  (p.latitude is not null and p.longitude is not null) as has_map,
  exists(select 1 from public.property_phones pp where pp.property_id=p.id) as has_contact,
  (p.area_id is not null and (nullif(trim(p.block),'') is not null or nullif(trim(p.plot),'') is not null)) as has_location,
  (select max(c.created_at) from public.comments c where c.property_id=p.id or c.client_id=p.client_id) as last_contact_at,
  p.sector,p.distribution
from public.properties p
where p.deleted_at is null and public.can_view_record(p.assigned_to);
grant select on public.properties_safe to authenticated;

create or replace function public.update_property_location(p_property_id uuid,p_area text,p_sector text,p_distribution text,p_block text,p_plot text,p_street text,p_location_type text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare owner_id text; area_record_id uuid; location_record_id uuid;
begin
  if (auth.uid()::text) is null then raise exception 'Authentication is required'; end if;
  if nullif(trim(coalesce(p_area,'')),'') is not null then
    select id into area_record_id from public.lookups where type='area' and name_ar=trim(p_area) and is_active limit 1;
    if area_record_id is null then raise exception 'المنطقة غير موجودة في القوائم'; end if;
  end if;
  if nullif(trim(coalesce(p_location_type,'')),'') is not null then
    select id into location_record_id from public.lookups where type='location_type' and name_ar=trim(p_location_type) and is_active limit 1;
    if location_record_id is null then raise exception 'نوع الموقع غير موجود في القوائم'; end if;
  end if;
  select assigned_to into owner_id from public.properties where id=p_property_id and deleted_at is null;
  if not found or not public.can_view_record(owner_id) or not public.has_permission('properties','edit') then
    raise exception 'Insufficient permission to edit this property';
  end if;
  update public.properties set area_id=area_record_id,sector=nullif(trim(p_sector),''),distribution=nullif(trim(p_distribution),''),
    block=nullif(trim(p_block),''),plot=nullif(trim(p_plot),''),street=nullif(trim(p_street),''),location_type_id=location_record_id,updated_at=now()
  where id=p_property_id;
end;
$$;
revoke all on function public.update_property_location(uuid,text,text,text,text,text,text,text) from public,anon;
grant execute on function public.update_property_location(uuid,text,text,text,text,text,text,text) to authenticated;
