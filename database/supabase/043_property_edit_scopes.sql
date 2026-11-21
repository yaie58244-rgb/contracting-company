-- The owner picks, per employee, which parts of the property file they may edit:
--   info (client, type, offer, area, sector, block, plot, street, size, annexes),
--   price, phones, location_type, status, map, images.
-- profiles.property_edit_scopes is null to follow the role (everything or
-- nothing), or the list of allowed parts ({} = nothing). It replaces the
-- allow/deny setting from 039/041, which is carried over here.
-- Also: the system admin's (super_admin) role can't be changed and the account
-- can't be switched off, so the owner never locks themself out.

alter table public.profiles add column if not exists property_edit_scopes text[];

create or replace function public.property_edit_scope_names() returns text[]
language sql immutable as $$ select array['info','price','phones','location_type','status','map','images'] $$;

update public.profiles set property_edit_scopes=case when can_edit_property then public.property_edit_scope_names() else '{}'::text[] end,
  can_edit_property=null
where can_edit_property is not null;

-- properties:edit is true when the person may edit at least one part.
create or replace function public.has_permission(p_module text,p_action text) returns boolean
language sql stable security definer set search_path=public as $$
  select case
    when p_module='properties' and p_action='edit'
      and (select me.property_edit_scopes from profiles me where me.id=(auth.uid()::text) and me.is_active) is not null
      then coalesce(cardinality((select me.property_edit_scopes from profiles me where me.id=(auth.uid()::text) and me.is_active)),0)>0
    when public.current_app_role() in ('super_admin','manager') then true
    else exists(select 1 from profiles p join roles r on r.id=p.role_id join role_permissions rp on rp.role_id=r.id
      join permissions x on x.id=rp.permission_id
      where p.id=(auth.uid()::text) and p.is_active and rp.allowed and x.module=p_module and x.action=p_action)
  end
$$;

-- The parts of the property file the signed-in user may edit.
create or replace function public.my_property_edit_scopes() returns text[]
language sql stable security definer set search_path=public,pg_temp as $$
  select case
    when (auth.uid()::text) is null then '{}'::text[]
    when (select me.property_edit_scopes from public.profiles me where me.id=(auth.uid()::text) and me.is_active) is not null
      then (select me.property_edit_scopes from public.profiles me where me.id=(auth.uid()::text) and me.is_active)
    when public.has_permission('properties','edit') then public.property_edit_scope_names()
    else '{}'::text[]
  end
$$;
revoke all on function public.my_property_edit_scopes() from public,anon;
grant execute on function public.my_property_edit_scopes() to authenticated;

-- Property file saves: every changed part must be allowed. The original
-- function keeps doing the work under a new name only this wrapper may call.
alter function public.update_property_file(uuid,jsonb) rename to update_property_file_all;
revoke all on function public.update_property_file_all(uuid,jsonb) from public,anon,authenticated;

create function public.update_property_file(p_property_id uuid,p_data jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare
  allowed text[]:=public.my_property_edit_scopes();
  k text; part text;
  labels constant jsonb:=jsonb_build_object('info','البيانات','price','السعر','phones','أرقام التليفون','location_type','نوع الموقع','status','الحالة','map','الخريطة');
begin
  for k in select jsonb_object_keys(coalesce(p_data,'{}'::jsonb)) loop
    part:=case
      when k in ('price') then 'price'
      when k in ('phones') then 'phones'
      when k in ('locationType') then 'location_type'
      when k in ('status') then 'status'
      when k in ('latitude','longitude') then 'map'
      else 'info' end;
    if not part=any(allowed) then
      raise exception 'لا تملك صلاحية تعديل % في ملف العقار',labels->>part;
    end if;
  end loop;
  perform public.update_property_file_all(p_property_id,p_data);
end;
$$;
revoke all on function public.update_property_file(uuid,jsonb) from public,anon;
grant execute on function public.update_property_file(uuid,jsonb) to authenticated;

-- Older single-purpose edit functions are no longer used by the app and don't
-- know the parts above, so only the database owner may call them.
revoke execute on function public.update_property_status(uuid,public.property_status) from authenticated;
revoke execute on function public.update_property_map(uuid,double precision,double precision) from authenticated;
do $$ begin
  execute (select string_agg(format('revoke execute on function %s from authenticated',p.oid::regprocedure),'; ')
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='update_property_location');
end $$;

-- Images need the "images" part.
create or replace function public.add_property_image(p_property_id uuid,p_image_data text,p_caption text default null)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare actor_id text:=(auth.uid()::text); image_id uuid; next_order integer;
begin
  if actor_id is null or not public.can_view_property(p_property_id) or not 'images'=any(public.my_property_edit_scopes()) then
    raise exception 'لا تملك صلاحية تعديل صور هذا العقار';
  end if;
  if p_image_data is null or length(p_image_data)>2000000 or p_image_data !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' then
    raise exception 'الصورة لازم تكون JPG أو PNG أو WebP وحجمها أقل من ١٫٥ ميجا';
  end if;
  if (select count(*) from public.property_images where property_id=p_property_id)>=12 then
    raise exception 'العقار فيه ١٢ صورة، احذف صورة الأول';
  end if;
  select coalesce(max(sort_order),-1)+1 into next_order from public.property_images where property_id=p_property_id;
  insert into public.property_images(property_id,storage_path,caption,sort_order)
  values(p_property_id,p_image_data,coalesce(nullif(trim(p_caption),''),'صورة العقار'),next_order)
  returning id into image_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_data)
  values(actor_id,'create','property_image',image_id::text,jsonb_build_object('property_id',p_property_id));
  return image_id;
end;
$$;

create or replace function public.delete_property_image(p_image_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare actor_id text:=(auth.uid()::text); owner_property uuid;
begin
  select property_id into owner_property from public.property_images where id=p_image_id;
  if not found then raise exception 'الصورة مش موجودة'; end if;
  if actor_id is null or not public.can_view_property(owner_property) or not 'images'=any(public.my_property_edit_scopes()) then
    raise exception 'لا تملك صلاحية تعديل صور هذا العقار';
  end if;
  delete from public.property_images where id=p_image_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_data)
  values(actor_id,'delete','property_image',p_image_id::text,jsonb_build_object('property_id',owner_property));
end;
$$;

-- The property file tells the app which parts this user may edit.
drop function if exists public.get_property_file(uuid);
create function public.get_property_file(p_property_id uuid)
returns table(phones text[],phones_visible boolean,annexes text,can_edit boolean,source_excel jsonb,entered_by_name text,edit_scopes text[])
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor_id text:=(auth.uid()::text); visible boolean; scopes text[];
begin
  if actor_id is null or not public.can_view_property(p_property_id) then raise exception 'Property is unavailable'; end if;
  select coalesce(me.phone_visible,false) into visible from public.profiles me where me.id=actor_id and me.is_active;
  visible:=coalesce(visible,false);
  scopes:=public.my_property_edit_scopes();
  return query
  select case when visible then coalesce(
      (select array_agg(pp.phone order by pp.position) from public.property_phones pp where pp.property_id=p.id),
      (select array_agg(cp.phone order by cp.is_primary desc,cp.phone) from public.client_phones cp where cp.client_id=p.client_id),
      '{}'::text[]) else '{}'::text[] end,
    visible,
    coalesce(p.annexes,'')::text,
    cardinality(scopes)>0,
    coalesce(p.source_excel,'{}'::jsonb),
    (select e.full_name from public.profiles e where e.id=p.entered_by)::text,
    scopes
  from public.properties p where p.id=p_property_id;
end;
$$;
revoke all on function public.get_property_file(uuid) from public,anon;
grant execute on function public.get_property_file(uuid) to authenticated;

-- Users page: 'role' follows the role, 'allow' / 'deny' = everything / nothing,
-- or p_property_edit_scopes picks the parts. The system admin's role and
-- active state can't be changed.
drop function if exists public.update_employee_profile(text,uuid,boolean,boolean,boolean,boolean,text);
create function public.update_employee_profile(
  p_profile_id text,p_role_id uuid default null,p_is_active boolean default null,
  p_phone_visible boolean default null,p_price_visible boolean default null,p_can_add_property boolean default null,
  p_can_edit_property text default null,p_property_edit_scopes text[] default null
)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare target_role text; scopes text[];
begin
  if (auth.uid()::text) is null or not public.has_permission('users','edit') then raise exception 'User edit permission is required'; end if;
  if p_role_id is not null and not exists(select 1 from public.roles where id=p_role_id) then raise exception 'Role is unavailable'; end if;
  if p_can_edit_property is not null and p_can_edit_property not in ('role','allow','deny') then raise exception 'Unknown property edit setting'; end if;
  select r.name into target_role from public.profiles p join public.roles r on r.id=p.role_id where p.id=p_profile_id;
  if target_role='super_admin' and ((p_role_id is not null and p_role_id<>(select role_id from public.profiles where id=p_profile_id)) or p_is_active=false) then
    raise exception 'لا يمكن تغيير دور مدير النظام أو إيقاف حسابه';
  end if;
  if p_property_edit_scopes is not null then
    select coalesce(array_agg(distinct s order by s),'{}') into scopes from unnest(p_property_edit_scopes) s where s=any(public.property_edit_scope_names());
  end if;
  update public.profiles set role_id=coalesce(p_role_id,role_id),is_active=coalesce(p_is_active,is_active),
    phone_visible=coalesce(p_phone_visible,phone_visible),price_visible=coalesce(p_price_visible,price_visible),
    can_add_property=coalesce(p_can_add_property,can_add_property),
    property_edit_scopes=case
      when p_property_edit_scopes is not null then scopes
      when p_can_edit_property='role' then null
      when p_can_edit_property='allow' then public.property_edit_scope_names()
      when p_can_edit_property='deny' then '{}'::text[]
      else property_edit_scopes end,
    updated_at=now()
  where id=p_profile_id;
  if not found then raise exception 'Employee profile was not found'; end if;
end;
$$;
revoke all on function public.update_employee_profile(text,uuid,boolean,boolean,boolean,boolean,text,text[]) from public,anon;
grant execute on function public.update_employee_profile(text,uuid,boolean,boolean,boolean,boolean,text,text[]) to authenticated;
