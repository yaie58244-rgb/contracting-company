-- Internal staff messages, company broadcasts, and optional attachment links.
create table public.staff_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id text not null references public.profiles(id),
  recipient_id text references public.profiles(id),
  body text not null,
  attachment_url text,
  created_at timestamptz not null default now(),
  check(length(trim(body))>0 or attachment_url is not null)
);
create index staff_messages_inbox_idx on public.staff_messages(recipient_id,created_at desc);
create index staff_messages_broadcast_idx on public.staff_messages(created_at desc) where recipient_id is null;
alter table public.staff_messages enable row level security;
create policy "staff can read own and broadcast messages" on public.staff_messages for select
  using(sender_id=(auth.uid()::text) or recipient_id=(auth.uid()::text) or recipient_id is null);
create policy "staff can send permitted messages" on public.staff_messages for insert
  with check(sender_id=(auth.uid()::text) and public.has_permission('messages','create') and (recipient_id is not null or public.has_permission('messages','broadcast')));
grant select on public.staff_messages to authenticated;

insert into public.permissions(module,action)
values('messages','view'),('messages','create'),('messages','broadcast') on conflict(module,action) do nothing;
insert into public.role_permissions(role_id,permission_id,allowed)
select r.id,p.id,case when r.name in ('super_admin','manager') then true else p.action in ('view','create') end
from public.roles r cross join public.permissions p
where p.module='messages' and r.name in ('super_admin','manager','sales_agent','call_center')
on conflict(role_id,permission_id) do nothing;

create or replace function public.list_staff_members()
returns table(id text,full_name text)
language sql stable security definer set search_path=public,pg_temp as $$
  select p.id,p.full_name from public.profiles p where p.is_active and public.has_permission('messages','view') order by p.full_name
$$;
revoke all on function public.list_staff_members() from public,anon;
grant execute on function public.list_staff_members() to authenticated;

create or replace function public.list_staff_messages()
returns table(id uuid,sender_id text,sender_name text,recipient_id text,recipient_name text,body text,attachment_url text,created_at timestamptz)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if (auth.uid()::text) is null or not public.has_permission('messages','view') then raise exception 'You cannot view staff messages'; end if;
  return query
  select m.id,m.sender_id,s.full_name,m.recipient_id,r.full_name,m.body,m.attachment_url,m.created_at
  from public.staff_messages m join public.profiles s on s.id=m.sender_id left join public.profiles r on r.id=m.recipient_id
  where public.current_app_role() in ('super_admin','manager') or m.sender_id=(auth.uid()::text) or m.recipient_id=(auth.uid()::text) or m.recipient_id is null
  order by m.created_at desc limit 500;
end;
$$;
revoke all on function public.list_staff_messages() from public,anon;
grant execute on function public.list_staff_messages() to authenticated;

create or replace function public.send_staff_message(p_recipient_id text,p_body text,p_attachment_url text default null)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare actor_id text:=(auth.uid()::text); message_id uuid;
begin
  if actor_id is null or not public.has_permission('messages','create') then raise exception 'You cannot send staff messages'; end if;
  if length(trim(coalesce(p_body,'')))=0 and nullif(trim(coalesce(p_attachment_url,'')),'') is null then raise exception 'اكتب رسالة أو أرفق رابطاً'; end if;
  if p_recipient_id is null and not public.has_permission('messages','broadcast') then raise exception 'Only managers can broadcast to all staff'; end if;
  if p_recipient_id is not null and not exists(select 1 from public.profiles where id=p_recipient_id and is_active) then raise exception 'Recipient is unavailable'; end if;
  if p_attachment_url is not null and p_attachment_url !~ '^https://[^[:space:]]+$' then raise exception 'Attachment must use a secure HTTPS link'; end if;
  insert into public.staff_messages(sender_id,recipient_id,body,attachment_url)
  values(actor_id,p_recipient_id,trim(coalesce(p_body,'')),nullif(trim(p_attachment_url),'')) returning id into message_id;
  return message_id;
end;
$$;
revoke all on function public.send_staff_message(text,text,text) from public,anon;
grant execute on function public.send_staff_message(text,text,text) to authenticated;
