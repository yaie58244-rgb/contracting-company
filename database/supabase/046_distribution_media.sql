-- Photos and maps for a whole distribution (area + sector + التوزيعة). One upload
-- shows in the file of every property in that distribution, so a plan image is not
-- copied into hundreds of property files. A blank sector on either side matches
-- any sector, like the duplicate check.
create table if not exists public.distribution_media (
  id uuid primary key default gen_random_uuid(),
  area_id uuid not null references public.lookups(id),
  sector text,
  street text not null,
  sector_key text not null default '',
  street_key text not null,
  kind text not null check (kind in ('image','map')),
  image_data text not null,
  created_by text references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists distribution_media_key_idx on public.distribution_media(area_id, street_key);
alter table public.distribution_media enable row level security;
revoke all on public.distribution_media from anon, authenticated;

-- Area name → id (active or not, so old properties keep their media).
create or replace function public.area_lookup_id(p_area text)
returns uuid language sql stable security definer set search_path=public,pg_temp as $$
  select id from public.lookups where type='area' and name_ar=trim(p_area) order by is_active desc limit 1
$$;
revoke all on function public.area_lookup_id(text) from public, anon, authenticated;

-- التوزيعات of an area (optionally one sector) with how many properties each has.
create or replace function public.distribution_streets(p_area text, p_sector text default '')
returns table(street text, properties bigint)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_area uuid := public.area_lookup_id(p_area); v_sector text := public.property_key_part(p_sector);
begin
  if (auth.uid()::text) is null or not public.has_permission('properties','view') then raise exception 'Property view permission is required'; end if;
  return query
    select min(p.street)::text, count(*)
    from public.properties p
    where p.deleted_at is null and p.area_id = v_area and public.property_key_part(p.street) <> ''
      and (v_sector = '' or public.property_key_part(p.sector) = v_sector)
    group by public.property_key_part(p.street)
    order by min(p.street);
end;
$$;
revoke all on function public.distribution_streets(text,text) from public, anon;
grant execute on function public.distribution_streets(text,text) to authenticated;

create or replace function public.list_distribution_media(p_area text, p_sector text, p_street text)
returns table(id uuid, kind text, image_data text, sector text, street text, created_at timestamptz, created_by_name text)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if (auth.uid()::text) is null or not public.has_permission('properties','view') then raise exception 'Property view permission is required'; end if;
  return query
    select m.id, m.kind, m.image_data, m.sector, m.street, m.created_at, coalesce(pr.full_name,'—')::text
    from public.distribution_media m left join public.profiles pr on pr.id = m.created_by
    where m.area_id = public.area_lookup_id(p_area)
      and m.street_key = public.property_key_part(p_street)
      and m.sector_key = public.property_key_part(p_sector)
    order by m.created_at;
end;
$$;
revoke all on function public.list_distribution_media(text,text,text) from public, anon;
grant execute on function public.list_distribution_media(text,text,text) to authenticated;

-- Only the owner and managers add or remove distribution media (same people who edit the codes).
create or replace function public.add_distribution_media(p_area text, p_sector text, p_street text, p_kind text, p_image_data text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_area uuid := public.area_lookup_id(p_area); v_id uuid;
begin
  if (auth.uid()::text) is null or public.current_app_role() not in ('super_admin','manager') then raise exception 'إضافة صور التوزيعات لمدير النظام والمديرين بس'; end if;
  if v_area is null then raise exception 'اختار المنطقة الأول'; end if;
  if public.property_key_part(p_street) = '' then raise exception 'اكتب رقم التوزيعة'; end if;
  if p_kind not in ('image','map') then raise exception 'Unsupported media kind'; end if;
  if length(p_image_data) > 4000000 or p_image_data !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' then
    raise exception 'الصورة لازم تكون JPEG أو PNG أو WebP وأقل من 3 ميجا';
  end if;
  if (select count(*) from public.distribution_media m where m.area_id = v_area
        and m.street_key = public.property_key_part(p_street) and m.sector_key = public.property_key_part(p_sector)) >= 12 then
    raise exception 'وصلت لـ ١٢ صورة للتوزيعة دي';
  end if;
  insert into public.distribution_media(area_id, sector, street, sector_key, street_key, kind, image_data, created_by)
  values (v_area, nullif(trim(p_sector),''), trim(p_street), public.property_key_part(p_sector), public.property_key_part(p_street), p_kind, p_image_data, auth.uid()::text)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.add_distribution_media(text,text,text,text,text) from public, anon;
grant execute on function public.add_distribution_media(text,text,text,text,text) to authenticated;

create or replace function public.delete_distribution_media(p_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if (auth.uid()::text) is null or public.current_app_role() not in ('super_admin','manager') then raise exception 'حذف صور التوزيعات لمدير النظام والمديرين بس'; end if;
  delete from public.distribution_media where id = p_id;
end;
$$;
revoke all on function public.delete_distribution_media(uuid) from public, anon;
grant execute on function public.delete_distribution_media(uuid) to authenticated;

-- What a property file shows: the media of its own distribution.
create or replace function public.get_property_distribution_media(p_property_id uuid)
returns table(id uuid, kind text, image_data text, sector text, street text)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if (auth.uid()::text) is null or not public.can_view_property(p_property_id) then raise exception 'Property is unavailable'; end if;
  return query
    select m.id, m.kind, m.image_data, m.sector, m.street
    from public.properties p
    join public.distribution_media m on m.area_id = p.area_id and m.street_key = public.property_key_part(p.street)
    where p.id = p_property_id and public.property_key_part(p.street) <> ''
      and (m.sector_key = public.property_key_part(p.sector) or m.sector_key = '' or public.property_key_part(p.sector) = '')
    order by m.kind desc, m.created_at;
end;
$$;
revoke all on function public.get_property_distribution_media(uuid) from public, anon;
grant execute on function public.get_property_distribution_media(uuid) to authenticated;
