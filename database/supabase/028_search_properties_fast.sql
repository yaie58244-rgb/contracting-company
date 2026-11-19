-- Select the matching IDs before expanding the safe view. The previous query
-- expanded correlated contact/map fields for the full inventory before LIMIT.
create or replace function public.search_properties(p_filters jsonb default '{}'::jsonb)
returns table(
  id uuid, code text, client text, phones text[], type text, offer text, area text,
  sector text, distribution text, block text, plot text, street text, avenue text,
  floor text, building_type text, rooms_details text, source_excel jsonb,
  source_search text, location_type text, size numeric, price numeric, employee text,
  status public.property_status, date date, details text, latitude double precision,
  longitude double precision, has_map boolean, has_contact boolean, has_location boolean,
  last_contact_at timestamptz
)
language sql stable security invoker set search_path=public,pg_temp as $$
  with f as materialized (select coalesce(p_filters,'{}'::jsonb) as value),
  candidates as materialized (
    select p.id,p.entry_date
    from public.properties_safe p
    cross join f
    left join public.clients cl on cl.id=p.client_id
    left join public.lookups pt on pt.id=p.type_id
    left join public.lookups ot on ot.id=p.offer_type_id
    left join public.lookups ar on ar.id=p.area_id
    left join public.lookups lt on lt.id=p.location_type_id
    left join public.profiles rep on rep.id=p.assigned_to
    where (auth.uid()::text) is not null and public.has_permission('properties','view')
      and (nullif(trim(f.value->>'all'),'') is null or concat_ws(' ',p.code,cl.name,pt.name_ar,ot.name_ar,lt.name_ar,ar.name_ar,
        p.sector,p.distribution,p.block,p.plot,p.street,p.avenue,p.floor,p.building_type,p.rooms_details,
        p.details,p.notes,p.source_excel::text,rep.full_name,p.area_m2,
        p.asking_price_kwd,p.status,p.entry_date) ilike '%'||trim(f.value->>'all')||'%')
      and (nullif(trim(f.value->>'client'),'') is null or coalesce(cl.name,'') ilike '%'||trim(f.value->>'client')||'%')
      and (nullif(trim(f.value->>'code'),'') is null or p.code ilike '%'||trim(f.value->>'code')||'%')
      and (nullif(trim(f.value->>'type'),'') is null or coalesce(pt.name_ar,'') ilike '%'||trim(f.value->>'type')||'%')
      and (nullif(trim(f.value->>'offer'),'') is null or coalesce(ot.name_ar,'') ilike '%'||trim(f.value->>'offer')||'%')
      and (nullif(trim(f.value->>'locationType'),'') is null or coalesce(lt.name_ar,'') ilike '%'||trim(f.value->>'locationType')||'%')
      and (nullif(trim(f.value->>'governorate'),'') is null or coalesce(cl.address->>'governorate','') ilike '%'||trim(f.value->>'governorate')||'%')
      and (nullif(trim(f.value->>'area'),'') is null or coalesce(ar.name_ar,'') ilike '%'||trim(f.value->>'area')||'%')
      and (nullif(trim(f.value->>'sector'),'') is null or coalesce(p.sector,'') ilike '%'||trim(f.value->>'sector')||'%')
      and (nullif(trim(f.value->>'distribution'),'') is null or coalesce(p.distribution,'') ilike '%'||trim(f.value->>'distribution')||'%')
      and (nullif(trim(f.value->>'block'),'') is null or coalesce(p.block,'') ilike '%'||trim(f.value->>'block')||'%')
      and (nullif(trim(f.value->>'plot'),'') is null or coalesce(p.plot,'') ilike '%'||trim(f.value->>'plot')||'%')
      and (nullif(trim(f.value->>'employee'),'') is null or coalesce(rep.full_name,'') ilike '%'||trim(f.value->>'employee')||'%')
      and (nullif(trim(f.value->>'details'),'') is null or concat_ws(' ',p.details,p.rooms_details,p.source_excel::text) ilike '%'||trim(f.value->>'details')||'%')
      and (nullif(trim(f.value->>'notes'),'') is null or concat_ws(' ',p.notes,cl.notes,cl.address::text) ilike '%'||trim(f.value->>'notes')||'%')
      and (nullif(trim(f.value->>'sizeMin'),'') is null or p.area_m2>=nullif(f.value->>'sizeMin','')::numeric)
      and (nullif(trim(f.value->>'sizeMax'),'') is null or p.area_m2<=nullif(f.value->>'sizeMax','')::numeric)
      and (nullif(trim(f.value->>'priceMin'),'') is null or p.asking_price_kwd>=nullif(f.value->>'priceMin','')::numeric)
      and (nullif(trim(f.value->>'priceMax'),'') is null or p.asking_price_kwd<=nullif(f.value->>'priceMax','')::numeric)
      and (nullif(trim(f.value->>'dateFrom'),'') is null or p.entry_date>=nullif(f.value->>'dateFrom','')::date)
      and (nullif(trim(f.value->>'dateTo'),'') is null or p.entry_date<=nullif(f.value->>'dateTo','')::date)
      and (nullif(trim(f.value->>'status'),'') is null or p.status::text=case trim(f.value->>'status') when 'متاح' then 'available' when 'مباع' then 'sold' when 'مفقود' then 'lost' else trim(f.value->>'status') end)
      and ((not (f.value ? 'matchingPropertyIds') and not (f.value ? 'matchingClientIds'))
        or p.id=any(array(select jsonb_array_elements_text(f.value->'matchingPropertyIds')::uuid))
        or p.client_id=any(array(select jsonb_array_elements_text(f.value->'matchingClientIds')::uuid)))
    order by p.entry_date desc,p.id
    limit 500
  )
  select p.id,p.code,coalesce(cl.name,'غير مسجل')::text,'{}'::text[],
    coalesce(pt.name_ar,'غير محدد')::text,coalesce(ot.name_ar,'—')::text,coalesce(ar.name_ar,'غير محدد')::text,
    coalesce(p.sector,'')::text,coalesce(p.distribution,'')::text,coalesce(p.block,'')::text,
    coalesce(p.plot,'')::text,coalesce(p.street,'')::text,coalesce(p.avenue,'')::text,
    coalesce(p.floor,'')::text,coalesce(p.building_type,'')::text,coalesce(p.rooms_details,'')::text,
    p.source_excel,coalesce(p.source_excel::text,'')::text,coalesce(lt.name_ar,'')::text,
    coalesce(p.area_m2,0)::numeric,
    case when exists(select 1 from public.profiles me where me.id=(auth.uid()::text) and me.price_visible) then p.asking_price_kwd else null::numeric end,
    coalesce(rep.full_name,'غير معيّن')::text,
    p.status,p.entry_date,coalesce(p.details,'')::text,p.latitude,p.longitude,p.has_map,
    p.has_contact,p.has_location,p.last_contact_at
  from candidates candidate
  join public.properties_safe p on p.id=candidate.id
  left join public.clients cl on cl.id=p.client_id
  left join public.lookups pt on pt.id=p.type_id
  left join public.lookups ot on ot.id=p.offer_type_id
  left join public.lookups ar on ar.id=p.area_id
  left join public.lookups lt on lt.id=p.location_type_id
  left join public.profiles rep on rep.id=p.assigned_to
  order by candidate.entry_date desc,candidate.id
$$;
revoke all on function public.search_properties(jsonb) from public,anon;
grant execute on function public.search_properties(jsonb) to authenticated;

create index if not exists properties_area_entry_active_idx
  on public.properties(area_id,entry_date desc,id asc)
  where deleted_at is null;
