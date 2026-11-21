-- Staff who may edit a property can add and delete its images from the property
-- file. Images stay stored as compressed data URLs, at most 12 per property.

drop function if exists public.get_property_images(uuid);
create function public.get_property_images(p_property_id uuid)
returns table(id uuid,storage_path text,caption text,sort_order integer)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if (auth.uid()::text) is null or not public.can_view_property(p_property_id) then raise exception 'Property is unavailable'; end if;
  return query select i.id,i.storage_path,i.caption,i.sort_order
    from public.property_images i where i.property_id=p_property_id order by i.sort_order,i.created_at limit 12;
end;
$$;
revoke all on function public.get_property_images(uuid) from public,anon;
grant execute on function public.get_property_images(uuid) to authenticated;

create or replace function public.add_property_image(p_property_id uuid,p_image_data text,p_caption text default null)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare actor_id text:=(auth.uid()::text); image_id uuid; next_order integer;
begin
  if actor_id is null or not public.can_view_property(p_property_id) or not public.has_permission('properties','edit') then
    raise exception 'لا تملك صلاحية تعديل صور هذا العقار';
  end if;
  if p_image_data is null or length(p_image_data)>2000000 or p_image_data !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' then
    raise exception 'الصورة لازم تكون JPG أو PNG أو WebP وحجمها أقل من ١٫٥ ميجا';
  end if;
  if (select count(*) from public.property_images where property_id=p_property_id)>=12 then
    raise exception 'العقار فيه ١٢ صورة، احذف صورة الأول';
  end if;
  select coalesce(max(sort_order),-1)+1 into next_order from public.property_images where property_id=p_property_id;
  insert into public.property_images(property_id,storage_path,caption,sort_order)
  values(p_property_id,p_image_data,coalesce(nullif(trim(p_caption),''),'صورة العقار'),next_order)
  returning id into image_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_data)
  values(actor_id,'create','property_image',image_id::text,jsonb_build_object('property_id',p_property_id));
  return image_id;
end;
$$;
revoke all on function public.add_property_image(uuid,text,text) from public,anon;
grant execute on function public.add_property_image(uuid,text,text) to authenticated;

create or replace function public.delete_property_image(p_image_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare actor_id text:=(auth.uid()::text); owner_property uuid;
begin
  select property_id into owner_property from public.property_images where id=p_image_id;
  if not found then raise exception 'الصورة مش موجودة'; end if;
  if actor_id is null or not public.can_view_property(owner_property) or not public.has_permission('properties','edit') then
    raise exception 'لا تملك صلاحية تعديل صور هذا العقار';
  end if;
  delete from public.property_images where id=p_image_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_data)
  values(actor_id,'delete','property_image',p_image_id::text,jsonb_build_object('property_id',owner_property));
end;
$$;
revoke all on function public.delete_property_image(uuid) from public,anon;
grant execute on function public.delete_property_image(uuid) to authenticated;
