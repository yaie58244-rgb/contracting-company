-- Each area has its own sectors (جنوب المطلاع: N1-N12, مدينة صباح الأحمد: A1-E4,
-- ...). The pairs come from the properties themselves (the imported Excel
-- sheet), so the sector dropdown only offers the chosen area's sectors and a
-- new pair appears as soon as a property is saved with it.
create index if not exists properties_area_sector_idx on public.properties(area_id,sector) where deleted_at is null and sector is not null;

create or replace function public.area_sectors()
returns table(area text, sector text)
language sql stable security definer set search_path=public,pg_temp as $$
  select distinct a.name_ar::text, trim(p.sector)::text
  from public.properties p join public.lookups a on a.id=p.area_id
  where (auth.uid()::text) is not null and p.deleted_at is null and nullif(trim(p.sector),'') is not null
  order by 1,2
$$;
revoke all on function public.area_sectors() from public,anon;
grant execute on function public.area_sectors() to authenticated;

-- Search: sector matches exactly instead of "contains".
create or replace function public.search_properties_page(p_filters jsonb default '{}'::jsonb,p_offset integer default 0,p_limit integer default 200)
returns table(
  id uuid, code text, client text, phones text[], type text, offer text, area text,
  sector text, distribution text, block text, plot text, street text, avenue text,
  floor text, building_type text, rooms_details text, source_excel jsonb,
  source_search text, location_type text, size numeric, price numeric, employee text,
  status public.property_status, date date, details text, latitude double precision,
  longitude double precision, has_map boolean, has_contact boolean, has_location boolean,
  last_contact_at timestamptz, total_count bigint
)
language plpgsql stable security definer set search_path=public,pg_temp as $fn$
declare
  f jsonb:=coalesce(p_filters,'{}'::jsonb);
  price_ok boolean;
  conds text[]:=array['true'];
  k text; expr text; q text; digits_q text; search_join text:='';
  text_fields constant jsonb:=jsonb_build_object(
    'client','cl.name','code','p.code',
    'governorate','cl.address->>''governorate''','distribution','p.distribution',
    'employee','rep.full_name','details','concat_ws('' '',p.details,p.rooms_details,p.source_excel->>''التفاصيل'',p.source_excel->>''ملاحظات'',p.source_excel->>''تفاصيل الغرف'')',
    'notes','concat_ws('' '',p.notes,cl.notes,cl.address::text)');
  -- Lookup fields match the ~80 lookup names first, so properties are filtered by id
  -- (index on area_id) instead of normalizing a joined name on all 54k rows.
  lookup_fields constant jsonb:=jsonb_build_object('type','p.type_id','offer','p.offer_type_id','locationType','p.location_type_id','area','p.area_id');
  number_fields constant jsonb:=jsonb_build_object('block','p.block','plot','p.plot','street','p.street','avenue','p.avenue');
begin
  if (auth.uid()::text) is null or not public.has_permission('properties','view') then raise exception 'Property view permission is required'; end if;
  select exists(select 1 from public.profiles x where x.id=(auth.uid()::text) and x.price_visible) into price_ok;

  -- Text fields: normalized "contains".
  for k,expr in select key,value from jsonb_each_text(text_fields) loop
    q:=public.norm_ar(f->>k);
    if q<>'' then conds:=conds||format('public.norm_ar(%s) like %L',expr,'%'||replace(replace(q,'%','\%'),'_','\_')||'%'); end if;
  end loop;
  for k,expr in select key,value from jsonb_each_text(lookup_fields) loop
    q:=public.norm_ar(f->>k);
    if q<>'' then conds:=conds||format('%s in (select lk.id from public.lookups lk where public.norm_ar(lk.name_ar) like %L)',expr,'%'||replace(replace(q,'%','\%'),'_','\_')||'%'); end if;
  end loop;
  -- Sector is picked from a list, so it matches exactly (N1 must not also bring N10, N11, N12).
  q:=public.norm_ar(f->>'sector');
  if q<>'' then conds:=conds||format('public.norm_ar(p.sector)=%L',q); end if;
  -- Number-like fields: a typed number matches whole numbers only (1 ≠ 11, 1 = 001 = 1+2).
  for k,expr in select key,value from jsonb_each_text(number_fields) loop
    q:=public.norm_ar(f->>k);
    if q='' then continue; end if;
    if q ~ '^[0-9]+$' then
      digits_q:=ltrim(q,'0');
      conds:=conds||format('public.norm_ar(%s) ~ %L',expr,'(^|[^0-9])'||case when digits_q='' then '0+' else '0*'||digits_q end||'([^0-9]|$)');
    else
      conds:=conds||format('public.norm_ar(%s) like %L',expr,'%'||replace(replace(q,'%','\%'),'_','\_')||'%');
    end if;
  end loop;
  -- Comments the reps wrote on the property ("لا يرد", ...), normalized "contains".
  q:=public.norm_ar(f->>'comments');
  if q<>'' then
    conds:=conds||format('p.id in (select cm.property_id from public.comments cm where cm.property_id is not null and public.norm_ar(cm.body) like %L)',
      '%'||replace(replace(q,'%','\%'),'_','\_')||'%');
  end if;
  -- Free text across every column and the original Excel row (prepared text),
  -- plus the live names of the client, lookups and employee.
  q:=public.norm_ar(f->>'all');
  if q<>'' then
    search_join:='left join public.property_search ps on ps.property_id=p.id';
    conds:=conds||format('(ps.body like %1$L or public.norm_ar(concat_ws('' '',cl.name,pt.name_ar,ot.name_ar,lt.name_ar,ar.name_ar,rep.full_name,%2$s)) like %1$L)',
      '%'||replace(replace(q,'%','\%'),'_','\_')||'%',case when price_ok then 'p.asking_price_kwd' else 'null' end);
  end if;
  if nullif(trim(f->>'sizeMin'),'') is not null then conds:=conds||format('p.area_m2>=%L::numeric',f->>'sizeMin'); end if;
  if nullif(trim(f->>'sizeMax'),'') is not null then conds:=conds||format('p.area_m2<=%L::numeric',f->>'sizeMax'); end if;
  if nullif(trim(f->>'priceMin'),'') is not null then conds:=conds||case when price_ok then format('p.asking_price_kwd>=%L::numeric',f->>'priceMin') else 'false' end; end if;
  if nullif(trim(f->>'priceMax'),'') is not null then conds:=conds||case when price_ok then format('p.asking_price_kwd<=%L::numeric',f->>'priceMax') else 'false' end; end if;
  if nullif(trim(f->>'dateFrom'),'') is not null then conds:=conds||format('p.entry_date>=%L::date',f->>'dateFrom'); end if;
  if nullif(trim(f->>'dateTo'),'') is not null then conds:=conds||format('p.entry_date<=%L::date',f->>'dateTo'); end if;
  if nullif(trim(f->>'status'),'') is not null then
    conds:=conds||format('p.status::text=%L',case trim(f->>'status') when 'متاح' then 'available' when 'مباع' then 'sold' when 'مفقود' then 'lost' else trim(f->>'status') end);
  end if;
  if f ? 'matchingPropertyIds' or f ? 'matchingClientIds' then
    conds:=conds||format('(p.id=any(%L::uuid[]) or p.client_id=any(%L::uuid[]))',
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(f->'matchingPropertyIds','[]')) x),'{}'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(f->'matchingClientIds','[]')) x),'{}'));
  end if;

  return query execute format($q$
    with candidates as materialized (
      select p.id,p.entry_date,count(*) over() as total
      from public.properties_safe p
      left join public.clients cl on cl.id=p.client_id
      left join public.lookups pt on pt.id=p.type_id
      left join public.lookups ot on ot.id=p.offer_type_id
      left join public.lookups ar on ar.id=p.area_id
      left join public.lookups lt on lt.id=p.location_type_id
      left join public.profiles rep on rep.id=p.assigned_to
      %s
      where %s
      order by p.entry_date desc,p.id
      offset %s limit %s
    )
    select p.id,p.code,coalesce(cl.name,'غير مسجل')::text,'{}'::text[],
      coalesce(pt.name_ar,'غير محدد')::text,coalesce(ot.name_ar,'—')::text,coalesce(ar.name_ar,'غير محدد')::text,
      coalesce(p.sector,'')::text,coalesce(p.distribution,'')::text,coalesce(p.block,'')::text,
      coalesce(p.plot,'')::text,coalesce(p.street,'')::text,coalesce(p.avenue,'')::text,
      coalesce(p.floor,'')::text,coalesce(p.building_type,'')::text,coalesce(p.rooms_details,'')::text,
      '{}'::jsonb,''::text,coalesce(lt.name_ar,'')::text,
      coalesce(p.area_m2,0)::numeric,p.asking_price_kwd,
      coalesce(rep.full_name,'غير معيّن')::text,
      p.status,p.entry_date,coalesce(p.details,'')::text,p.latitude,p.longitude,p.has_map,
      p.has_contact,p.has_location,p.last_contact_at,c.total
    from candidates c
    join public.properties_safe p on p.id=c.id
    left join public.clients cl on cl.id=p.client_id
    left join public.lookups pt on pt.id=p.type_id
    left join public.lookups ot on ot.id=p.offer_type_id
    left join public.lookups ar on ar.id=p.area_id
    left join public.lookups lt on lt.id=p.location_type_id
    left join public.profiles rep on rep.id=p.assigned_to
    order by c.entry_date desc,c.id
  $q$,search_join,array_to_string(conds,' and '),greatest(coalesce(p_offset,0),0),least(greatest(coalesce(p_limit,200),1),5000));
end;
$fn$;
revoke all on function public.search_properties_page(jsonb,integer,integer) from public,anon;
grant execute on function public.search_properties_page(jsonb,integer,integer) to authenticated;
