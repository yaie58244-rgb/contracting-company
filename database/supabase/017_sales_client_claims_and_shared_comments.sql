-- A sales rep can reserve one client at a time. Releasing the claim makes
-- the client available to the rest of the team without deleting its history.
create table if not exists public.client_claims (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  employee_id text not null references public.profiles(id),
  claimed_at timestamptz not null default now(),
  released_at timestamptz,
  released_by text references public.profiles(id),
  check(released_at is null or released_at >= claimed_at)
);
create unique index if not exists client_claims_one_active_per_client
  on public.client_claims(client_id) where released_at is null;
create index if not exists client_claims_employee_active_idx
  on public.client_claims(employee_id,claimed_at desc) where released_at is null;
alter table public.client_claims enable row level security;
revoke all on public.client_claims from public,anon,authenticated;

create or replace function public.has_active_client_claim(p_client_id uuid,p_employee_id text default (auth.uid()::text))
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.client_claims c where c.client_id=p_client_id and c.employee_id=p_employee_id and c.released_at is null)
$$;

create or replace function public.can_access_client(p_client_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.can_view_record(c.assigned_to) or public.has_active_client_claim(c.id)
  from public.clients c where c.id=p_client_id and c.deleted_at is null
$$;

drop policy if exists "clients scoped read" on public.clients;
create policy "clients team read" on public.clients for select
using(deleted_at is null and public.has_permission('clients','view'));

drop policy if exists "client phones visible to authorized roles" on public.client_phones;
create policy "client phones visible to assigned rep or claimant" on public.client_phones for select
using(exists(select 1 from public.profiles me where me.id=(auth.uid()::text) and me.phone_visible)
  and public.can_access_client(client_id) and public.has_permission('clients','view'));

drop policy if exists "comments scoped read" on public.comments;
create policy "comments visible to client team" on public.comments for select
using((client_id is not null and public.has_permission('clients','view'))
  or (property_id is not null and exists(select 1 from public.properties p where p.id=property_id and public.can_view_record(p.assigned_to))));

create or replace function public.list_active_client_claims()
returns table(client_id uuid,employee_id text,employee_name text,claimed_at timestamptz)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if (auth.uid()::text) is null or not public.has_permission('clients','view') then raise exception 'Client view permission is required'; end if;
  return query select c.client_id,c.employee_id,p.full_name,c.claimed_at
    from public.client_claims c join public.profiles p on p.id=c.employee_id
    join public.clients cl on cl.id=c.client_id and cl.deleted_at is null
    where c.released_at is null order by c.claimed_at desc;
end;
$$;
revoke all on function public.list_active_client_claims() from public,anon;
grant execute on function public.list_active_client_claims() to authenticated;

create or replace function public.list_client_comments()
returns table(id uuid,client_id uuid,body text,author_name text,created_at timestamptz)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if (auth.uid()::text) is null or not public.has_permission('clients','view') then raise exception 'Client view permission is required'; end if;
  return query select c.id,c.client_id,c.body,p.full_name,c.created_at
    from public.comments c join public.profiles p on p.id=c.created_by
    join public.clients cl on cl.id=c.client_id and cl.deleted_at is null
    where c.client_id is not null order by c.created_at desc;
end;
$$;
revoke all on function public.list_client_comments() from public,anon;
grant execute on function public.list_client_comments() to authenticated;

create or replace function public.claim_client(p_client_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare actor_id text:=(auth.uid()::text)::text;
begin
  if actor_id is null or not public.has_permission('clients','view') or not public.has_permission('clients','assign') then
    raise exception 'Client claim permission is required';
  end if;
  perform 1 from public.clients where id=p_client_id and deleted_at is null for update;
  if not found then raise exception 'Client is unavailable'; end if;
  if exists(select 1 from public.client_claims where client_id=p_client_id and released_at is null) then
    raise exception 'This client is already being handled by another employee';
  end if;
  insert into public.client_claims(client_id,employee_id) values(p_client_id,actor_id);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_data)
    values(actor_id,'claim','client',p_client_id::text,jsonb_build_object('employee_id',actor_id));
end;
$$;
revoke all on function public.claim_client(uuid) from public,anon;
grant execute on function public.claim_client(uuid) to authenticated;

create or replace function public.release_client_claim(p_client_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare actor_id text:=(auth.uid()::text)::text; claim_owner text;
begin
  if actor_id is null or not public.has_permission('clients','view') then raise exception 'Client view permission is required'; end if;
  select employee_id into claim_owner from public.client_claims where client_id=p_client_id and released_at is null for update;
  if not found then raise exception 'This client has no active employee claim'; end if;
  if claim_owner<>actor_id and not public.has_permission('users','edit') then raise exception 'Only the assigned employee or a manager can release this client'; end if;
  update public.client_claims set released_at=now(),released_by=actor_id where client_id=p_client_id and released_at is null;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_data,after_data)
    values(actor_id,'release','client',p_client_id::text,jsonb_build_object('employee_id',claim_owner),jsonb_build_object('available',true));
end;
$$;
revoke all on function public.release_client_claim(uuid) from public,anon;
grant execute on function public.release_client_claim(uuid) to authenticated;

create or replace function public.add_client_comment(p_client_id uuid,p_body text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare actor_id text:=(auth.uid()::text)::text; comment_id uuid;
begin
  if actor_id is null or not public.has_permission('clients','view') or not public.has_permission('clients','edit') then raise exception 'Client comment permission is required'; end if;
  if length(trim(coalesce(p_body,'')))<2 or length(p_body)>2000 then raise exception 'Comment must contain 2 to 2000 characters'; end if;
  if not exists(select 1 from public.clients where id=p_client_id and deleted_at is null) then raise exception 'Client is unavailable'; end if;
  insert into public.comments(client_id,body,created_by) values(p_client_id,trim(p_body),actor_id) returning id into comment_id;
  return comment_id;
end;
$$;
revoke all on function public.add_client_comment(uuid,text) from public,anon;
grant execute on function public.add_client_comment(uuid,text) to authenticated;

-- Claimed reps may read contact details even when the customer's record was
-- originally created or assigned by a different team member.
create or replace function public.reveal_client_contact(p_client_id uuid,p_comment text)
returns table(phone text,label text,is_primary boolean)
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor_id text:=(auth.uid()::text)::text; comment_record uuid;
begin
  if actor_id is null then raise exception 'Authentication is required'; end if;
  if length(trim(coalesce(p_comment,'')))<3 then raise exception 'اكتب سبب التواصل قبل عرض رقم العميل'; end if;
  if not public.can_access_client(p_client_id) or not public.has_permission('clients','view') then raise exception 'Client is unavailable'; end if;
  if not exists(select 1 from public.profiles me where me.id=actor_id and me.phone_visible) then raise exception 'Phone access is not enabled for this user'; end if;
  insert into public.comments(client_id,body,created_by) values(p_client_id,trim(p_comment),actor_id) returning id into comment_record;
  insert into public.contact_access_logs(viewer_id,client_id,comment_id) values(actor_id,p_client_id,comment_record);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata) values(actor_id,'contact_view','client',p_client_id::text,jsonb_build_object('comment_id',comment_record));
  return query select cp.phone,cp.label,cp.is_primary from public.client_phones cp where cp.client_id=p_client_id order by cp.is_primary desc;
end;
$$;
revoke all on function public.reveal_client_contact(uuid,text) from public,anon;
grant execute on function public.reveal_client_contact(uuid,text) to authenticated;

-- Convert existing client note text into a shared comment while retaining the
-- legacy value for audit and backward compatibility.
insert into public.comments(client_id,body,created_by,created_at)
select c.id,trim(c.notes),c.created_by,coalesce(c.created_at,now())
from public.clients c where nullif(trim(c.notes),'') is not null
  and not exists(select 1 from public.comments x where x.client_id=c.id and x.body=trim(c.notes));
