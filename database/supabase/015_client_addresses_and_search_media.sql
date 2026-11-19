alter table public.clients
  add column if not exists address jsonb not null default '{}'::jsonb;

insert into public.lookups(type,code,name_ar,name_en)
select 'governorate',code,name_ar,name_en from (values
  (501,'العاصمة','Capital'),(502,'حولي','Hawally'),(503,'الفروانية','Farwaniya'),
  (504,'الأحمدي','Ahmadi'),(505,'مبارك الكبير','Mubarak Al-Kabeer'),(506,'الجهراء','Jahra')
) as g(code,name_ar,name_en)
where not exists(select 1 from public.lookups l where l.type='governorate' and l.name_ar=g.name_ar)
on conflict(type,code) do nothing;

create or replace function public.create_client_with_address(payload jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare client_record_id uuid; address_data jsonb;
begin
  client_record_id:=public.create_client_with_phones(payload);
  address_data:=coalesce(payload->'address','{}'::jsonb);
  if jsonb_typeof(address_data)<>'object' then raise exception 'Client address must be an object'; end if;
  update public.clients set address=jsonb_build_object(
    'governorate',left(coalesce(address_data->>'governorate',''),100),
    'area',left(coalesce(address_data->>'area',''),120),
    'sector',left(coalesce(address_data->>'sector',''),80),
    'distribution',left(coalesce(address_data->>'distribution',''),80),
    'block',left(coalesce(address_data->>'block',''),40),
    'street',left(coalesce(address_data->>'street',''),160),
    'avenue',left(coalesce(address_data->>'avenue',''),100),
    'building',left(coalesce(address_data->>'building',''),80),
    'floor',left(coalesce(address_data->>'floor',''),40),
    'apartment',left(coalesce(address_data->>'apartment',''),40),
    'postalCode',left(coalesce(address_data->>'postalCode',''),30),
    'landmark',left(coalesce(address_data->>'landmark',''),240)
  ) where id=client_record_id;
  return client_record_id;
end;
$$;
revoke all on function public.create_client_with_address(jsonb) from public,anon;
grant execute on function public.create_client_with_address(jsonb) to authenticated;

create or replace function public.create_property_with_image(payload jsonb,image_data text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare property_record_id uuid;
begin
  if image_data is not null and (
    length(image_data)>2000000 or
    image_data !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$'
  ) then raise exception 'Property image must be a compressed JPEG, PNG, or WebP image under 1.5 MB'; end if;
  property_record_id:=public.create_property_with_client(payload);
  if image_data is not null then
    insert into public.property_images(property_id,storage_path,caption,sort_order)
    values(property_record_id,image_data,'صورة العقار',0);
  end if;
  return property_record_id;
end;
$$;
revoke all on function public.create_property_with_image(jsonb,text) from public,anon;
grant execute on function public.create_property_with_image(jsonb,text) to authenticated;

create or replace function public.get_property_images(p_property_id uuid)
returns table(storage_path text,caption text,sort_order integer)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare owner_id text;
begin
  select assigned_to into owner_id from public.properties where id=p_property_id and deleted_at is null;
  if not found or (auth.uid()::text) is null or not public.can_view_record(owner_id) or not public.has_permission('properties','view') then
    raise exception 'Property is unavailable';
  end if;
  return query select i.storage_path,i.caption,i.sort_order
    from public.property_images i where i.property_id=p_property_id order by i.sort_order,i.created_at limit 12;
end;
$$;
revoke all on function public.get_property_images(uuid) from public,anon;
grant execute on function public.get_property_images(uuid) to authenticated;

create or replace function public.find_records_by_phone(p_query text)
returns table(client_id uuid,property_id uuid)
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor_id text:=(auth.uid()::text); normalized text;
begin
  normalized:=regexp_replace(coalesce(p_query,''),'\D','','g');
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
    and public.can_view_record(p.assigned_to) and public.has_permission('properties','view')
  where cp.normalized_phone like '%'||normalized||'%'
    and public.can_view_record(c.assigned_to) and public.has_permission('clients','view')
  union
  select p.client_id,p.id
  from public.property_phones pp join public.properties p on p.id=pp.property_id and p.deleted_at is null
  where pp.normalized_phone like '%'||normalized||'%'
    and public.can_view_record(p.assigned_to) and public.has_permission('properties','view');
end;
$$;
revoke all on function public.find_records_by_phone(text) from public,anon;
grant execute on function public.find_records_by_phone(text) to authenticated;
