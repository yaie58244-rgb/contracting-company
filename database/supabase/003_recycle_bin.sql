-- Recycle bin metadata and manager-controlled restoration.
alter table public.properties
  add column if not exists deleted_by text references public.profiles(id),
  add column if not exists deletion_comment text;
alter table public.clients
  add column if not exists deleted_by text references public.profiles(id),
  add column if not exists deletion_comment text;

drop function if exists public.archive_property(uuid);
create or replace function public.archive_property(p_property_id uuid,p_comment text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare actor_id text:=(auth.uid()::text); owner_id text;
begin
  if actor_id is null then raise exception 'Authentication is required'; end if;
  if length(trim(coalesce(p_comment,'')))<3 then raise exception 'اكتب سبب الأرشفة'; end if;
  select assigned_to into owner_id from public.properties where id=p_property_id and deleted_at is null;
  if not found or not public.can_view_record(owner_id) or not public.has_permission('properties','delete') then
    raise exception 'Insufficient permission to archive this property';
  end if;
  update public.properties set deleted_at=now(),deleted_by=actor_id,deletion_comment=trim(p_comment),updated_at=now() where id=p_property_id;
end;
$$;
revoke all on function public.archive_property(uuid,text) from public,anon;
grant execute on function public.archive_property(uuid,text) to authenticated;

create or replace function public.get_recycle_bin()
returns table(item_type text,item_id uuid,label text,deleted_at timestamptz,deleted_by text,deletion_comment text)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if (auth.uid()::text) is null or public.current_app_role() not in ('super_admin','manager') then
    raise exception 'Only managers can view the recycle bin';
  end if;
  return query
    select 'property'::text,p.id,p.code,p.deleted_at,coalesce(u.full_name,p.deleted_by),p.deletion_comment from public.properties p left join public.profiles u on u.id=p.deleted_by where p.deleted_at is not null
    union all
    select 'client'::text,c.id,c.name,c.deleted_at,coalesce(u.full_name,c.deleted_by),c.deletion_comment from public.clients c left join public.profiles u on u.id=c.deleted_by where c.deleted_at is not null
    order by 4 desc;
end;
$$;
revoke all on function public.get_recycle_bin() from public,anon;
grant execute on function public.get_recycle_bin() to authenticated;

create or replace function public.restore_recycle_item(p_item_type text,p_item_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare actor_id text:=(auth.uid()::text); owner_id text;
begin
  if actor_id is null or public.current_app_role() not in ('super_admin','manager') then
    raise exception 'Only managers can restore recycle bin items';
  end if;
  if p_item_type='property' then
    select assigned_to into owner_id from public.properties where id=p_item_id and deleted_at is not null;
    if not found then raise exception 'Recycle bin item was not found'; end if;
    if not public.can_view_record(owner_id) then raise exception 'Insufficient access to restore this property'; end if;
    update public.properties set deleted_at=null,deleted_by=null,deletion_comment=null,updated_at=now() where id=p_item_id;
  elsif p_item_type='client' then
    select assigned_to into owner_id from public.clients where id=p_item_id and deleted_at is not null;
    if not found then raise exception 'Recycle bin item was not found'; end if;
    if not public.can_view_record(owner_id) then raise exception 'Insufficient access to restore this client'; end if;
    update public.clients set deleted_at=null,deleted_by=null,deletion_comment=null,updated_at=now() where id=p_item_id;
  else
    raise exception 'Unsupported recycle bin item type';
  end if;
end;
$$;
revoke all on function public.restore_recycle_item(text,uuid) from public,anon;
grant execute on function public.restore_recycle_item(text,uuid) to authenticated;

create or replace function public.archive_client(p_client_id uuid,p_comment text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare actor_id text:=(auth.uid()::text); owner_id text;
begin
  if actor_id is null then raise exception 'Authentication is required'; end if;
  if length(trim(coalesce(p_comment,'')))<3 then raise exception 'اكتب سبب الأرشفة'; end if;
  select assigned_to into owner_id from public.clients where id=p_client_id and deleted_at is null;
  if not found or not public.can_view_record(owner_id) or not public.has_permission('clients','delete') then
    raise exception 'Insufficient permission to archive this client';
  end if;
  update public.clients set deleted_at=now(),deleted_by=actor_id,deletion_comment=trim(p_comment),updated_at=now() where id=p_client_id;
end;
$$;
revoke all on function public.archive_client(uuid,text) from public,anon;
grant execute on function public.archive_client(uuid,text) to authenticated;

grant insert,delete on public.favorites to authenticated;
