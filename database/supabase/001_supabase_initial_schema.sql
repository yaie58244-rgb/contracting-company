-- Aqar Kuwait: normalized core schema and tenant-aware row security.
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create type public.app_role as enum ('super_admin','manager','sales_agent','call_center','data_entry','accountant','viewer');
create type public.property_status as enum ('available','sold','lost');

create table public.roles (id uuid primary key default gen_random_uuid(), name text not null unique, name_ar text not null, is_system boolean not null default false, created_at timestamptz not null default now());
-- profiles.id is text because the app treats auth identities as strings, while
-- Supabase Auth stores uuid ids. auth_user_id keeps the referential
-- link to auth.users and cascades profile deletion with the auth user.
create table public.profiles (id text primary key, auth_user_id uuid unique references auth.users(id) on delete cascade, full_name text not null, email text not null, role_id uuid references public.roles(id), manager_id text references public.profiles(id), team_id uuid, is_active boolean not null default true, phone_visible boolean not null default false, price_visible boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.permissions (id uuid primary key default gen_random_uuid(), module text not null, action text not null, unique(module,action));
create table public.role_permissions (role_id uuid not null references public.roles(id) on delete cascade, permission_id uuid not null references public.permissions(id) on delete cascade, allowed boolean not null default false, primary key(role_id,permission_id));

create table public.lookups (id uuid primary key default gen_random_uuid(), type text not null, code integer not null, name_ar text not null, name_en text, is_active boolean not null default true, created_at timestamptz not null default now(), unique(type,code), unique(type,name_ar));
create table public.clients (id uuid primary key default gen_random_uuid(), name text not null, source text, notes text, tags text[] not null default '{}', assigned_to text references public.profiles(id), created_by text not null references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz);
create table public.client_phones (id uuid primary key default gen_random_uuid(), client_id uuid not null references public.clients(id) on delete cascade, phone text not null, normalized_phone text not null, label text, is_primary boolean not null default false, unique(client_id,normalized_phone));
create index client_phones_normalized_idx on public.client_phones(normalized_phone);
create table public.properties (id uuid primary key default gen_random_uuid(), code text not null unique, client_id uuid references public.clients(id), type_id uuid references public.lookups(id), offer_type_id uuid references public.lookups(id), location_type_id uuid references public.lookups(id), area_id uuid references public.lookups(id), block text, plot text, street text, avenue text, floor text, building_type text, area_m2 numeric(12,2) check(area_m2 is null or area_m2>=0), asking_price_kwd numeric(15,3) check(asking_price_kwd is null or asking_price_kwd>=0), details text, notes text, assigned_to text references public.profiles(id), created_by text not null references public.profiles(id), status public.property_status not null default 'available', entry_date date not null default current_date, latitude double precision, longitude double precision, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz);
create index properties_search_trgm on public.properties using gin (code gin_trgm_ops, block gin_trgm_ops, plot gin_trgm_ops);
create index properties_area_status_idx on public.properties(area_id,status,entry_date desc);
create index properties_assigned_idx on public.properties(assigned_to,entry_date desc);
create index properties_price_idx on public.properties(asking_price_kwd) where deleted_at is null;
create table public.property_phones (id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties(id) on delete cascade, phone text not null, normalized_phone text not null, position smallint not null default 1 check(position between 1 and 3), unique(property_id,position));
create index property_phones_normalized_idx on public.property_phones(normalized_phone);
create table public.property_images (id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties(id) on delete cascade, storage_path text not null, caption text, sort_order integer not null default 0, created_at timestamptz not null default now());
create table public.property_documents (id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties(id) on delete cascade, storage_path text not null, file_name text not null, content_type text, created_by text references public.profiles(id), created_at timestamptz not null default now());
create table public.requests (id uuid primary key default gen_random_uuid(), client_id uuid not null references public.clients(id), type_id uuid references public.lookups(id), area_id uuid references public.lookups(id), min_size numeric(12,2), max_size numeric(12,2), min_price numeric(15,3), max_price numeric(15,3), notes text, assigned_to text references public.profiles(id), status text not null default 'open', created_by text not null references public.profiles(id), created_at timestamptz not null default now());
create table public.matches (id uuid primary key default gen_random_uuid(), request_id uuid not null references public.requests(id) on delete cascade, property_id uuid not null references public.properties(id) on delete cascade, score numeric(5,2) not null, notified_at timestamptz, created_at timestamptz not null default now(), unique(request_id,property_id));
create table public.follow_ups (id uuid primary key default gen_random_uuid(), client_id uuid references public.clients(id), property_id uuid references public.properties(id), assigned_to text not null references public.profiles(id), due_at timestamptz not null, title text not null, notes text, completed_at timestamptz, created_by text not null references public.profiles(id), created_at timestamptz not null default now());
create table public.appointments (id uuid primary key default gen_random_uuid(), client_id uuid references public.clients(id), property_id uuid references public.properties(id), assigned_to text not null references public.profiles(id), starts_at timestamptz not null, ends_at timestamptz, title text not null, location text, notes text, created_by text not null references public.profiles(id), created_at timestamptz not null default now());
create table public.comments (id uuid primary key default gen_random_uuid(), property_id uuid references public.properties(id) on delete cascade, client_id uuid references public.clients(id) on delete cascade, body text not null, mentions text[] not null default '{}', created_by text not null references public.profiles(id), created_at timestamptz not null default now(), check(property_id is not null or client_id is not null));
create table public.favorites (user_id text not null references public.profiles(id) on delete cascade, property_id uuid not null references public.properties(id) on delete cascade, created_at timestamptz not null default now(), primary key(user_id,property_id));
create table public.ads (id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties(id) on delete cascade, platform text not null, published_at date, cost_kwd numeric(12,3), status text not null default 'draft', url text, notes text, created_by text not null references public.profiles(id), created_at timestamptz not null default now());
create table public.audit_logs (id bigint generated always as identity primary key, actor_id text references public.profiles(id), action text not null, entity_type text not null, entity_id text, before_data jsonb, after_data jsonb, metadata jsonb not null default '{}', ip_hash text, created_at timestamptz not null default now());
create index audit_logs_created_idx on public.audit_logs(created_at desc);
create table public.notifications (id uuid primary key default gen_random_uuid(), user_id text not null references public.profiles(id) on delete cascade, type text not null, title text not null, body text, link text, read_at timestamptz, created_at timestamptz not null default now());
create table public.saved_filters (id uuid primary key default gen_random_uuid(), user_id text not null references public.profiles(id) on delete cascade, name text not null, filters jsonb not null, is_shared boolean not null default false, created_at timestamptz not null default now());

create table public.import_batches (id uuid primary key default gen_random_uuid(), created_by text not null references public.profiles(id), file_name text not null, storage_path text, target text not null, duplicate_strategy text not null default 'skip' check(duplicate_strategy in ('skip','update','create_anyway')), status text not null default 'staged', total_rows integer not null default 0, created_count integer not null default 0, updated_count integer not null default 0, skipped_count integer not null default 0, failed_count integer not null default 0, rollback_until timestamptz not null default now()+interval '30 days', started_at timestamptz, completed_at timestamptz, created_at timestamptz not null default now());
create table public.import_rows (id bigint generated always as identity primary key, batch_id uuid not null references public.import_batches(id) on delete cascade, row_number integer not null, raw_row jsonb not null, mapped_row jsonb, status text not null default 'pending', error_message text, entity_id uuid, before_data jsonb, created_at timestamptz not null default now(), processed_at timestamptz, unique(batch_id,row_number));
create index import_rows_resume_idx on public.import_rows(batch_id,status,row_number);
create table public.import_mappings (id uuid primary key default gen_random_uuid(), user_id text not null references public.profiles(id) on delete cascade, name text not null, target text not null, mapping jsonb not null, created_at timestamptz not null default now());
create table public.value_mappings (id uuid primary key default gen_random_uuid(), lookup_type text not null, source_value text not null, lookup_id uuid not null references public.lookups(id), created_by text references public.profiles(id), created_at timestamptz not null default now(), unique(lookup_type,source_value));

create or replace function public.current_app_role() returns text language sql stable security definer set search_path=public as $$ select r.name from profiles p join roles r on r.id=p.role_id where p.id=(auth.uid()::text) and p.is_active $$;
create or replace function public.can_view_record(owner_id text) returns boolean language sql stable security definer set search_path=public as $$ select case public.current_app_role() when 'super_admin' then true when 'manager' then true when 'viewer' then true when 'accountant' then true when 'data_entry' then true when 'sales_agent' then owner_id=(auth.uid()::text) or exists(select 1 from profiles me join profiles owner on owner.id=owner_id where me.id=(auth.uid()::text) and me.team_id is not null and me.team_id=owner.team_id) when 'call_center' then owner_id=(auth.uid()::text) else false end $$;
create or replace function public.has_permission(p_module text,p_action text) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from profiles p join roles r on r.id=p.role_id join role_permissions rp on rp.role_id=r.id join permissions x on x.id=rp.permission_id where p.id=(auth.uid()::text) and p.is_active and rp.allowed and x.module=p_module and x.action=p_action) or public.current_app_role() in ('super_admin','manager') $$;
create or replace function public.audit_row_change() returns trigger language plpgsql security definer set search_path=public as $$ begin insert into audit_logs(actor_id,action,entity_type,entity_id,before_data,after_data) values((auth.uid()::text),lower(tg_op),tg_table_name,coalesce(new.id::text,old.id::text),case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end); return coalesce(new,old); end $$;

-- Profiles and role grants are never client-editable. Keep authorization in PostgreSQL.
alter table profiles enable row level security; alter table roles enable row level security; alter table permissions enable row level security; alter table role_permissions enable row level security;
alter table lookups enable row level security; alter table clients enable row level security; alter table client_phones enable row level security; alter table properties enable row level security; alter table property_phones enable row level security; alter table property_images enable row level security; alter table property_documents enable row level security; alter table requests enable row level security; alter table matches enable row level security; alter table follow_ups enable row level security; alter table appointments enable row level security; alter table comments enable row level security; alter table favorites enable row level security; alter table ads enable row level security; alter table audit_logs enable row level security; alter table notifications enable row level security; alter table saved_filters enable row level security; alter table import_batches enable row level security; alter table import_rows enable row level security; alter table import_mappings enable row level security; alter table value_mappings enable row level security;

create policy "profiles self or managers read" on profiles for select using(id=(auth.uid()::text) or current_app_role() in ('super_admin','manager'));
create policy "profiles manager update" on profiles for update using(current_app_role()='super_admin');
create policy "roles readable by authenticated" on roles for select to authenticated using(true);
create policy "permissions readable by authenticated" on permissions for select to authenticated using(true);
create policy "role permissions admin only" on role_permissions for all using(current_app_role()='super_admin') with check(current_app_role()='super_admin');
create policy "active lookups readable" on lookups for select to authenticated using(is_active or current_app_role() in ('super_admin','manager'));
create policy "lookup admins edit" on lookups for all using(current_app_role() in ('super_admin','manager')) with check(current_app_role() in ('super_admin','manager'));
create policy "clients scoped read" on clients for select using(deleted_at is null and can_view_record(assigned_to));
create policy "clients scoped create" on clients for insert with check((auth.uid()::text)=created_by and has_permission('clients','create'));
create policy "clients scoped update" on clients for update using(can_view_record(assigned_to) and has_permission('clients','edit')) with check(can_view_record(assigned_to));
create policy "clients scoped delete" on clients for delete using(current_app_role() in ('super_admin','manager') and has_permission('clients','delete'));
create policy "client phones visible to authorized roles" on client_phones for select using(exists(select 1 from clients c join profiles me on me.id=(auth.uid()::text) where c.id=client_id and can_view_record(c.assigned_to) and me.phone_visible));
create policy "client phones scoped insert" on client_phones for insert with check(exists(select 1 from clients c where c.id=client_id and can_view_record(c.assigned_to)));
create policy "client phones scoped update" on client_phones for update using(exists(select 1 from clients c where c.id=client_id and can_view_record(c.assigned_to))) with check(exists(select 1 from clients c where c.id=client_id and can_view_record(c.assigned_to)));
create policy "client phones scoped delete" on client_phones for delete using(exists(select 1 from clients c where c.id=client_id and can_view_record(c.assigned_to)));
create policy "properties scoped read" on properties for select using(deleted_at is null and can_view_record(assigned_to));
create policy "properties scoped create" on properties for insert with check((auth.uid()::text)=created_by and has_permission('properties','create'));
create policy "properties scoped update" on properties for update using(can_view_record(assigned_to) and has_permission('properties','edit')) with check(can_view_record(assigned_to));
create policy "properties scoped delete" on properties for delete using(current_app_role() in ('super_admin','manager') and has_permission('properties','delete'));
create policy "property phones visible to authorized roles" on property_phones for select using(exists(select 1 from properties p join profiles me on me.id=(auth.uid()::text) where p.id=property_id and can_view_record(p.assigned_to) and me.phone_visible));
create policy "property phones scoped insert" on property_phones for insert with check(exists(select 1 from properties p where p.id=property_id and can_view_record(p.assigned_to)));
create policy "property phones scoped update" on property_phones for update using(exists(select 1 from properties p where p.id=property_id and can_view_record(p.assigned_to))) with check(exists(select 1 from properties p where p.id=property_id and can_view_record(p.assigned_to)));
create policy "property phones scoped delete" on property_phones for delete using(exists(select 1 from properties p where p.id=property_id and can_view_record(p.assigned_to)));
create policy "property images scoped" on property_images for all using(exists(select 1 from properties p where p.id=property_id and can_view_record(p.assigned_to))) with check(exists(select 1 from properties p where p.id=property_id and can_view_record(p.assigned_to)));
create policy "property documents scoped" on property_documents for all using(exists(select 1 from properties p where p.id=property_id and can_view_record(p.assigned_to))) with check(exists(select 1 from properties p where p.id=property_id and can_view_record(p.assigned_to)));
create policy "requests scoped" on requests for all using(can_view_record(assigned_to)) with check((auth.uid()::text)=created_by or current_app_role() in ('super_admin','manager'));
create policy "matches scoped" on matches for select using(exists(select 1 from requests r where r.id=request_id and can_view_record(r.assigned_to)));
create policy "followups assigned" on follow_ups for all using(can_view_record(assigned_to)) with check(can_view_record(assigned_to));
create policy "appointments assigned" on appointments for all using(can_view_record(assigned_to)) with check(can_view_record(assigned_to));
create policy "comments scoped read" on comments for select using((property_id is not null and exists(select 1 from properties p where p.id=property_id and can_view_record(p.assigned_to))) or (client_id is not null and exists(select 1 from clients c where c.id=client_id and can_view_record(c.assigned_to))));
create policy "comments scoped write" on comments for insert with check((auth.uid()::text)=created_by);
create policy "favorites owner" on favorites for all using(user_id=(auth.uid()::text)) with check(user_id=(auth.uid()::text));
create policy "ads scoped read" on ads for select using(exists(select 1 from properties p where p.id=property_id and can_view_record(p.assigned_to)));
create policy "ads scoped create" on ads for insert with check((auth.uid()::text)=created_by and has_permission('ads','create') and exists(select 1 from properties p where p.id=property_id and can_view_record(p.assigned_to)));
create policy "ads scoped update" on ads for update using(has_permission('ads','edit') and exists(select 1 from properties p where p.id=property_id and can_view_record(p.assigned_to))) with check(exists(select 1 from properties p where p.id=property_id and can_view_record(p.assigned_to)));
create policy "ads scoped delete" on ads for delete using(has_permission('ads','delete'));
create policy "audit admins read" on audit_logs for select using(current_app_role() in ('super_admin','manager'));
create policy "notifications owner" on notifications for all using(user_id=(auth.uid()::text)) with check(user_id=(auth.uid()::text));
create policy "saved filters owner or shared" on saved_filters for select using(user_id=(auth.uid()::text) or is_shared);
create policy "saved filters manage own" on saved_filters for all using(user_id=(auth.uid()::text)) with check(user_id=(auth.uid()::text));
create policy "import batches scoped" on import_batches for select using(created_by=(auth.uid()::text) or current_app_role() in ('super_admin','manager'));
create policy "import batch writer" on import_batches for insert with check((auth.uid()::text)=created_by and has_permission('imports','import'));
create policy "import batch admin update" on import_batches for update using(created_by=(auth.uid()::text) or current_app_role() in ('super_admin','manager'));
create policy "import rows batch scope" on import_rows for select using(exists(select 1 from import_batches b where b.id=batch_id and (b.created_by=(auth.uid()::text) or current_app_role() in ('super_admin','manager'))));
create policy "import rows batch writer" on import_rows for all using(exists(select 1 from import_batches b where b.id=batch_id and b.created_by=(auth.uid()::text) and has_permission('imports','import'))) with check(exists(select 1 from import_batches b where b.id=batch_id and b.created_by=(auth.uid()::text) and has_permission('imports','import')));
create policy "mapping owner" on import_mappings for all using(user_id=(auth.uid()::text)) with check(user_id=(auth.uid()::text));
create policy "value mapping authenticated read" on value_mappings for select to authenticated using(true);
create policy "value mapping admin write" on value_mappings for all using(current_app_role() in ('super_admin','manager','data_entry')) with check(current_app_role() in ('super_admin','manager','data_entry'));

create trigger clients_audit after insert or update or delete on clients for each row execute function audit_row_change();
create trigger properties_audit after insert or update or delete on properties for each row execute function audit_row_change();
create trigger requests_audit after insert or update or delete on requests for each row execute function audit_row_change();

insert into roles(name,name_ar,is_system) values ('super_admin','مدير النظام',true),('manager','مدير',true),('sales_agent','مندوب مبيعات',true),('call_center','مركز الاتصال',true),('data_entry','مدخل بيانات',true),('accountant','محاسب',true),('viewer','مشاهد',true) on conflict(name) do nothing;
insert into permissions(module,action) select m,a from unnest(array['properties','clients','requests','follow_ups','appointments','ads','reports','imports','lookups','users','audit']) m cross join unnest(array['view','create','edit','delete','export','import','assign']) a on conflict do nothing;
insert into role_permissions(role_id,permission_id,allowed) select r.id,p.id,case when r.name in ('super_admin','manager') then true when r.name='data_entry' then p.action in ('view','create','edit','import') when r.name='sales_agent' then p.action in ('view','create','edit','assign') and p.module in ('properties','clients','requests','follow_ups','appointments') when r.name='call_center' then p.action in ('view','create','edit') and p.module in ('clients','follow_ups','appointments') when r.name='accountant' then p.action in ('view','export') and p.module in ('properties','reports') else p.action='view' end from roles r cross join permissions p on conflict(role_id,permission_id) do nothing;
insert into lookups(type,code,name_ar,name_en) values
 ('area',101,'الأندلس','Al-Andalus'),('area',102,'الروضة','Al-Rawda'),('area',103,'صباح الأحمد','Sabah Al-Ahmad'),('area',104,'السليبخات','Al-Sulaibikhat'),('area',105,'العارضية','Al-Ardiya'),('area',106,'شرق','Sharq'),('area',107,'السالمية','Salmiya'),('area',108,'حولي','Hawally'),('area',109,'الفروانية','Farwaniya'),('area',110,'الجابرية','Jabriya'),('property_type',201,'أرض','Land'),('property_type',202,'بيت','House'),('property_type',203,'شقة','Apartment'),('property_type',204,'تجاري','Commercial'),('offer_type',301,'للبيع','For sale'),('offer_type',302,'للإيجار','For rent'),('offer_type',303,'للبدل','For exchange'),('offer_type',304,'مطلوب شراء','Wanted to buy'),('location_type',401,'زاوية شارعين','Corner'),('location_type',402,'بطن وظهر','Back-to-back'),('location_type',403,'ثلاث جهات','Three sides'),('location_type',404,'شارع واحد','Single street') on conflict(type,code) do nothing;

-- Supabase Auth identities are string IDs. Create a least-privileged profile on first authenticated use.
create or replace function public.bootstrap_current_profile()
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare auth_user auth.users%rowtype; new_name text;
begin
  if (auth.uid()::text) is null then raise exception 'Authentication is required'; end if;
  select * into auth_user from auth.users where id=(auth.uid()::text)::uuid;
  if not found then raise exception 'Auth user was not found'; end if;
  new_name:=coalesce(nullif(coalesce(auth_user.raw_user_meta_data->>'name',''),''),split_part(auth_user.email,'@',1));
  insert into public.profiles(id,auth_user_id,full_name,email,role_id)
  select auth_user.id::text,auth_user.id,new_name,auth_user.email,r.id from public.roles r where r.name='viewer'
  on conflict(id) do update set email=excluded.email,full_name=coalesce(nullif(public.profiles.full_name,''),excluded.full_name);
  return auth_user.id::text;
end;
$$;
revoke all on function public.bootstrap_current_profile() from public,anon;
grant execute on function public.bootstrap_current_profile() to authenticated;
-- Transactional property creation helper used by the authenticated app.
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
begin
  if actor_id is null or not public.has_permission('properties','create') or not public.has_permission('clients','create') then
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

  insert into public.properties(code,client_id,type_id,offer_type_id,location_type_id,area_id,block,plot,street,area_m2,asking_price_kwd,details,assigned_to,created_by)
  values(trim(payload->>'code'),client_record_id,type_record_id,offer_record_id,location_record_id,area_record_id,nullif(payload->>'block',''),nullif(payload->>'plot',''),nullif(payload->>'street',''),nullif(payload->>'size','')::numeric,nullif(payload->>'price','')::numeric,nullif(payload->>'details',''),assigned_record_id,actor_id)
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

create or replace function public.create_client_with_phones(payload jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
  actor_id text := (auth.uid()::text);
  client_record_id uuid;
  phone_value text;
  phone_normalized text;
  existing_owner uuid;
begin
  if actor_id is null or not public.has_permission('clients','create') then
    raise exception 'Insufficient permission to create a client';
  end if;
  if nullif(trim(payload->>'name'),'') is null then
    raise exception 'Client name is required';
  end if;

  for phone_value in select jsonb_array_elements_text(coalesce(payload->'phones','[]'::jsonb)) loop
    phone_normalized := regexp_replace(phone_value,'\D','','g');
    if left(phone_normalized,3)='965' then phone_normalized := substring(phone_normalized from 4); end if;
    if phone_normalized <> '' then
      select c.id,c.assigned_to into client_record_id,existing_owner
      from public.client_phones cp join public.clients c on c.id=cp.client_id
      where cp.normalized_phone=phone_normalized and c.deleted_at is null limit 1;
      if client_record_id is not null then
        if public.can_view_record(existing_owner) then raise exception 'A client with this phone already exists';
        else raise exception 'This phone is already registered'; end if;
      end if;
    end if;
  end loop;

  insert into public.clients(name,source,notes,tags,assigned_to,created_by)
  values(trim(payload->>'name'),nullif(payload->>'source',''),nullif(payload->>'notes',''),coalesce(array(select jsonb_array_elements_text(payload->'tags')),'{}'),actor_id,actor_id)
  returning id into client_record_id;
  for phone_value in select jsonb_array_elements_text(coalesce(payload->'phones','[]'::jsonb)) loop
    phone_normalized := regexp_replace(phone_value,'\D','','g');
    if left(phone_normalized,3)='965' then phone_normalized := substring(phone_normalized from 4); end if;
    if phone_normalized <> '' then
      insert into public.client_phones(client_id,phone,normalized_phone,is_primary)
      values(client_record_id,phone_value,phone_normalized,not exists(select 1 from public.client_phones where client_id=client_record_id));
    end if;
  end loop;
  return client_record_id;
end;
$$;
revoke all on function public.create_client_with_phones(jsonb) from public, anon;
grant execute on function public.create_client_with_phones(jsonb) to authenticated;

-- Price visibility is enforced by a safe view and column grants, not by UI masking.
create or replace view public.properties_safe with (security_barrier=true) as
select p.id,p.code,p.client_id,p.type_id,p.offer_type_id,p.location_type_id,p.area_id,p.block,p.plot,p.street,p.avenue,p.floor,p.building_type,p.area_m2,
  case when exists(select 1 from public.profiles me where me.id=(auth.uid()::text) and me.price_visible) then p.asking_price_kwd else null::numeric end as asking_price_kwd,
  p.details,p.notes,p.assigned_to,p.created_by,p.status,p.entry_date,p.latitude,p.longitude,p.created_at,p.updated_at
from public.properties p
where p.deleted_at is null and public.can_view_record(p.assigned_to);
revoke select on public.properties from anon,authenticated;
grant select(id,code,client_id,type_id,offer_type_id,location_type_id,area_id,block,plot,street,avenue,floor,building_type,area_m2,details,notes,assigned_to,created_by,status,entry_date,latitude,longitude,created_at,updated_at,deleted_at) on public.properties to authenticated;
grant select on public.properties_safe to authenticated;

create or replace function public.update_property_status(property_id uuid,new_status public.property_status)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare owner_id text;
begin
  select assigned_to into owner_id from public.properties where id=property_id and deleted_at is null;
  if not found or not public.can_view_record(owner_id) or not public.has_permission('properties','edit') then
    raise exception 'Insufficient permission to update this property';
  end if;
  update public.properties set status=new_status,updated_at=now() where id=property_id;
end;
$$;
revoke all on function public.update_property_status(uuid,public.property_status) from public,anon;
grant execute on function public.update_property_status(uuid,public.property_status) to authenticated;

create or replace function public.archive_property(property_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare owner_id text;
begin
  select assigned_to into owner_id from public.properties where id=property_id and deleted_at is null;
  if not found or not public.can_view_record(owner_id) or not public.has_permission('properties','delete') then
    raise exception 'Insufficient permission to archive this property';
  end if;
  update public.properties set deleted_at=now(),updated_at=now() where id=property_id;
end;
$$;
revoke all on function public.archive_property(uuid) from public,anon;
grant execute on function public.archive_property(uuid) to authenticated;

create or replace function public.create_custom_role(p_name text,p_name_ar text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare new_role_id uuid;
begin
  if (auth.uid()::text) is null or public.current_app_role()<>'super_admin' then raise exception 'Only Super Admin can manage roles'; end if;
  if nullif(trim(p_name),'') is null or nullif(trim(p_name_ar),'') is null then raise exception 'Role names are required'; end if;
  insert into public.roles(name,name_ar,is_system) values(trim(p_name),trim(p_name_ar),false) returning id into new_role_id;
  insert into public.role_permissions(role_id,permission_id,allowed) select new_role_id,id,false from public.permissions;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_data) values((auth.uid()::text),'create','role',new_role_id::text,jsonb_build_object('name',trim(p_name),'name_ar',trim(p_name_ar)));
  return new_role_id;
end;
$$;
revoke all on function public.create_custom_role(text,text) from public,anon;
grant execute on function public.create_custom_role(text,text) to authenticated;

create or replace function public.set_role_permission(p_role_id uuid,p_permission_id uuid,p_allowed boolean)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare old_allowed boolean;
begin
  if (auth.uid()::text) is null or public.current_app_role()<>'super_admin' then raise exception 'Only Super Admin can manage roles'; end if;
  select allowed into old_allowed from public.role_permissions where role_id=p_role_id and permission_id=p_permission_id;
  insert into public.role_permissions(role_id,permission_id,allowed) values(p_role_id,p_permission_id,p_allowed)
  on conflict(role_id,permission_id) do update set allowed=excluded.allowed;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_data,after_data)
  values((auth.uid()::text),'permission_update','role_permission',p_role_id::text,jsonb_build_object('permission_id',p_permission_id,'allowed',old_allowed),jsonb_build_object('permission_id',p_permission_id,'allowed',p_allowed));
end;
$$;
revoke all on function public.set_role_permission(uuid,uuid,boolean) from public,anon;
grant execute on function public.set_role_permission(uuid,uuid,boolean) to authenticated;

create or replace function public.create_import_batch(p_file_name text,p_target text default 'properties',p_duplicate_strategy text default 'skip')
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare batch_id uuid;
begin
  if (auth.uid()::text) is null or not public.has_permission('imports','import') then raise exception 'Import permission is required'; end if;
  if p_target not in ('properties','clients','requests','follow_ups','lookups') then raise exception 'Unsupported import target'; end if;
  if p_duplicate_strategy not in ('skip','update','create_anyway') then raise exception 'Unsupported duplicate strategy'; end if;
  insert into public.import_batches(created_by,file_name,target,duplicate_strategy,status) values((auth.uid()::text),left(p_file_name,255),p_target,p_duplicate_strategy,'staged') returning id into batch_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_data) values((auth.uid()::text),'import_start','import_batch',batch_id::text,jsonb_build_object('file_name',p_file_name,'target',p_target,'duplicate_strategy',p_duplicate_strategy));
  return batch_id;
end;
$$;
revoke all on function public.create_import_batch(text,text,text) from public,anon;
grant execute on function public.create_import_batch(text,text,text) to authenticated;

create or replace function public.stage_import_batch_rows(p_batch_id uuid,p_rows jsonb)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare item jsonb;row_number integer;inserted integer:=0;row_errors text;
begin
  if not exists(select 1 from public.import_batches b where b.id=p_batch_id and b.created_by=(auth.uid()::text) and b.status='staged') then raise exception 'Import batch is unavailable'; end if;
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>500 then raise exception 'Stage at most 500 rows per request'; end if;
  for item in select value from jsonb_array_elements(p_rows) loop
    row_number:=coalesce((item->>'index')::integer,0)+1;
    select string_agg(value,'; ') into row_errors from jsonb_array_elements_text(coalesce(item->'errors','[]'::jsonb));
    insert into public.import_rows(batch_id,row_number,raw_row,mapped_row,status,error_message)
    values(p_batch_id,row_number,coalesce(item->'property','{}'::jsonb),item->'property',case when row_errors is null then 'pending' else 'failed' end,row_errors)
    on conflict(batch_id,row_number) do nothing;
    if found then inserted:=inserted+1; end if;
  end loop;
  update public.import_batches set total_rows=greatest(total_rows,(select count(*) from public.import_rows where batch_id=p_batch_id)) where id=p_batch_id;
  return inserted;
end;
$$;
revoke all on function public.stage_import_batch_rows(uuid,jsonb) from public,anon;
grant execute on function public.stage_import_batch_rows(uuid,jsonb) to authenticated;

create or replace function public.process_import_batch(p_batch_id uuid,p_limit integer default 500)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  batch_row public.import_batches%rowtype;
  staged public.import_rows%rowtype;
  prop jsonb;
  client_record_id uuid;
  property_record_id uuid;
  existing_record public.properties%rowtype;
  assigned_record_id text;
  type_record_id uuid;
  offer_record_id uuid;
  area_record_id uuid;
  location_record_id uuid;
  phone_value text;
  phone_normalized text;
  processed integer:=0;
begin
  select * into batch_row from public.import_batches where id=p_batch_id for update;
  if not found or (batch_row.created_by<>(auth.uid()::text) and public.current_app_role() not in ('super_admin','manager')) then raise exception 'Import batch is unavailable'; end if;
  if not public.has_permission('imports','import') then raise exception 'Import permission is required'; end if;
  if batch_row.status='cancelled' then raise exception 'Import batch was cancelled'; end if;
  if batch_row.status='paused' then return jsonb_build_object('status','paused','processed',0); end if;
  if batch_row.target<>'properties' then raise exception 'This batch processor currently handles property imports only'; end if;
  if p_limit<1 or p_limit>500 then raise exception 'Process between 1 and 500 rows per request'; end if;
  update public.import_batches set status='processing',started_at=coalesce(started_at,now()) where id=p_batch_id;

  for staged in select * from public.import_rows where batch_id=p_batch_id and status='pending' order by row_number limit p_limit for update skip locked loop
    begin
      prop:=staged.mapped_row;
      property_record_id:=null;
      if batch_row.duplicate_strategy<>'create_anyway' then
        select * into existing_record from public.properties where code=prop->>'code' and deleted_at is null limit 1;
        property_record_id:=existing_record.id;
      end if;
      if property_record_id is not null and batch_row.duplicate_strategy='skip' then
        update public.import_rows set status='skipped',error_message='رمز العقار موجود مسبقاً',processed_at=now() where id=staged.id;
      else
        if property_record_id is not null then
          if not public.has_permission('properties','edit') or not public.can_view_record(existing_record.assigned_to) then
            update public.import_rows set status='skipped',error_message='لا تملك صلاحية تحديث العقار الموجود',processed_at=now() where id=staged.id;
            processed:=processed+1;
            continue;
          end if;
          update public.import_rows set before_data=to_jsonb(existing_record) where id=staged.id;
        end if;
        assigned_record_id:=(auth.uid()::text);
        if nullif(prop->>'employee','') is not null and prop->>'employee'<>'غير معيّن' then
          select id into assigned_record_id from public.profiles where full_name=prop->>'employee' and is_active limit 1;
          if assigned_record_id is null or (assigned_record_id<>(auth.uid()::text) and (not public.has_permission('properties','assign') or not public.can_view_record(assigned_record_id))) then
            assigned_record_id:=(auth.uid()::text);
          end if;
        end if;
        select id into type_record_id from public.lookups where type='property_type' and name_ar=prop->>'type' and is_active limit 1;
        select id into offer_record_id from public.lookups where type='offer_type' and name_ar=case prop->>'offer' when 'معروض للبيع' then 'للبيع' when 'معروض للإيجار' then 'للإيجار' when 'للبدل' then 'للبدل' else prop->>'offer' end and is_active limit 1;
        select id into area_record_id from public.lookups where type='area' and name_ar=prop->>'area' and is_active limit 1;
        select id into location_record_id from public.lookups where type='location_type' and name_ar=prop->>'locationType' and is_active limit 1;
        client_record_id:=null;
        for phone_value in select jsonb_array_elements_text(coalesce(prop->'phones','[]'::jsonb)) loop
          phone_normalized:=regexp_replace(phone_value,'\D','','g');if left(phone_normalized,3)='965' then phone_normalized:=substring(phone_normalized from 4);end if;
          select cp.client_id into client_record_id from public.client_phones cp where cp.normalized_phone=phone_normalized limit 1;
          exit when client_record_id is not null;
        end loop;
        if client_record_id is not null then
          if not exists(select 1 from public.clients c where c.id=client_record_id and public.can_view_record(c.assigned_to)) then
            update public.import_rows set status='skipped',error_message='رقم الهاتف مرتبط بعميل خارج نطاق صلاحيتك',processed_at=now() where id=staged.id;
            continue;
          end if;
        else
          if not public.has_permission('clients','create') then raise exception 'Client create permission is required for new imported clients'; end if;
          insert into public.clients(name,assigned_to,created_by) values(coalesce(nullif(prop->>'client',''),'عميل مستورد'),assigned_record_id,(auth.uid()::text)) returning id into client_record_id;
        end if;
        for phone_value in select jsonb_array_elements_text(coalesce(prop->'phones','[]'::jsonb)) loop
          phone_normalized:=regexp_replace(phone_value,'\D','','g');if left(phone_normalized,3)='965' then phone_normalized:=substring(phone_normalized from 4);end if;
          if phone_normalized<>'' then insert into public.client_phones(client_id,phone,normalized_phone,is_primary) values(client_record_id,phone_value,phone_normalized,not exists(select 1 from public.client_phones where client_id=client_record_id)) on conflict(client_id,normalized_phone) do nothing;end if;
        end loop;
        if existing_record.id is not null and batch_row.duplicate_strategy='update' then
          update public.properties set client_id=client_record_id,type_id=type_record_id,offer_type_id=offer_record_id,location_type_id=location_record_id,area_id=area_record_id,block=nullif(prop->>'block',''),plot=nullif(prop->>'plot',''),street=nullif(prop->>'street',''),area_m2=nullif(prop->>'size','')::numeric,asking_price_kwd=nullif(prop->>'price','')::numeric,details=nullif(prop->>'details',''),assigned_to=assigned_record_id,status=coalesce(nullif(prop->>'status','')::public.property_status,'available'),entry_date=coalesce(nullif(prop->>'date','')::date,current_date),updated_at=now() where id=existing_record.id returning id into property_record_id;
        else
          if not public.has_permission('properties','create') then raise exception 'Property create permission is required'; end if;
          insert into public.properties(code,client_id,type_id,offer_type_id,location_type_id,area_id,block,plot,street,area_m2,asking_price_kwd,details,assigned_to,created_by,status,entry_date)
          values(case when batch_row.duplicate_strategy='create_anyway' and exists(select 1 from public.properties p where p.code=prop->>'code') then coalesce(nullif(prop->>'code',''),'IMP-'||staged.row_number)||'-IMP-'||staged.row_number else coalesce(nullif(prop->>'code',''),'IMP-'||staged.row_number) end,client_record_id,type_record_id,offer_record_id,location_record_id,area_record_id,nullif(prop->>'block',''),nullif(prop->>'plot',''),nullif(prop->>'street',''),nullif(prop->>'size','')::numeric,nullif(prop->>'price','')::numeric,nullif(prop->>'details',''),assigned_record_id,(auth.uid()::text),coalesce(nullif(prop->>'status','')::public.property_status,'available'),coalesce(nullif(prop->>'date','')::date,current_date)) returning id into property_record_id;
        end if;
        for phone_value in select jsonb_array_elements_text(coalesce(prop->'phones','[]'::jsonb)) loop
          phone_normalized:=regexp_replace(phone_value,'\D','','g');if left(phone_normalized,3)='965' then phone_normalized:=substring(phone_normalized from 4);end if;
          if phone_normalized<>'' then insert into public.property_phones(property_id,phone,normalized_phone,position) values(property_record_id,phone_value,phone_normalized,(select count(*)+1 from public.property_phones where property_id=property_record_id)) on conflict(property_id,position) do nothing;end if;
        end loop;
        update public.import_rows set status=case when existing_record.id is not null and batch_row.duplicate_strategy='update' then 'updated' else 'created' end,entity_id=property_record_id,processed_at=now() where id=staged.id;
      end if;
      processed:=processed+1;
    exception when others then
      update public.import_rows set status='failed',error_message=left(sqlerrm,500),processed_at=now() where id=staged.id;
      processed:=processed+1;
    end;
  end loop;
  update public.import_batches b set created_count=(select count(*) from public.import_rows where batch_id=p_batch_id and status='created'),updated_count=(select count(*) from public.import_rows where batch_id=p_batch_id and status='updated'),skipped_count=(select count(*) from public.import_rows where batch_id=p_batch_id and status='skipped'),failed_count=(select count(*) from public.import_rows where batch_id=p_batch_id and status='failed'),status=case when exists(select 1 from public.import_rows where batch_id=p_batch_id and status='pending') then 'processing' else 'completed' end,completed_at=case when not exists(select 1 from public.import_rows where batch_id=p_batch_id and status='pending') then now() else null end where b.id=p_batch_id;
  return jsonb_build_object('processed',processed,'status',(select status from public.import_batches where id=p_batch_id),'created',(select created_count from public.import_batches where id=p_batch_id),'updated',(select updated_count from public.import_batches where id=p_batch_id),'skipped',(select skipped_count from public.import_batches where id=p_batch_id),'failed',(select failed_count from public.import_batches where id=p_batch_id),'total',(select total_rows from public.import_batches where id=p_batch_id));
end;
$$;
revoke all on function public.process_import_batch(uuid,integer) from public,anon;
grant execute on function public.process_import_batch(uuid,integer) to authenticated;

create or replace function public.set_import_batch_state(p_batch_id uuid,p_status text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_status not in ('paused','cancelled') then raise exception 'Unsupported import batch state'; end if;
  if not exists(select 1 from public.import_batches b where b.id=p_batch_id and (b.created_by=(auth.uid()::text) or public.current_app_role() in ('super_admin','manager'))) then raise exception 'Import batch is unavailable'; end if;
  update public.import_batches set status=p_status where id=p_batch_id and status in ('staged','processing','paused');
end;
$$;
revoke all on function public.set_import_batch_state(uuid,text) from public,anon;
grant execute on function public.set_import_batch_state(uuid,text) to authenticated;

create or replace function public.rollback_import_batch(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare batch_row public.import_batches%rowtype;item record;prior public.properties%rowtype;deleted_count integer:=0;updated_count integer:=0;client_record_id uuid;
begin
  select * into batch_row from public.import_batches where id=p_batch_id for update;
  if not found or public.current_app_role() not in ('super_admin','manager') or batch_row.rollback_until<now() then raise exception 'Batch rollback is unavailable'; end if;
  for item in select entity_id from public.import_rows where batch_id=p_batch_id and status='created' and entity_id is not null loop
    select client_id into client_record_id from public.properties where id=item.entity_id;
    delete from public.properties where id=item.entity_id;
    if client_record_id is not null and not exists(select 1 from public.properties where client_id=client_record_id) and exists(select 1 from public.clients where id=client_record_id and created_by=batch_row.created_by) then delete from public.clients where id=client_record_id; end if;
    deleted_count:=deleted_count+1;
  end loop;
  for item in select entity_id,before_data from public.import_rows where batch_id=p_batch_id and status='updated' and entity_id is not null and before_data is not null loop
    select * into prior from jsonb_populate_record(null::public.properties,item.before_data);
    update public.properties set code=prior.code,client_id=prior.client_id,type_id=prior.type_id,offer_type_id=prior.offer_type_id,location_type_id=prior.location_type_id,area_id=prior.area_id,block=prior.block,plot=prior.plot,street=prior.street,avenue=prior.avenue,floor=prior.floor,building_type=prior.building_type,area_m2=prior.area_m2,asking_price_kwd=prior.asking_price_kwd,details=prior.details,notes=prior.notes,assigned_to=prior.assigned_to,status=prior.status,entry_date=prior.entry_date,latitude=prior.latitude,longitude=prior.longitude,deleted_at=prior.deleted_at,updated_at=now() where id=item.entity_id;
    updated_count:=updated_count+1;
  end loop;
  update public.import_batches set status='rolled_back' where id=p_batch_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata) values((auth.uid()::text),'import_rollback','import_batch',p_batch_id::text,jsonb_build_object('deleted_count',deleted_count,'updated_restored',updated_count));
  return jsonb_build_object('deleted_count',deleted_count,'updated_restored',updated_count);
end;
$$;
revoke all on function public.rollback_import_batch(uuid) from public,anon;
grant execute on function public.rollback_import_batch(uuid) to authenticated;
