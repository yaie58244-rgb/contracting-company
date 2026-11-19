-- Search the full authorized property set instead of only the current page.
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
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare f jsonb:=coalesce(p_filters,'{}'::jsonb); q text:=nullif(trim(f->>'all'),'');
begin
  if (auth.uid()::text) is null or not public.has_permission('properties','view') then
    raise exception 'Property view permission is required';
  end if;
  return query
  select p.id,p.code,coalesce(cl.name,'غير مسجل')::text,'{}'::text[],
    coalesce(pt.name_ar,'غير محدد')::text,coalesce(ot.name_ar,'—')::text,
    coalesce(ar.name_ar,'غير محدد')::text,coalesce(p.sector,'')::text,
    coalesce(p.distribution,'')::text,coalesce(p.block,'')::text,coalesce(p.plot,'')::text,
    coalesce(p.street,'')::text,coalesce(p.avenue,'')::text,coalesce(p.floor,'')::text,
    coalesce(p.building_type,'')::text,coalesce(p.rooms_details,'')::text,p.source_excel,
    coalesce(p.source_excel::text,'')::text,coalesce(lt.name_ar,'')::text,
    coalesce(p.area_m2,0)::numeric,p.asking_price_kwd,coalesce(rep.full_name,'غير معيّن')::text,
    p.status,p.entry_date,coalesce(p.details,'')::text,p.latitude,p.longitude,p.has_map,
    p.has_contact,p.has_location,p.last_contact_at
  from public.properties_safe p
  left join public.clients cl on cl.id=p.client_id
  left join public.lookups pt on pt.id=p.type_id
  left join public.lookups ot on ot.id=p.offer_type_id
  left join public.lookups ar on ar.id=p.area_id
  left join public.lookups lt on lt.id=p.location_type_id
  left join public.profiles rep on rep.id=p.assigned_to
  where
    (q is null or concat_ws(' ',p.code,cl.name,pt.name_ar,ot.name_ar,lt.name_ar,ar.name_ar,
      p.sector,p.distribution,p.block,p.plot,p.street,p.avenue,p.floor,p.building_type,
      p.rooms_details,p.details,p.notes,p.source_excel::text,rep.full_name,p.area_m2,
      p.asking_price_kwd,p.status,p.entry_date) ilike '%'||q||'%')
    and (nullif(trim(f->>'client'),'') is null or coalesce(cl.name,'') ilike '%'||trim(f->>'client')||'%')
    and (nullif(trim(f->>'code'),'') is null or p.code ilike '%'||trim(f->>'code')||'%')
    and (nullif(trim(f->>'type'),'') is null or coalesce(pt.name_ar,'') ilike '%'||trim(f->>'type')||'%')
    and (nullif(trim(f->>'offer'),'') is null or coalesce(ot.name_ar,'') ilike '%'||trim(f->>'offer')||'%')
    and (nullif(trim(f->>'locationType'),'') is null or coalesce(lt.name_ar,'') ilike '%'||trim(f->>'locationType')||'%')
    and (nullif(trim(f->>'governorate'),'') is null or coalesce(cl.address->>'governorate','') ilike '%'||trim(f->>'governorate')||'%')
    and (nullif(trim(f->>'area'),'') is null or coalesce(ar.name_ar,'') ilike '%'||trim(f->>'area')||'%')
    and (nullif(trim(f->>'sector'),'') is null or coalesce(p.sector,'') ilike '%'||trim(f->>'sector')||'%')
    and (nullif(trim(f->>'distribution'),'') is null or coalesce(p.distribution,'') ilike '%'||trim(f->>'distribution')||'%')
    and (nullif(trim(f->>'block'),'') is null or coalesce(p.block,'') ilike '%'||trim(f->>'block')||'%')
    and (nullif(trim(f->>'plot'),'') is null or coalesce(p.plot,'') ilike '%'||trim(f->>'plot')||'%')
    and (nullif(trim(f->>'employee'),'') is null or coalesce(rep.full_name,'') ilike '%'||trim(f->>'employee')||'%')
    and (nullif(trim(f->>'details'),'') is null or concat_ws(' ',p.details,p.rooms_details,p.source_excel::text) ilike '%'||trim(f->>'details')||'%')
    and (nullif(trim(f->>'notes'),'') is null or concat_ws(' ',p.notes,cl.notes,cl.address::text) ilike '%'||trim(f->>'notes')||'%')
    and (nullif(trim(f->>'sizeMin'),'') is null or p.area_m2>=nullif(f->>'sizeMin','')::numeric)
    and (nullif(trim(f->>'sizeMax'),'') is null or p.area_m2<=nullif(f->>'sizeMax','')::numeric)
    and (nullif(trim(f->>'priceMin'),'') is null or p.asking_price_kwd>=nullif(f->>'priceMin','')::numeric)
    and (nullif(trim(f->>'priceMax'),'') is null or p.asking_price_kwd<=nullif(f->>'priceMax','')::numeric)
    and (nullif(trim(f->>'dateFrom'),'') is null or p.entry_date>=nullif(f->>'dateFrom','')::date)
    and (nullif(trim(f->>'dateTo'),'') is null or p.entry_date<=nullif(f->>'dateTo','')::date)
    and (nullif(trim(f->>'status'),'') is null or p.status::text=case trim(f->>'status') when 'متاح' then 'available' when 'مباع' then 'sold' when 'مفقود' then 'lost' else trim(f->>'status') end)
    and ((not (f ? 'matchingPropertyIds') and not (f ? 'matchingClientIds'))
      or p.id=any(array(select jsonb_array_elements_text(f->'matchingPropertyIds')::uuid))
      or p.client_id=any(array(select jsonb_array_elements_text(f->'matchingClientIds')::uuid)))
  order by p.entry_date desc,p.id
  limit 500;
end;
$$;
revoke all on function public.search_properties(jsonb) from public,anon;
grant execute on function public.search_properties(jsonb) to authenticated;
