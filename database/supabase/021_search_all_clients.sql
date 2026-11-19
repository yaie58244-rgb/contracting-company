drop function if exists public.search_clients(jsonb);
create function public.search_clients(p_filters jsonb default '{}'::jsonb)
returns table(
  id uuid,
  name text,
  source_names text[],
  source text,
  notes text,
  tags text[],
  address jsonb,
  created_at timestamptz,
  assigned_to text,
  claim_employee_id text,
  claim_employee_name text,
  claim_claimed_at timestamptz
)
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  f jsonb:=coalesce(p_filters,'{}'::jsonb);
  client_query text:=nullif(trim(coalesce(f->>'client','')),'');
  phone_query text:=regexp_replace(coalesce(f->>'phone',''),'\D','','g');
  has_filters boolean:=false;
begin
  if (auth.uid()::text) is null or not public.has_permission('clients','view') then
    raise exception 'Client view permission is required';
  end if;
  if phone_query<>'' then
    if length(phone_query)<4 then raise exception 'Enter at least four phone digits'; end if;
    if not exists(select 1 from public.profiles where id=(auth.uid()::text) and phone_visible) then
      raise exception 'Phone search is not enabled for this user';
    end if;
    insert into public.audit_logs(actor_id,action,entity_type,metadata)
      values((auth.uid()::text)::text,'search','phone',jsonb_build_object('last_four',right(phone_query,4)));
  end if;
  has_filters:=client_query is not null or phone_query<>'' or nullif(trim(coalesce(f->>'governorate','')),'') is not null
    or nullif(trim(coalesce(f->>'area','')),'') is not null or nullif(trim(coalesce(f->>'sector','')),'') is not null
    or nullif(trim(coalesce(f->>'distribution','')),'') is not null or nullif(trim(coalesce(f->>'block','')),'') is not null
    or nullif(trim(coalesce(f->>'details','')),'') is not null or nullif(trim(coalesce(f->>'notes','')),'') is not null;
  if not has_filters then return; end if;
  return query
  select c.id,c.name,c.source_names,c.source,c.notes,c.tags,c.address,c.created_at,c.assigned_to,
    active_claim.employee_id,rep.full_name,active_claim.claimed_at
  from public.clients c
  left join public.client_claims active_claim on active_claim.client_id=c.id and active_claim.released_at is null
  left join public.profiles rep on rep.id=active_claim.employee_id
  where c.deleted_at is null
    and (client_query is null or concat_ws(' ',c.name,array_to_string(c.source_names,' '),c.source,c.notes,c.tags::text,c.address::text) ilike '%'||client_query||'%')
    and (nullif(trim(coalesce(f->>'governorate','')),'') is null or coalesce(c.address->>'governorate','') ilike '%'||trim(f->>'governorate')||'%')
    and (nullif(trim(coalesce(f->>'area','')),'') is null or coalesce(c.address->>'area','') ilike '%'||trim(f->>'area')||'%')
    and (nullif(trim(coalesce(f->>'sector','')),'') is null or coalesce(c.address->>'sector','') ilike '%'||trim(f->>'sector')||'%')
    and (nullif(trim(coalesce(f->>'distribution','')),'') is null or coalesce(c.address->>'distribution','') ilike '%'||trim(f->>'distribution')||'%')
    and (nullif(trim(coalesce(f->>'block','')),'') is null or coalesce(c.address->>'block','') ilike '%'||trim(f->>'block')||'%')
    and (nullif(trim(coalesce(f->>'details','')),'') is null or concat_ws(' ',c.notes,c.address::text) ilike '%'||trim(f->>'details')||'%')
    and (nullif(trim(coalesce(f->>'notes','')),'') is null or concat_ws(' ',c.notes,c.address::text) ilike '%'||trim(f->>'notes')||'%')
    and (phone_query='' or exists(select 1 from public.client_phones cp where cp.client_id=c.id and cp.normalized_phone like '%'||phone_query||'%'))
  order by c.created_at desc,c.id
  limit 500;
end;
$$;
revoke all on function public.search_clients(jsonb) from public,anon;
grant execute on function public.search_clients(jsonb) to authenticated;
