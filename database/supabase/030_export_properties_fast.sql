-- The first export_properties checked the role with security-definer helpers on
-- every one of ~54k rows, which ran past the 8 second Data API timeout. The role
-- is now resolved once per call; only sales/call-center staff need a per-row
-- owner check, and imported-Excel visibility uses an indexed join.
create or replace function public.export_properties(p_offset integer default 0,p_limit integer default 1000)
returns table(code text,client text,phone_1 text,phone_2 text,phone_3 text,type text,offer text,area text,sector text,
  distribution text,block text,plot text,street text,avenue text,location_type text,annexes text,size numeric,price numeric,
  status text,employee text,entry_date date,details text,latitude double precision,longitude double precision)
language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare
  actor_id text:=(auth.uid()::text);
  phones_ok boolean; prices_ok boolean; app_role text; team uuid; sees_all boolean;
begin
  if actor_id is null or not public.has_permission('properties','view') then raise exception 'Property view permission is required'; end if;
  select coalesce(me.phone_visible,false),coalesce(me.price_visible,false),me.team_id into phones_ok,prices_ok,team
    from public.profiles me where me.id=actor_id;
  app_role:=public.current_app_role();
  sees_all:=app_role in ('super_admin','manager','viewer','accountant','data_entry','marketer');
  if coalesce(p_offset,0)=0 then
    insert into public.audit_logs(actor_id,action,entity_type,metadata) values(actor_id,'export','property',jsonb_build_object('phones',coalesce(phones_ok,false)));
  end if;
  return query
  with page as materialized (
    select p.id,p.sort_n from (
      select p.id,row_number() over (order by ar.name_ar nulls last,
          nullif(left(regexp_replace(coalesce(p.block,''),'\D','','g'),12),'')::numeric nulls last,p.block,
          nullif(left(regexp_replace(coalesce(p.plot,''),'\D','','g'),12),'')::numeric nulls last,p.plot,p.id) as sort_n
      from public.properties p
      left join public.lookups ar on ar.id=p.area_id
      where p.deleted_at is null and (
        sees_all
        or exists(select 1 from public.excel_import_rows r where r.property_id=p.id)
        or p.assigned_to=actor_id
        or (app_role='sales_agent' and team is not null and exists(select 1 from public.profiles o where o.id=p.assigned_to and o.team_id=team)))
    ) p
    order by p.sort_n
    offset greatest(coalesce(p_offset,0),0) limit least(greatest(coalesce(p_limit,1000),1),1000)
  )
  select p.code,coalesce(cl.name,'')::text,
    case when phones_ok then ph.list[1] end,case when phones_ok then ph.list[2] end,case when phones_ok then ph.list[3] end,
    coalesce(pt.name_ar,'')::text,coalesce(ot.name_ar,'')::text,coalesce(ar.name_ar,'')::text,coalesce(p.sector,'')::text,
    coalesce(p.distribution,'')::text,coalesce(p.block,'')::text,coalesce(p.plot,'')::text,coalesce(p.street,'')::text,
    coalesce(p.avenue,'')::text,coalesce(lt.name_ar,'')::text,coalesce(p.annexes,'')::text,p.area_m2,
    case when prices_ok then p.asking_price_kwd end,
    case p.status when 'available' then 'متاح' when 'sold' then 'مباع' else 'مفقود' end,
    coalesce(rep.full_name,'')::text,p.entry_date,coalesce(p.details,'')::text,p.latitude,p.longitude
  from page
  join public.properties p on p.id=page.id
  left join public.clients cl on cl.id=p.client_id
  left join public.lookups pt on pt.id=p.type_id
  left join public.lookups ot on ot.id=p.offer_type_id
  left join public.lookups ar on ar.id=p.area_id
  left join public.lookups lt on lt.id=p.location_type_id
  left join public.profiles rep on rep.id=p.assigned_to
  left join lateral (select coalesce(
      (select array_agg(pp.phone order by pp.position) from public.property_phones pp where pp.property_id=p.id),
      (select array_agg(cp.phone order by cp.is_primary desc,cp.phone) from public.client_phones cp where cp.client_id=p.client_id)) as list) ph on true
  order by page.sort_n;
end;
$$;
revoke all on function public.export_properties(integer,integer) from public,anon;
grant execute on function public.export_properties(integer,integer) to authenticated;
