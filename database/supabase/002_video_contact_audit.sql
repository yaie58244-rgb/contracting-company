-- Audit phone disclosure as demonstrated in the Savvy Realestate walkthrough.
create table public.contact_access_logs (
  id bigint generated always as identity primary key,
  viewer_id text not null references public.profiles(id),
  property_id uuid references public.properties(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  comment_id uuid not null references public.comments(id),
  viewed_at timestamptz not null default now(),
  check ((property_id is not null)::integer + (client_id is not null)::integer = 1)
);
create index contact_access_logs_viewed_idx on public.contact_access_logs(viewed_at desc);
create index contact_access_logs_property_idx on public.contact_access_logs(property_id,viewed_at desc) where property_id is not null;
create index contact_access_logs_client_idx on public.contact_access_logs(client_id,viewed_at desc) where client_id is not null;
alter table public.contact_access_logs enable row level security;
create policy "contact views are visible to managers and subject" on public.contact_access_logs
  for select using (viewer_id=(auth.uid()::text) or public.current_app_role() in ('super_admin','manager'));
revoke all on public.contact_access_logs from public,anon,authenticated;
grant select on public.contact_access_logs to authenticated;

-- Phone tables are not directly readable. The RPCs below write the mandatory
-- contact note, audit who opened the details, then return the numbers.
revoke all on public.property_phones from anon,authenticated;
revoke all on public.client_phones from anon,authenticated;

create or replace function public.reveal_property_contact(p_property_id uuid,p_comment text)
returns table(phone text,phone_position smallint)
language plpgsql security definer set search_path=public,pg_temp as $$
declare owner_id text; related_client uuid; actor_id text:=(auth.uid()::text); comment_record uuid;
begin
  if actor_id is null then raise exception 'Authentication is required'; end if;
  if length(trim(coalesce(p_comment,'')))<3 then raise exception 'اكتب تعليقاً واضحاً قبل عرض رقم العميل'; end if;
  select p.assigned_to,p.client_id into owner_id,related_client from public.properties p where p.id=p_property_id and p.deleted_at is null;
  if not found or not public.can_view_record(owner_id) or not public.has_permission('properties','view') then raise exception 'Property is unavailable'; end if;
  if not exists(select 1 from public.profiles me where me.id=actor_id and me.phone_visible) then raise exception 'Phone access is not enabled for this user'; end if;
  insert into public.comments(property_id,client_id,body,created_by) values(p_property_id,related_client,trim(p_comment),actor_id) returning id into comment_record;
  insert into public.contact_access_logs(viewer_id,property_id,comment_id) values(actor_id,p_property_id,comment_record);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata) values(actor_id,'contact_view','property',p_property_id::text,jsonb_build_object('comment_id',comment_record));
  return query select pp.phone,pp.position from public.property_phones pp where pp.property_id=p_property_id order by pp.position;
end;
$$;
revoke all on function public.reveal_property_contact(uuid,text) from public,anon;
grant execute on function public.reveal_property_contact(uuid,text) to authenticated;

create or replace function public.reveal_client_contact(p_client_id uuid,p_comment text)
returns table(phone text,label text,is_primary boolean)
language plpgsql security definer set search_path=public,pg_temp as $$
declare owner_id text; actor_id text:=(auth.uid()::text); comment_record uuid;
begin
  if actor_id is null then raise exception 'Authentication is required'; end if;
  if length(trim(coalesce(p_comment,'')))<3 then raise exception 'اكتب سبب التواصل قبل عرض رقم العميل'; end if;
  select c.assigned_to into owner_id from public.clients c where c.id=p_client_id and c.deleted_at is null;
  if not found or not public.can_view_record(owner_id) or not public.has_permission('clients','view') then raise exception 'Client is unavailable'; end if;
  if not exists(select 1 from public.profiles me where me.id=actor_id and me.phone_visible) then raise exception 'Phone access is not enabled for this user'; end if;
  insert into public.comments(client_id,body,created_by) values(p_client_id,trim(p_comment),actor_id) returning id into comment_record;
  insert into public.contact_access_logs(viewer_id,client_id,comment_id) values(actor_id,p_client_id,comment_record);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata) values(actor_id,'contact_view','client',p_client_id::text,jsonb_build_object('comment_id',comment_record));
  return query select cp.phone,cp.label,cp.is_primary from public.client_phones cp where cp.client_id=p_client_id order by cp.is_primary desc;
end;
$$;
revoke all on function public.reveal_client_contact(uuid,text) from public,anon;
grant execute on function public.reveal_client_contact(uuid,text) to authenticated;

-- Explicit PostgREST grants: RLS policies filter rows, grants expose the API surface.
grant usage on schema public to authenticated;
grant select on public.roles,public.permissions,public.role_permissions,public.profiles,public.lookups,
  public.clients,public.follow_ups,public.appointments,public.comments,public.favorites,public.ads,
  public.audit_logs,public.notifications,public.saved_filters,public.import_batches,public.import_rows,
  public.import_mappings,public.value_mappings,public.contact_access_logs to authenticated;
grant insert,update on public.follow_ups,public.appointments to authenticated;
grant insert,update on public.ads to authenticated;
