-- No duplicate properties: a new property with the same address (area, sector,
-- block, plot, distribution; a blank sector matches any) and the same client (same client record, same name,
-- or a shared phone number) is refused. Existing data is left as it is.

-- "003" and "3" are the same distribution; Arabic digits, hamza and spaces don't matter.
create or replace function public.property_key_part(t text)
returns text language sql immutable parallel safe as $$
  select case when public.norm_ar(t) ~ '^[0-9]+$' then coalesce(nullif(ltrim(public.norm_ar(t),'0'),''),'0') else public.norm_ar(t) end
$$;

create index if not exists properties_duplicate_key_idx
  on public.properties(area_id, public.property_key_part(plot)) where deleted_at is null;

create or replace function public.block_duplicate_property()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  dup_code text;
  new_name text;
begin
  -- Without a plot number the address is not specific enough to call it the same property.
  if new.deleted_at is not null or public.property_key_part(new.plot)='' then return new; end if;
  select public.norm_ar(name) into new_name from public.clients where id=new.client_id;
  if new_name in ('','غيرمسجل') then new_name:=null; end if;
  select p.code into dup_code
    from public.properties p
    left join public.clients c on c.id=p.client_id
    where p.deleted_at is null
      and p.area_id is not distinct from new.area_id
      and public.property_key_part(p.plot)=public.property_key_part(new.plot)
      and public.property_key_part(p.block)=public.property_key_part(new.block)
      -- The add form has no sector, so a missing sector on either side still counts as the same.
      and (public.property_key_part(p.sector)=public.property_key_part(new.sector) or public.property_key_part(p.sector)='' or public.property_key_part(new.sector)='')
      and public.property_key_part(p.street)=public.property_key_part(new.street)
      and (p.client_id=new.client_id
        or (new_name is not null and public.norm_ar(c.name)=new_name)
        or exists(select 1 from public.client_phones np
          where np.client_id=new.client_id and coalesce(np.normalized_phone,'')<>''
            and (exists(select 1 from public.property_phones pp where pp.property_id=p.id and pp.normalized_phone=np.normalized_phone)
              or exists(select 1 from public.client_phones cp where cp.client_id=p.client_id and cp.normalized_phone=np.normalized_phone))))
    limit 1;
  if dup_code is not null then
    raise exception using errcode='P0D01',
      message=format('العقار ده متسجل قبل كده بنفس العنوان ونفس العميل (رقم العقار %s)، فمش هيتضاف تاني.', dup_code);
  end if;
  return new;
end;
$$;
revoke all on function public.block_duplicate_property() from public,anon,authenticated;

drop trigger if exists properties_block_duplicates on public.properties;
create trigger properties_block_duplicates before insert on public.properties
  for each row execute function public.block_duplicate_property();

-- Excel import staging failed on every call: the variable row_number clashed
-- with the import_rows.row_number column ("column reference is ambiguous").
create or replace function public.stage_import_batch_rows(p_batch_id uuid,p_rows jsonb)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare item jsonb;v_row integer;inserted integer:=0;row_errors text;
begin
  if not exists(select 1 from public.import_batches b where b.id=p_batch_id and b.created_by=(auth.uid()::text) and b.status='staged') then raise exception 'Import batch is unavailable'; end if;
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>500 then raise exception 'Stage at most 500 rows per request'; end if;
  for item in select value from jsonb_array_elements(p_rows) loop
    v_row:=coalesce((item->>'index')::integer,0)+1;
    select string_agg(value,'; ') into row_errors from jsonb_array_elements_text(coalesce(item->'errors','[]'::jsonb));
    insert into public.import_rows as r(batch_id,row_number,raw_row,mapped_row,status,error_message)
    values(p_batch_id,v_row,coalesce(item->'property','{}'::jsonb),item->'property',case when row_errors is null then 'pending' else 'failed' end,row_errors)
    on conflict on constraint import_rows_batch_id_row_number_key do nothing;
    if found then inserted:=inserted+1; end if;
  end loop;
  update public.import_batches set total_rows=greatest(total_rows,(select count(*) from public.import_rows ir where ir.batch_id=p_batch_id)) where id=p_batch_id;
  return inserted;
end;
$$;
revoke all on function public.stage_import_batch_rows(uuid,jsonb) from public,anon;
grant execute on function public.stage_import_batch_rows(uuid,jsonb) to authenticated;

-- Excel import: a duplicate row is counted as skipped, not failed.
CREATE OR REPLACE FUNCTION public.process_import_batch(p_batch_id uuid, p_limit integer DEFAULT 500)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      update public.import_rows set status=case when sqlstate='P0D01' then 'skipped' else 'failed' end,error_message=left(sqlerrm,500),processed_at=now() where id=staged.id;
      processed:=processed+1;
    end;
  end loop;
  update public.import_batches b set created_count=(select count(*) from public.import_rows where batch_id=p_batch_id and status='created'),updated_count=(select count(*) from public.import_rows where batch_id=p_batch_id and status='updated'),skipped_count=(select count(*) from public.import_rows where batch_id=p_batch_id and status='skipped'),failed_count=(select count(*) from public.import_rows where batch_id=p_batch_id and status='failed'),status=case when exists(select 1 from public.import_rows where batch_id=p_batch_id and status='pending') then 'processing' else 'completed' end,completed_at=case when not exists(select 1 from public.import_rows where batch_id=p_batch_id and status='pending') then now() else null end where b.id=p_batch_id;
  return jsonb_build_object('processed',processed,'status',(select status from public.import_batches where id=p_batch_id),'created',(select created_count from public.import_batches where id=p_batch_id),'updated',(select updated_count from public.import_batches where id=p_batch_id),'skipped',(select skipped_count from public.import_batches where id=p_batch_id),'failed',(select failed_count from public.import_batches where id=p_batch_id),'total',(select total_rows from public.import_batches where id=p_batch_id));
end;
$function$;
