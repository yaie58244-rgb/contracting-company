-- Supabase runs the Data API with an 8 second statement timeout. These changes
-- keep the busiest reads inside that budget after the full production dataset
-- was imported, and fix two ambiguous column references that only fail once the
-- functions are executed on PostgreSQL 15.
--
-- 1) properties_safe no longer uses a security barrier, so the planner can push
--    the ORDER BY / LIMIT into the view and walk the pagination index instead of
--    evaluating the access functions for all 54k rows.
create or replace view public.properties_safe as
select p.id,p.code,p.client_id,p.type_id,p.offer_type_id,p.location_type_id,p.area_id,p.block,p.plot,p.street,p.avenue,p.floor,p.building_type,p.area_m2,
  case when exists(select 1 from public.profiles me where me.id=(auth.uid()::text) and me.price_visible) then p.asking_price_kwd else null::numeric end as asking_price_kwd,
  p.details,p.notes,p.assigned_to,p.created_by,p.status,p.entry_date,p.latitude,p.longitude,p.created_at,p.updated_at,
  (p.latitude is not null and p.longitude is not null) as has_map,
  exists(select 1 from public.property_phones pp where pp.property_id=p.id) as has_contact,
  (p.area_id is not null and (nullif(trim(p.block),'') is not null or nullif(trim(p.plot),'') is not null)) as has_location,
  (select max(c.created_at) from public.comments c where c.property_id=p.id or c.client_id=p.client_id) as last_contact_at,
  p.sector,p.distribution,p.rooms_details,p.source_excel
from public.properties p
where p.deleted_at is null and (public.can_view_record(p.assigned_to) or public.is_excel_import_property(p.id));
grant select on public.properties_safe to authenticated;

-- 2) The permission check does not depend on the row, so bind it once per query
--    instead of re-running the role joins for every phone number.
drop policy if exists "client phones readable by staff" on public.client_phones;
create policy "client phones readable by staff" on public.client_phones for select
using (
  (select public.has_permission('clients','view'))
  and exists(select 1 from public.clients c where c.id=client_phones.client_id and c.deleted_at is null)
);

-- 3) search_clients has an OUT column named id, which made the profile lookup
--    ambiguous as soon as the phone branch ran.
create or replace function public.search_clients(p_filters jsonb default '{}'::jsonb)
returns table(
  id uuid,
  name text,
  source_names text[],
  source text,
  notes text,
  tags text[],
  address jsonb,
  created_at timestamptz,
  assigned_to text,
  claim_employee_id text,
  claim_employee_name text,
  claim_claimed_at timestamptz
)
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  f jsonb:=coalesce(p_filters,'{}'::jsonb);
  client_query text:=nullif(trim(coalesce(f->>'client','')),'');
  phone_query text:=regexp_replace(coalesce(f->>'phone',''),'\D','','g');
  has_filters boolean:=false;
begin
  if (auth.uid()::text) is null or not public.has_permission('clients','view') then
    raise exception 'Client view permission is required';
  end if;
  if phone_query<>'' then
    if length(phone_query)<4 then raise exception 'Enter at least four phone digits'; end if;
    if not exists(select 1 from public.profiles me where me.id=(auth.uid()::text) and me.phone_visible) then
      raise exception 'Phone search is not enabled for this user';
    end if;
    insert into public.audit_logs(actor_id,action,entity_type,metadata)
      values((auth.uid()::text)::text,'search','phone',jsonb_build_object('last_four',right(phone_query,4)));
  end if;
  has_filters:=client_query is not null or phone_query<>'' or nullif(trim(coalesce(f->>'governorate','')),'') is not null
    or nullif(trim(coalesce(f->>'area','')),'') is not null or nullif(trim(coalesce(f->>'sector','')),'') is not null
    or nullif(trim(coalesce(f->>'distribution','')),'') is not null or nullif(trim(coalesce(f->>'block','')),'') is not null
    or nullif(trim(coalesce(f->>'details','')),'') is not null or nullif(trim(coalesce(f->>'notes','')),'') is not null;
  if not has_filters then return; end if;
  return query
  select c.id,c.name,c.source_names,c.source,c.notes,c.tags,c.address,c.created_at,c.assigned_to,
    active_claim.employee_id,rep.full_name,active_claim.claimed_at
  from public.clients c
  left join public.client_claims active_claim on active_claim.client_id=c.id and active_claim.released_at is null
  left join public.profiles rep on rep.id=active_claim.employee_id
  where c.deleted_at is null
    and (client_query is null or concat_ws(' ',c.name,array_to_string(c.source_names,' '),c.source,c.notes,c.tags::text,c.address::text) ilike '%'||client_query||'%')
    and (nullif(trim(coalesce(f->>'governorate','')),'') is null or coalesce(c.address->>'governorate','') ilike '%'||trim(f->>'governorate')||'%')
    and (nullif(trim(coalesce(f->>'area','')),'') is null or coalesce(c.address->>'area','') ilike '%'||trim(f->>'area')||'%')
    and (nullif(trim(coalesce(f->>'sector','')),'') is null or coalesce(c.address->>'sector','') ilike '%'||trim(f->>'sector')||'%')
    and (nullif(trim(coalesce(f->>'distribution','')),'') is null or coalesce(c.address->>'distribution','') ilike '%'||trim(f->>'distribution')||'%')
    and (nullif(trim(coalesce(f->>'block','')),'') is null or coalesce(c.address->>'block','') ilike '%'||trim(f->>'block')||'%')
    and (nullif(trim(coalesce(f->>'details','')),'') is null or concat_ws(' ',c.notes,c.address::text) ilike '%'||trim(f->>'details')||'%')
    and (nullif(trim(coalesce(f->>'notes','')),'') is null or concat_ws(' ',c.notes,c.address::text) ilike '%'||trim(f->>'notes')||'%')
    and (phone_query='' or exists(select 1 from public.client_phones cp where cp.client_id=c.id and cp.normalized_phone like '%'||phone_query||'%'))
  order by c.created_at desc,c.id
  limit 500;
end;
$$;
revoke all on function public.search_clients(jsonb) from public,anon;
grant execute on function public.search_clients(jsonb) to authenticated;

-- 4) The notification cleanup used the OUT column created_at inside a DELETE,
--    which is ambiguous with notifications.created_at.
create or replace function public.list_my_notifications()
returns table(id uuid,type text,title text,body text,link text,read_at timestamptz,created_at timestamptz,deleted_at timestamptz)
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if (auth.uid()::text) is null then raise exception 'Authentication is required'; end if;
  delete from public.notifications n where n.user_id=(auth.uid()::text) and n.created_at<now()-interval '60 days';
  return query select n.id,n.type,n.title,n.body,n.link,n.read_at,n.created_at,n.deleted_at
    from public.notifications n where n.user_id=(auth.uid()::text) order by n.created_at desc limit 500;
end;
$$;
revoke all on function public.list_my_notifications() from public,anon;
grant execute on function public.list_my_notifications() to authenticated;
