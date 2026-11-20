-- Search returned at most 500 properties and compared text literally, so an
-- area with 19k plots showed 500, "صباح الأحمد" missed "صباح الاحمد", and
-- block "1" also matched 10, 11, 21. This version:
--  * returns every match in pages, with the total count on each row
--  * compares Arabic text after normalizing hamza/alef, ya, ta marbuta,
--    diacritics, Arabic digits and spaces
--  * matches a number typed in block/plot/street/avenue as a whole number
--    (block "1" matches "1" and "1+2", not "11"; street "1" matches "001")
--  * builds the WHERE clause from the filled-in filters only

create or replace function public.norm_ar(t text) returns text
language sql immutable parallel safe as $$
  select lower(regexp_replace(
    translate(coalesce(t,''),'أإآٱىة٠١٢٣٤٥٦٧٨٩ـًٌٍَُِّْ','اااايه0123456789'),
    '\s+','','g'))
$$;

-- Normalized search text per property (own fields + every value from the
-- original Excel row), kept in a side table so the free-text search compares
-- prepared text instead of normalizing ~37 MB of Excel data on every search.
-- A side table avoids rewriting all properties (and their audit trigger).
create table if not exists public.property_search(
  property_id uuid primary key references public.properties(id) on delete cascade,
  body text not null
);
alter table public.property_search enable row level security;
revoke all on public.property_search from public,anon,authenticated;

create or replace function public.property_search_body(p public.properties) returns text
language sql stable set search_path=public,pg_temp as $$
  select public.norm_ar(concat_ws(' ',p.code,p.block,p.plot,p.street,p.avenue,p.sector,p.distribution,p.floor,
    p.building_type,p.rooms_details,p.details,p.notes,p.annexes,p.area_m2,p.entry_date,
    (select string_agg(e.value,' ') from jsonb_each_text(coalesce(p.source_excel,'{}'::jsonb)) e
      where e.value not like 'محفوظ ضمن%')))
$$;

create or replace function public.refresh_property_search() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into public.property_search(property_id,body) values(new.id,public.property_search_body(new))
  on conflict (property_id) do update set body=excluded.body;
  return null;
end;
$$;
drop trigger if exists properties_refresh_search on public.properties;
create trigger properties_refresh_search after insert or update on public.properties
  for each row execute function public.refresh_property_search();

insert into public.property_search(property_id,body)
select p.id,public.property_search_body(p) from public.properties p
on conflict (property_id) do update set body=excluded.body;

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
    'client','cl.name','code','p.code','type','pt.name_ar','offer','ot.name_ar','locationType','lt.name_ar',
    'governorate','cl.address->>''governorate''','area','ar.name_ar','sector','p.sector','distribution','p.distribution',
    'employee','rep.full_name','details','concat_ws('' '',p.details,p.rooms_details,p.source_excel->>''التفاصيل'',p.source_excel->>''ملاحظات'',p.source_excel->>''تفاصيل الغرف'')',
    'notes','concat_ws('' '',p.notes,cl.notes,cl.address::text)');
  number_fields constant jsonb:=jsonb_build_object('block','p.block','plot','p.plot','street','p.street','avenue','p.avenue');
begin
  if (auth.uid()::text) is null or not public.has_permission('properties','view') then raise exception 'Property view permission is required'; end if;
  select exists(select 1 from public.profiles x where x.id=(auth.uid()::text) and x.price_visible) into price_ok;

  -- Text fields: normalized "contains".
  for k,expr in select key,value from jsonb_each_text(text_fields) loop
    q:=public.norm_ar(f->>k);
    if q<>'' then conds:=conds||format('public.norm_ar(%s) like %L',expr,'%'||replace(replace(q,'%','\%'),'_','\_')||'%'); end if;
  end loop;
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
      p.source_excel,coalesce(p.source_excel::text,'')::text,coalesce(lt.name_ar,'')::text,
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
  $q$,search_join,array_to_string(conds,' and '),greatest(coalesce(p_offset,0),0),least(greatest(coalesce(p_limit,200),1),1000));
end;
$fn$;
revoke all on function public.search_properties_page(jsonb,integer,integer) from public,anon;
grant execute on function public.search_properties_page(jsonb,integer,integer) to authenticated;
