-- Staff messages reach people through their notifications.
--  * every role can open the messages page and reply (broadcast stays with managers)
--  * each new message notifies its recipient, or every active user for a broadcast

-- 1) Messages view + create for every role (broadcast is unchanged).
insert into public.role_permissions(role_id, permission_id, allowed)
select r.id, p.id, true
from public.roles r cross join public.permissions p
where p.module = 'messages' and p.action in ('view', 'create')
on conflict (role_id, permission_id) do update set allowed = true;

-- 2) One notification per recipient when a message is sent.
create or replace function public.notify_staff_message()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  sender_name text;
  preview text;
begin
  select full_name into sender_name from public.profiles where id = new.sender_id;
  preview := coalesce(nullif(new.body, ''), 'مرفق: ' || coalesce(new.attachment_url, ''));
  insert into public.notifications(user_id, type, title, body, link)
  select p.id,
         'messages',
         case when new.recipient_id is null then 'تعميم من ' else 'رسالة جديدة من ' end || coalesce(sender_name, 'الإدارة'),
         preview,
         'messages:' || new.id
  from public.profiles p
  where p.is_active
    and p.id <> new.sender_id
    and (new.recipient_id is null or p.id = new.recipient_id);
  return new;
end;
$$;
revoke all on function public.notify_staff_message() from public, anon, authenticated;

drop trigger if exists staff_messages_notify on public.staff_messages;
create trigger staff_messages_notify after insert on public.staff_messages
for each row execute function public.notify_staff_message();

-- 3) Messages sent in the last 7 days before this change get their notifications too.
insert into public.notifications(user_id, type, title, body, link, created_at)
select p.id,
       'messages',
       case when m.recipient_id is null then 'تعميم من ' else 'رسالة جديدة من ' end || coalesce(s.full_name, 'الإدارة'),
       coalesce(nullif(m.body, ''), 'مرفق: ' || coalesce(m.attachment_url, '')),
       'messages:' || m.id,
       m.created_at
from public.staff_messages m
join public.profiles s on s.id = m.sender_id
join public.profiles p on p.is_active and p.id <> m.sender_id and (m.recipient_id is null or p.id = m.recipient_id)
where m.created_at > now() - interval '7 days'
  and not exists (select 1 from public.notifications n where n.user_id = p.id and n.link = 'messages:' || m.id);
