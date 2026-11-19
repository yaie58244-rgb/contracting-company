-- Safe boolean indicators for common Savvy-style work queues.
create or replace view public.properties_safe with (security_barrier=true) as
select p.id,p.code,p.client_id,p.type_id,p.offer_type_id,p.location_type_id,p.area_id,p.block,p.plot,p.street,p.avenue,p.floor,p.building_type,p.area_m2,
  case when exists(select 1 from public.profiles me where me.id=(auth.uid()::text) and me.price_visible) then p.asking_price_kwd else null::numeric end as asking_price_kwd,
  p.details,p.notes,p.assigned_to,p.created_by,p.status,p.entry_date,p.latitude,p.longitude,p.created_at,p.updated_at,
  (p.latitude is not null and p.longitude is not null) as has_map,
  exists(select 1 from public.property_phones pp where pp.property_id=p.id) as has_contact,
  (p.area_id is not null and (nullif(trim(p.block),'') is not null or nullif(trim(p.plot),'') is not null)) as has_location,
  (select max(c.created_at) from public.comments c where c.property_id=p.id or c.client_id=p.client_id) as last_contact_at
from public.properties p
where p.deleted_at is null and public.can_view_record(p.assigned_to);
grant select on public.properties_safe to authenticated;
