-- Offers added by staff, and a daily activity report:
--  * the owner can let any employee add offers (profiles.can_add_property),
--    even when their role has no "create" permission
--  * each offer records the marketer who brought it (properties.entered_by),
--    picked from a dropdown of staff names; the property file shows the name
--  * staff_activity_report counts each employee's comments and the offers
--    they commented on per day, for any date range

alter table public.profiles add column if not exists can_add_property boolean not null default false;
alter table public.properties add column if not exists entered_by text references public.profiles(id) on delete set null;
create index if not exists properties_entered_by_idx on public.properties(entered_by) where entered_by is not null;
create index if not exists comments_created_by_created_at_idx on public.comments(created_by,created_at) where property_id is not null;

create or replace function public.can_add_property() returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select (auth.uid()::text) is not null and (public.has_permission('properties','create')
    or exists(select 1 from public.profiles me where me.id=(auth.uid()::text) and me.is_active and me.can_add_property))
$$;
revoke all on function public.can_add_property() from public,anon;
grant execute on function public.can_add_property() to authenticated;

create or replace function public.create_property_with_client(payload jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
  actor_id text := (auth.uid()::text);
  client_record_id uuid;
  client_owner_id text;
  property_record_id uuid;
  assigned_record_id text;
  type_record_id uuid;
  offer_record_id uuid;
  area_record_id uuid;
  location_record_id uuid;
  phone_value text;
  phone_normalized text;
  entered_record_id text;
begin
  -- Staff the owner switched on in the users page may add offers even if their role can't.
  if actor_id is null or not (public.can_add_property() and (public.has_permission('clients','create') or exists(select 1 from public.profiles me where me.id=actor_id and me.can_add_property))) then
    raise exception 'Insufficient permission to create a property';
  end if;
  if nullif(trim(payload->>'code'),'') is null or nullif(trim(payload->>'client'),'') is null then
    raise exception 'Property code and client name are required';
  end if;

  assigned_record_id := actor_id;
  if nullif(payload->>'employee','') is not null and payload->>'employee' <> 'غير معيّن' then
    select id into assigned_record_id from public.profiles where full_name=payload->>'employee' and is_active limit 1;
    if assigned_record_id is null then raise exception 'Assigned employee was not found'; end if;
    if assigned_record_id <> actor_id and (not public.has_permission('properties','assign') or not public.can_view_record(assigned_record_id)) then
      raise exception 'Insufficient permission to assign this property';
    end if;
  end if;

  -- The marketer who brought the offer, picked from the staff list; defaults to whoever saves it.
  entered_record_id := actor_id;
  if nullif(payload->>'entered_by','') is not null then
    select id into entered_record_id from public.profiles where id=payload->>'entered_by' and is_active;
    if entered_record_id is null then raise exception 'The marketer who added the offer was not found'; end if;
  end if;

  select id into type_record_id from public.lookups where type='property_type' and name_ar=payload->>'type' and is_active;
  select id into offer_record_id from public.lookups where type='offer_type' and name_ar=payload->>'offer' and is_active;
  select id into area_record_id from public.lookups where type='area' and name_ar=payload->>'area' and is_active;
  select id into location_record_id from public.lookups where type='location_type' and name_ar=payload->>'location_type' and is_active;

  for phone_value in select jsonb_array_elements_text(coalesce(payload->'phones','[]'::jsonb)) loop
    phone_normalized := regexp_replace(phone_value,'\D','','g');
    if left(phone_normalized,3)='965' then phone_normalized := substring(phone_normalized from 4); end if;
    select cp.client_id,c.assigned_to into client_record_id,client_owner_id from public.client_phones cp join public.clients c on c.id=cp.client_id where cp.normalized_phone=phone_normalized limit 1;
    exit when client_record_id is not null;
  end loop;

  if client_record_id is not null and not public.can_view_record(client_owner_id) then
    raise exception 'You cannot link a client outside your assigned data scope';
  end if;

  if client_record_id is null then
    insert into public.clients(name,assigned_to,created_by)
    values(trim(payload->>'client'),assigned_record_id,actor_id) returning id into client_record_id;
  end if;
  for phone_value in select jsonb_array_elements_text(coalesce(payload->'phones','[]'::jsonb)) loop
    phone_normalized := regexp_replace(phone_value,'\D','','g');
    if left(phone_normalized,3)='965' then phone_normalized := substring(phone_normalized from 4); end if;
    if phone_normalized <> '' then
      insert into public.client_phones(client_id,phone,normalized_phone,is_primary)
      values(client_record_id,phone_value,phone_normalized,not exists(select 1 from public.client_phones where client_id=client_record_id))
      on conflict(client_id,normalized_phone) do nothing;
    end if;
  end loop;

  insert into public.properties(code,client_id,type_id,offer_type_id,location_type_id,area_id,block,plot,street,area_m2,asking_price_kwd,details,assigned_to,created_by,entered_by)
  values(trim(payload->>'code'),client_record_id,type_record_id,offer_record_id,location_record_id,area_record_id,nullif(payload->>'block',''),nullif(payload->>'plot',''),nullif(payload->>'street',''),nullif(payload->>'size','')::numeric,nullif(payload->>'price','')::numeric,nullif(payload->>'details',''),assigned_record_id,actor_id,entered_record_id)
  returning id into property_record_id;

  for phone_value in select jsonb_array_elements_text(coalesce(payload->'phones','[]'::jsonb)) loop
    phone_normalized := regexp_replace(phone_value,'\D','','g');
    if left(phone_normalized,3)='965' then phone_normalized := substring(phone_normalized from 4); end if;
    if phone_normalized <> '' then
      insert into public.property_phones(property_id,phone,normalized_phone,position)
      values(property_record_id,phone_value,phone_normalized,(select count(*)+1 from public.property_phones where property_id=property_record_id))
      on conflict(property_id,position) do nothing;
    end if;
  end loop;
  return property_record_id;
end;
$$;
revoke all on function public.create_property_with_client(jsonb) from public, anon;
grant execute on function public.create_property_with_client(jsonb) to authenticated;

-- Staff names for the "who added it" dropdown (marketers can't read other profiles).
create or replace function public.list_staff_names()
returns table(id text, full_name text)
language sql stable security definer set search_path=public,pg_temp as $$
  select p.id,p.full_name from public.profiles p
  where (auth.uid()::text) is not null and p.is_active and nullif(trim(p.full_name),'') is not null
  order by p.full_name
$$;
revoke all on function public.list_staff_names() from public,anon;
grant execute on function public.list_staff_names() to authenticated;

-- my_permissions also reports the per-employee "may add offers" switch as properties:create.
create or replace function public.my_permissions()
returns table(role text, module text, action text)
language sql stable security definer set search_path=public,pg_temp as $$
  select r.name::text, x.module::text, x.action::text
  from public.profiles p
  join public.roles r on r.id=p.role_id
  left join public.role_permissions rp on rp.role_id=r.id and rp.allowed
  left join public.permissions x on x.id=rp.permission_id
  where p.id=(auth.uid()::text) and p.is_active
  union
  select r.name::text,'properties','create'
  from public.profiles p join public.roles r on r.id=p.role_id
  where p.id=(auth.uid()::text) and p.is_active and p.can_add_property
$$;

-- The users page switch.
drop function if exists public.update_employee_profile(text,uuid,boolean,boolean,boolean);
create function public.update_employee_profile(
  p_profile_id text,p_role_id uuid default null,p_is_active boolean default null,
  p_phone_visible boolean default null,p_price_visible boolean default null,p_can_add_property boolean default null
)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if (auth.uid()::text) is null or not public.has_permission('users','edit') then raise exception 'User edit permission is required'; end if;
  if p_role_id is not null and not exists(select 1 from public.roles where id=p_role_id) then raise exception 'Role is unavailable'; end if;
  update public.profiles set role_id=coalesce(p_role_id,role_id),is_active=coalesce(p_is_active,is_active),
    phone_visible=coalesce(p_phone_visible,phone_visible),price_visible=coalesce(p_price_visible,price_visible),
    can_add_property=coalesce(p_can_add_property,can_add_property),updated_at=now()
  where id=p_profile_id;
  if not found then raise exception 'Employee profile was not found'; end if;
end;
$$;
revoke all on function public.update_employee_profile(text,uuid,boolean,boolean,boolean,boolean) from public,anon;
grant execute on function public.update_employee_profile(text,uuid,boolean,boolean,boolean,boolean) to authenticated;

-- The property file shows who added the offer.
drop function if exists public.get_property_file(uuid);
create function public.get_property_file(p_property_id uuid)
returns table(phones text[],phones_visible boolean,annexes text,can_edit boolean,source_excel jsonb,entered_by_name text)
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
    public.has_permission('properties','edit'),
    coalesce(p.source_excel,'{}'::jsonb),
    (select e.full_name from public.profiles e where e.id=p.entered_by)::text
  from public.properties p where p.id=p_property_id;
end;
$$;
revoke all on function public.get_property_file(uuid) from public,anon;
grant execute on function public.get_property_file(uuid) to authenticated;

-- Activity per employee between two days (Kuwait time). An offer counts as worked
-- on only when the employee commented on it, once per day; opening it is not enough.
create or replace function public.staff_activity_report(p_from date,p_to date)
returns table(employee_id text,employee_name text,role_name text,comments bigint,offers_worked bigint,offers_added bigint,active_days bigint,last_comment_at timestamptz)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if (auth.uid()::text) is null or not (public.has_permission('reports','view') or public.has_permission('users','view')) then
    raise exception 'Report permission is required';
  end if;
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>400 then raise exception 'Choose a date range of up to 400 days'; end if;
  return query
  with c as (
    select cm.created_by,cm.property_id,cm.created_at,(cm.created_at at time zone 'Asia/Kuwait')::date as day
    from public.comments cm
    where cm.property_id is not null
      and cm.created_at>=(p_from::timestamp at time zone 'Asia/Kuwait')
      and cm.created_at<((p_to+1)::timestamp at time zone 'Asia/Kuwait')
  ), per_person as (
    select c.created_by,count(*) as comments,count(distinct (c.property_id,c.day)) as offers_worked,count(distinct c.day) as active_days,max(c.created_at) as last_comment_at
    from c group by c.created_by
  ), added as (
    select pr.entered_by,count(*) as offers_added from public.properties pr
    where pr.entered_by is not null and pr.deleted_at is null
      and pr.created_at>=(p_from::timestamp at time zone 'Asia/Kuwait')
      and pr.created_at<((p_to+1)::timestamp at time zone 'Asia/Kuwait')
    group by pr.entered_by
  )
  select p.id,p.full_name::text,coalesce(r.name_ar,r.name)::text,coalesce(pp.comments,0)::bigint,coalesce(pp.offers_worked,0)::bigint,coalesce(a.offers_added,0)::bigint,coalesce(pp.active_days,0)::bigint,pp.last_comment_at
  from public.profiles p
  left join public.roles r on r.id=p.role_id
  left join per_person pp on pp.created_by=p.id
  left join added a on a.entered_by=p.id
  where p.is_active or pp.comments is not null or a.offers_added is not null
  order by coalesce(pp.offers_worked,0) desc,coalesce(pp.comments,0) desc,p.full_name;
end;
$$;
revoke all on function public.staff_activity_report(date,date) from public,anon;
grant execute on function public.staff_activity_report(date,date) to authenticated;
