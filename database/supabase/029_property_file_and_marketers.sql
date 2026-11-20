-- Property file ("الواجهة الثانية") redesign requested by the company owner:
--  * marketers sign in with a name and password and can read every property
--  * the property file shows the phone numbers, site type, map and annexes
--  * staff with edit permission can change every property field from the file
--  * dated comments with the marketer's name are kept on each property
--  * a full Excel export of every plot with its phone numbers
--  * phone search also matches numbers stored on the property itself

-- 1) Annexes ("التوابع") field shown in the property file grid.
alter table public.properties add column if not exists annexes text;

-- 2) Site types used by the dropdown in the property file.
insert into public.lookups(type,code,name_ar,name_en) values
  ('location_type',405,'شارعين','Two streets'),
  ('location_type',406,'ثلاث شوارع','Three streets'),
  ('location_type',407,'أربع شوارع','Four streets')
on conflict do nothing;

-- 3) Marketer role: reads every property and client, adds comments.
insert into public.roles(name,name_ar,is_system) values('marketer','مسوق',true) on conflict(name) do nothing;
insert into public.role_permissions(role_id,permission_id,allowed)
select r.id,p.id,(p.module in ('properties','clients','follow_ups','appointments') and p.action='view')
  or (p.module in ('follow_ups','appointments') and p.action='create')
from public.roles r cross join public.permissions p
where r.name='marketer'
on conflict(role_id,permission_id) do nothing;

create or replace function public.can_view_record(owner_id text) returns boolean language sql stable security definer set search_path=public as $$
  select case public.current_app_role()
    when 'super_admin' then true when 'manager' then true when 'viewer' then true when 'accountant' then true
    when 'data_entry' then true when 'marketer' then true
    when 'sales_agent' then owner_id=(auth.uid()::text) or exists(select 1 from profiles me join profiles owner on owner.id=owner_id where me.id=(auth.uid()::text) and me.team_id is not null and me.team_id=owner.team_id)
    when 'call_center' then owner_id=(auth.uid()::text)
    else false end
$$;

-- One place for the property visibility rule used by properties_safe.
create or replace function public.can_view_property(p_property_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.properties p where p.id=p_property_id and p.deleted_at is null
    and public.has_permission('properties','view')
    and (public.can_view_record(p.assigned_to) or public.is_excel_import_property(p.id)))
$$;
revoke all on function public.can_view_property(uuid) from public,anon;
grant execute on function public.can_view_property(uuid) to authenticated;

-- 4) Extra data for the property file: phones (for users allowed to see them) and annexes.
create or replace function public.get_property_file(p_property_id uuid)
returns table(phones text[],phones_visible boolean,annexes text,can_edit boolean)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor_id text:=(auth.uid()::text); visible boolean;
begin
  if actor_id is null or not public.can_view_property(p_property_id) then raise exception 'Property is unavailable'; end if;
  select coalesce(me.phone_visible,false) into visible from public.profiles me where me.id=actor_id and me.is_active;
  visible:=coalesce(visible,false);
  return query
  select case when visible then coalesce(
      (select array_agg(pp.phone order by pp.position) from public.property_phones pp where pp.property_id=p.id),
      (select array_agg(cp.phone order by cp.is_primary desc,cp.phone) from public.client_phones cp where cp.client_id=p.client_id),
      '{}'::text[]) else '{}'::text[] end,
    visible,
    coalesce(p.annexes,'')::text,
    public.has_permission('properties','edit')
  from public.properties p where p.id=p_property_id;
end;
$$;
revoke all on function public.get_property_file(uuid) from public,anon;
grant execute on function public.get_property_file(uuid) to authenticated;

-- 5) Edit every field of the property file in one audited call.
create or replace function public.update_property_file(p_property_id uuid,p_data jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare
  actor_id text:=(auth.uid()::text);
  d jsonb:=coalesce(p_data,'{}'::jsonb);
  prior public.properties%rowtype;
  client_record uuid;
  lookup_record uuid;
  phone_value text;
  phone_index int:=0;
  phone_list text[];
begin
  if actor_id is null or not public.can_view_property(p_property_id) or not public.has_permission('properties','edit') then
    raise exception 'لا تملك صلاحية تعديل بيانات هذا العقار';
  end if;
  select * into prior from public.properties where id=p_property_id for update;

  -- Client name: rename the linked client, or create one when the property has none.
  if d ? 'client' and nullif(trim(d->>'client'),'') is not null then
    if prior.client_id is not null then
      update public.clients set name=trim(d->>'client'),updated_at=now() where id=prior.client_id;
      client_record:=prior.client_id;
    else
      insert into public.clients(name,created_by,assigned_to) values(trim(d->>'client'),actor_id,prior.assigned_to) returning id into client_record;
      update public.properties set client_id=client_record where id=p_property_id;
    end if;
  end if;

  if d ? 'type' then
    lookup_record:=null;
    if nullif(trim(d->>'type'),'') is not null then
      select id into lookup_record from public.lookups where type='property_type' and name_ar=trim(d->>'type') and is_active limit 1;
      if lookup_record is null then raise exception 'نوع العقار غير موجود في القوائم'; end if;
    end if;
    update public.properties set type_id=lookup_record where id=p_property_id;
  end if;
  if d ? 'offer' then
    lookup_record:=null;
    if nullif(trim(d->>'offer'),'') is not null then
      select id into lookup_record from public.lookups where type='offer_type' and name_ar=trim(d->>'offer') and is_active limit 1;
      if lookup_record is null then raise exception 'نوع العرض غير موجود في القوائم'; end if;
    end if;
    update public.properties set offer_type_id=lookup_record where id=p_property_id;
  end if;
  if d ? 'area' then
    lookup_record:=null;
    if nullif(trim(d->>'area'),'') is not null then
      select id into lookup_record from public.lookups where type='area' and name_ar=trim(d->>'area') and is_active limit 1;
      if lookup_record is null then raise exception 'المنطقة غير موجودة في القوائم'; end if;
    end if;
    update public.properties set area_id=lookup_record where id=p_property_id;
  end if;
  if d ? 'locationType' then
    lookup_record:=null;
    if nullif(trim(d->>'locationType'),'') is not null then
      select id into lookup_record from public.lookups where type='location_type' and name_ar=trim(d->>'locationType') and is_active limit 1;
      if lookup_record is null then raise exception 'نوع الموقع غير موجود في القوائم'; end if;
    end if;
    update public.properties set location_type_id=lookup_record where id=p_property_id;
  end if;

  update public.properties set
    block=case when d ? 'block' then nullif(trim(d->>'block'),'') else block end,
    plot=case when d ? 'plot' then nullif(trim(d->>'plot'),'') else plot end,
    street=case when d ? 'street' then nullif(trim(d->>'street'),'') else street end,
    avenue=case when d ? 'avenue' then nullif(trim(d->>'avenue'),'') else avenue end,
    sector=case when d ? 'sector' then nullif(trim(d->>'sector'),'') else sector end,
    distribution=case when d ? 'distribution' then nullif(trim(d->>'distribution'),'') else distribution end,
    floor=case when d ? 'floor' then nullif(trim(d->>'floor'),'') else floor end,
    building_type=case when d ? 'buildingType' then nullif(trim(d->>'buildingType'),'') else building_type end,
    annexes=case when d ? 'annexes' then nullif(trim(d->>'annexes'),'') else annexes end,
    details=case when d ? 'details' then nullif(trim(d->>'details'),'') else details end,
    area_m2=case when d ? 'size' then nullif(trim(d->>'size'),'')::numeric else area_m2 end,
    -- Users who cannot see prices receive null in the UI; never wipe a hidden price.
    asking_price_kwd=case when d ? 'price' and exists(select 1 from public.profiles me where me.id=actor_id and me.price_visible)
      then nullif(trim(d->>'price'),'')::numeric else asking_price_kwd end,
    status=case when d ? 'status' and nullif(trim(d->>'status'),'') is not null then (d->>'status')::public.property_status else status end,
    latitude=case when d ? 'latitude' then nullif(trim(d->>'latitude'),'')::double precision else latitude end,
    longitude=case when d ? 'longitude' then nullif(trim(d->>'longitude'),'')::double precision else longitude end,
    updated_at=now()
  where id=p_property_id;

  -- Phones are only replaced by users who can see them, so hidden numbers are never erased.
  if d ? 'phones' and jsonb_typeof(d->'phones')='array'
     and exists(select 1 from public.profiles me where me.id=actor_id and me.phone_visible) then
    select array_agg(trim(value)) into phone_list from jsonb_array_elements_text(d->'phones') value where nullif(trim(value),'') is not null;
    delete from public.property_phones where property_id=p_property_id;
    foreach phone_value in array coalesce(phone_list,'{}'::text[]) loop
      phone_index:=phone_index+1;
      exit when phone_index>3;
      insert into public.property_phones(property_id,phone,normalized_phone,position)
      values(p_property_id,phone_value,regexp_replace(phone_value,'\D','','g'),phone_index);
    end loop;
  end if;

  insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_data,after_data)
  values(actor_id,'update','property',p_property_id::text,to_jsonb(prior),d-'phones');
end;
$$;
revoke all on function public.update_property_file(uuid,jsonb) from public,anon;
grant execute on function public.update_property_file(uuid,jsonb) to authenticated;

-- 6) Dated comments on the property with the author's (marketer's) name.
create or replace function public.list_property_comments(p_property_id uuid)
returns table(id uuid,body text,author_name text,created_at timestamptz)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if (auth.uid()::text) is null or not public.can_view_property(p_property_id) then raise exception 'Property is unavailable'; end if;
  return query select c.id,c.body,coalesce(p.full_name,'—')::text,c.created_at
    from public.comments c left join public.profiles p on p.id=c.created_by
    where c.property_id=p_property_id order by c.created_at desc limit 500;
end;
$$;
revoke all on function public.list_property_comments(uuid) from public,anon;
grant execute on function public.list_property_comments(uuid) to authenticated;

create or replace function public.add_property_comment(p_property_id uuid,p_body text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare actor_id text:=(auth.uid()::text); comment_id uuid; related_client uuid;
begin
  if actor_id is null or not public.can_view_property(p_property_id) then raise exception 'Property is unavailable'; end if;
  if length(trim(coalesce(p_body,'')))<2 or length(p_body)>2000 then raise exception 'اكتب تعليقاً من حرفين إلى ٢٠٠٠ حرف'; end if;
  select client_id into related_client from public.properties where id=p_property_id;
  insert into public.comments(property_id,client_id,body,created_by) values(p_property_id,related_client,trim(p_body),actor_id) returning id into comment_id;
  return comment_id;
end;
$$;
revoke all on function public.add_property_comment(uuid,text) from public,anon;
grant execute on function public.add_property_comment(uuid,text) to authenticated;

-- 7) Excel export: every visible plot with its numbers, read in pages.
create or replace function public.export_properties(p_offset integer default 0,p_limit integer default 1000)
returns table(code text,client text,phone_1 text,phone_2 text,phone_3 text,type text,offer text,area text,sector text,
  distribution text,block text,plot text,street text,avenue text,location_type text,annexes text,size numeric,price numeric,
  status text,employee text,entry_date date,details text,latitude double precision,longitude double precision)
language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare actor_id text:=(auth.uid()::text); phones_ok boolean; prices_ok boolean;
begin
  if actor_id is null or not public.has_permission('properties','view') then raise exception 'Property view permission is required'; end if;
  select coalesce(me.phone_visible,false),coalesce(me.price_visible,false) into phones_ok,prices_ok from public.profiles me where me.id=actor_id;
  if coalesce(p_offset,0)=0 then
    insert into public.audit_logs(actor_id,action,entity_type,metadata) values(actor_id,'export','property',jsonb_build_object('phones',coalesce(phones_ok,false)));
  end if;
  return query
  with page as materialized (
    select p.id,row_number() over (order by ar.name_ar nulls last,
        nullif(regexp_replace(coalesce(p.block,''),'\D','','g'),'')::numeric nulls last,p.block,
        nullif(regexp_replace(coalesce(p.plot,''),'\D','','g'),'')::numeric nulls last,p.plot,p.id) as n
    from public.properties p
    left join public.lookups ar on ar.id=p.area_id
    where p.deleted_at is null and (public.can_view_record(p.assigned_to) or public.is_excel_import_property(p.id))
    order by n
    offset greatest(coalesce(p_offset,0),0) limit least(greatest(coalesce(p_limit,1000),1),1000)
  )
  select p.code,coalesce(cl.name,'')::text,
    case when phones_ok then ph.list[1] end,case when phones_ok then ph.list[2] end,case when phones_ok then ph.list[3] end,
    coalesce(pt.name_ar,'')::text,coalesce(ot.name_ar,'')::text,coalesce(ar.name_ar,'')::text,coalesce(p.sector,'')::text,
    coalesce(p.distribution,'')::text,coalesce(p.block,'')::text,coalesce(p.plot,'')::text,coalesce(p.street,'')::text,
    coalesce(p.avenue,'')::text,coalesce(lt.name_ar,'')::text,coalesce(p.annexes,'')::text,p.area_m2,
    case when prices_ok then p.asking_price_kwd end,
    case p.status when 'available' then 'متاح' when 'sold' then 'مباع' else 'مفقود' end,
    coalesce(rep.full_name,'')::text,p.entry_date,coalesce(p.details,'')::text,p.latitude,p.longitude
  from page
  join public.properties p on p.id=page.id
  left join public.clients cl on cl.id=p.client_id
  left join public.lookups pt on pt.id=p.type_id
  left join public.lookups ot on ot.id=p.offer_type_id
  left join public.lookups ar on ar.id=p.area_id
  left join public.lookups lt on lt.id=p.location_type_id
  left join public.profiles rep on rep.id=p.assigned_to
  left join lateral (select coalesce(
      (select array_agg(pp.phone order by pp.position) from public.property_phones pp where pp.property_id=p.id),
      (select array_agg(cp.phone order by cp.is_primary desc,cp.phone) from public.client_phones cp where cp.client_id=p.client_id)) as list) ph on true
  order by page.n;
end;
$$;
revoke all on function public.export_properties(integer,integer) from public,anon;
grant execute on function public.export_properties(integer,integer) to authenticated;

-- 8) Phone search: match numbers on the client and on the property itself,
--    ignore a typed +965 prefix, and follow the same visibility as properties_safe.
create or replace function public.find_records_by_phone(p_query text)
returns table(client_id uuid,property_id uuid)
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor_id text:=(auth.uid()::text); normalized text;
begin
  normalized:=regexp_replace(translate(coalesce(p_query,''),'٠١٢٣٤٥٦٧٨٩','0123456789'),'\D','','g');
  if length(normalized)=11 and left(normalized,3)='965' then normalized:=right(normalized,8); end if;
  if actor_id is null then raise exception 'Authentication is required'; end if;
  if length(normalized)<4 then raise exception 'Enter at least four phone digits'; end if;
  if not exists(select 1 from public.profiles where id=actor_id and phone_visible) then raise exception 'Phone search is not enabled for this user'; end if;
  if not public.has_permission('clients','view') and not public.has_permission('properties','view') then raise exception 'Insufficient permission to search'; end if;
  insert into public.audit_logs(actor_id,action,entity_type,metadata)
  values(actor_id,'search','phone',jsonb_build_object('last_four',right(normalized,4)));
  return query
  select c.id,p.id
  from public.client_phones cp
  join public.clients c on c.id=cp.client_id and c.deleted_at is null
  left join public.properties p on p.client_id=c.id and p.deleted_at is null
    and public.has_permission('properties','view')
    and (public.can_view_record(p.assigned_to) or public.is_excel_import_property(p.id))
  where cp.normalized_phone like '%'||normalized||'%' and public.has_permission('clients','view')
  union
  select p.client_id,p.id
  from public.property_phones pp
  join public.properties p on p.id=pp.property_id and p.deleted_at is null
  where pp.normalized_phone like '%'||normalized||'%' and public.has_permission('properties','view')
    and (public.can_view_record(p.assigned_to) or public.is_excel_import_property(p.id))
  limit 1000;
end;
$$;
revoke all on function public.find_records_by_phone(text) from public,anon;
grant execute on function public.find_records_by_phone(text) to authenticated;
