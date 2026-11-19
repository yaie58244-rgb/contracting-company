alter table public.notifications add column if not exists deleted_at timestamptz;
grant update on public.notifications to authenticated;

create or replace function public.list_my_notifications()
returns table(id uuid,type text,title text,body text,link text,read_at timestamptz,created_at timestamptz,deleted_at timestamptz)
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if (auth.uid()::text) is null then raise exception 'Authentication is required'; end if;
  delete from public.notifications where user_id=(auth.uid()::text) and created_at<now()-interval '60 days';
  return query select n.id,n.type,n.title,n.body,n.link,n.read_at,n.created_at,n.deleted_at
    from public.notifications n where n.user_id=(auth.uid()::text) order by n.created_at desc limit 500;
end;
$$;
revoke all on function public.list_my_notifications() from public,anon;
grant execute on function public.list_my_notifications() to authenticated;

create or replace function public.set_notification_state(p_id uuid,p_action text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if (auth.uid()::text) is null then raise exception 'Authentication is required'; end if;
  if p_action='read' then
    update public.notifications set read_at=coalesce(read_at,now()) where id=p_id and user_id=(auth.uid()::text) and deleted_at is null;
  elsif p_action='archive' then
    update public.notifications set deleted_at=now() where id=p_id and user_id=(auth.uid()::text) and deleted_at is null;
  elsif p_action='restore' then
    update public.notifications set deleted_at=null where id=p_id and user_id=(auth.uid()::text) and deleted_at>=now()-interval '60 days';
  else raise exception 'Unsupported notification action';
  end if;
  if not found then raise exception 'Notification was not found or has expired'; end if;
end;
$$;
revoke all on function public.set_notification_state(uuid,text) from public,anon;
grant execute on function public.set_notification_state(uuid,text) to authenticated;

create or replace function public.notify_assignment() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare item_title text; item_body text; item_link text;
begin
  if new.assigned_to is null then return new; end if;
  if tg_table_name='properties' then
    item_title:='تم إسناد عقار جديد إليك'; item_body:='رمز العقار: '||new.code; item_link:='/';
  elsif tg_table_name='follow_ups' then
    item_title:='متابعة جديدة'; item_body:=new.title; item_link:='/';
  else
    item_title:='موعد جديد'; item_body:=new.title; item_link:='/';
  end if;
  insert into public.notifications(user_id,type,title,body,link)
  values(new.assigned_to,tg_table_name,item_title,item_body,item_link);
  return new;
end;
$$;
drop trigger if exists property_assignment_notification on public.properties;
create trigger property_assignment_notification after insert on public.properties for each row execute function public.notify_assignment();
drop trigger if exists follow_up_assignment_notification on public.follow_ups;
create trigger follow_up_assignment_notification after insert on public.follow_ups for each row execute function public.notify_assignment();
drop trigger if exists appointment_assignment_notification on public.appointments;
create trigger appointment_assignment_notification after insert on public.appointments for each row execute function public.notify_assignment();
