-- Store the original export alongside normalized fields so no source column is lost.
alter table public.properties
  add column if not exists rooms_details text,
  add column if not exists source_excel jsonb not null default '{}'::jsonb;

alter table public.clients
  add column if not exists source_names text[] not null default '{}';

alter table public.property_phones
  drop constraint if exists property_phones_position_check;
alter table public.property_phones
  add constraint property_phones_position_check check(position between 1 and 5);

create table if not exists public.excel_import_batches (
  id uuid primary key default gen_random_uuid(),
  file_sha256 text not null unique,
  file_name text not null,
  sheet_name text not null,
  source_rows integer not null,
  blank_rows integer not null,
  unique_properties integer not null,
  exact_duplicate_rows integer not null,
  client_groups integer not null,
  imported_by text not null references public.profiles(id),
  imported_at timestamptz not null default now()
);

create table if not exists public.excel_import_rows (
  batch_id uuid not null references public.excel_import_batches(id) on delete cascade,
  source_row_number integer not null,
  row_fingerprint text not null,
  client_id uuid not null references public.clients(id),
  property_id uuid not null references public.properties(id),
  is_exact_duplicate boolean not null default false,
  source_data jsonb not null,
  primary key(batch_id,source_row_number)
);
create index if not exists excel_import_rows_property_idx on public.excel_import_rows(property_id);
create index if not exists excel_import_rows_client_idx on public.excel_import_rows(client_id);

alter table public.excel_import_rows enable row level security;
create or replace function public.is_excel_import_property(p_property_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.has_permission('properties','view') and exists(
    select 1 from public.excel_import_rows r where r.property_id=p_property_id
  )
$$;
revoke all on function public.is_excel_import_property(uuid) from public,anon;
grant execute on function public.is_excel_import_property(uuid) to authenticated;

-- Share only imported properties with roles that already have property view access.
drop policy if exists "properties scoped read" on public.properties;
create policy "properties scoped read" on public.properties for select
using(deleted_at is null and (public.can_view_record(assigned_to) or public.is_excel_import_property(id)));

drop policy if exists "property phones visible to authorized roles" on public.property_phones;
create policy "property phones visible to authorized roles" on public.property_phones for select
using(exists(select 1 from public.properties p join public.profiles me on me.id=(auth.uid()::text)
  where p.id=property_id and (public.can_view_record(p.assigned_to) or public.is_excel_import_property(p.id)) and me.phone_visible));

-- Keep the existing row security scope unchanged. The original columns are
-- appended to the safe view; existing RLS policies still decide who can see them.
create or replace view public.properties_safe with (security_barrier=true) as
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

create or replace function public.reveal_property_contact(p_property_id uuid,p_comment text)
returns table(phone text,phone_position smallint)
language plpgsql security definer set search_path=public,pg_temp as $$
declare owner_id text; related_client uuid; actor_id text:=(auth.uid()::text); comment_record uuid;
begin
  if actor_id is null then raise exception 'Authentication is required'; end if;
  if length(trim(coalesce(p_comment,'')))<3 then raise exception 'اكتب سبب التواصل قبل عرض رقم العقار'; end if;
  select p.assigned_to,p.client_id into owner_id,related_client from public.properties p where p.id=p_property_id and p.deleted_at is null;
  if not found or not public.has_permission('properties','view')
    or not (public.can_view_record(owner_id) or public.is_excel_import_property(p_property_id)) then raise exception 'Property is unavailable'; end if;
  if not exists(select 1 from public.profiles me where me.id=actor_id and me.phone_visible) then raise exception 'Phone access is not enabled for this user'; end if;
  insert into public.comments(property_id,client_id,body,created_by) values(p_property_id,related_client,trim(p_comment),actor_id) returning id into comment_record;
  insert into public.contact_access_logs(viewer_id,property_id,comment_id) values(actor_id,p_property_id,comment_record);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata) values(actor_id,'contact_view','property',p_property_id::text,jsonb_build_object('comment_id',comment_record));
  return query select pp.phone,pp.position from public.property_phones pp where pp.property_id=p_property_id order by pp.position;
end;
$$;
revoke all on function public.reveal_property_contact(uuid,text) from public,anon;
grant execute on function public.reveal_property_contact(uuid,text) to authenticated;
