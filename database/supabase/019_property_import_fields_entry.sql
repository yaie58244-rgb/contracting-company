-- Persist the added address and room-detail fields for properties created in the UI.
create or replace function public.create_property_with_image(payload jsonb,image_data text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare property_record_id uuid;
begin
  if image_data is not null and (
    length(image_data)>2000000 or
    image_data !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$'
  ) then raise exception 'Property image must be a compressed JPEG, PNG, or WebP image under 1.5 MB'; end if;
  property_record_id:=public.create_property_with_client(payload);
  update public.properties set
    avenue=nullif(payload->>'avenue',''),
    floor=nullif(payload->>'floor',''),
    building_type=nullif(payload->>'building_type',''),
    rooms_details=nullif(payload->>'rooms_details','')
  where id=property_record_id;
  if image_data is not null then
    insert into public.property_images(property_id,storage_path,caption,sort_order)
    values(property_record_id,image_data,'صورة العقار',0);
  end if;
  return property_record_id;
end;
$$;
revoke all on function public.create_property_with_image(jsonb,text) from public,anon;
grant execute on function public.create_property_with_image(jsonb,text) to authenticated;
