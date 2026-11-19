create or replace function public.update_property_map(p_property_id uuid,p_latitude double precision,p_longitude double precision)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare owner_id text;
begin
  if (auth.uid()::text) is null then raise exception 'Authentication is required'; end if;
  if (p_latitude is null)<>(p_longitude is null) then raise exception 'أدخل خط الطول والعرض معًا'; end if;
  if p_latitude is not null and (p_latitude < -90 or p_latitude > 90 or p_longitude < -180 or p_longitude > 180) then
    raise exception 'الإحداثيات خارج النطاق الصحيح';
  end if;
  select assigned_to into owner_id from public.properties where id=p_property_id and deleted_at is null;
  if not found or not public.can_view_record(owner_id) or not public.has_permission('properties','edit') then
    raise exception 'Insufficient permission to edit this property';
  end if;
  update public.properties set latitude=p_latitude,longitude=p_longitude,updated_at=now() where id=p_property_id;
end;
$$;
revoke all on function public.update_property_map(uuid,double precision,double precision) from public,anon;
grant execute on function public.update_property_map(uuid,double precision,double precision) to authenticated;
