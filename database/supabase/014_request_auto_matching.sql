grant select on public.matches to authenticated;

create or replace function public.match_request(p_request_id uuid)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare req public.requests%rowtype; added_count integer:=0;
begin
  if (auth.uid()::text) is null then raise exception 'Authentication is required'; end if;
  select * into req from public.requests where id=p_request_id;
  if not found or not public.can_view_record(req.assigned_to) or not public.has_permission('requests','view') then
    raise exception 'Request is unavailable';
  end if;
  delete from public.matches m where m.request_id=req.id and not exists(
    select 1 from public.properties p where p.id=m.property_id and p.deleted_at is null and p.status='available'
      and (req.type_id is null or p.type_id=req.type_id) and (req.area_id is null or p.area_id=req.area_id)
      and (req.min_size is null or p.area_m2>=req.min_size) and (req.max_size is null or p.area_m2<=req.max_size)
      and (req.min_price is null or p.asking_price_kwd>=req.min_price) and (req.max_price is null or p.asking_price_kwd<=req.max_price)
  );
  if req.type_id is null and req.area_id is null and req.min_size is null and req.max_size is null and req.min_price is null and req.max_price is null then return 0; end if;
  insert into public.matches(request_id,property_id,score,notified_at)
  select req.id,p.id,
    (case when req.type_id is not null then 25 else 0 end+
     case when req.area_id is not null then 35 else 0 end+
     case when req.min_size is not null or req.max_size is not null then 20 else 0 end+
     case when req.min_price is not null or req.max_price is not null then 20 else 0 end)::numeric,
    now()
  from public.properties p
  where p.deleted_at is null and p.status='available'
    and (req.type_id is null or p.type_id=req.type_id)
    and (req.area_id is null or p.area_id=req.area_id)
    and (req.min_size is null or p.area_m2>=req.min_size)
    and (req.max_size is null or p.area_m2<=req.max_size)
    and (req.min_price is null or p.asking_price_kwd>=req.min_price)
    and (req.max_price is null or p.asking_price_kwd<=req.max_price)
    and public.can_view_record(p.assigned_to)
  on conflict(request_id,property_id) do nothing;
  get diagnostics added_count=row_count;
  if added_count>0 then
    insert into public.notifications(user_id,type,title,body,link)
    values(req.assigned_to,'request_match','توجد عقارات مطابقة لطلبك',added_count||' عقار متاح يطابق مواصفات الطلب.','/');
  end if;
  return added_count;
end;
$$;
revoke all on function public.match_request(uuid) from public,anon;
grant execute on function public.match_request(uuid) to authenticated;

create or replace function public.auto_match_request_trigger()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.match_request(new.id);
  return new;
end;
$$;
drop trigger if exists requests_auto_match on public.requests;
create trigger requests_auto_match after insert or update of type_id,area_id,min_size,max_size,min_price,max_price on public.requests
for each row execute function public.auto_match_request_trigger();

create or replace function public.get_request_matches(p_request_id uuid)
returns table(property_id uuid,code text,property_type text,area text,area_m2 numeric,asking_price_kwd numeric,score numeric,employee text)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare owner_id text;
begin
  select assigned_to into owner_id from public.requests where id=p_request_id;
  if not found or (auth.uid()::text) is null or not public.can_view_record(owner_id) or not public.has_permission('requests','view') then
    raise exception 'Request is unavailable';
  end if;
  return query select p.id,p.code,coalesce(t.name_ar,'غير محدد'),coalesce(a.name_ar,'غير محدد'),p.area_m2,
    case when exists(select 1 from public.profiles me where me.id=(auth.uid()::text) and me.price_visible) then p.asking_price_kwd else null::numeric end,
    m.score,coalesce(owner.full_name,'غير معيّن')
  from public.matches m join public.properties p on p.id=m.property_id
  left join public.lookups t on t.id=p.type_id left join public.lookups a on a.id=p.area_id
  left join public.profiles owner on owner.id=p.assigned_to
  where m.request_id=p_request_id and p.deleted_at is null and p.status='available' and public.can_view_record(p.assigned_to)
  order by m.score desc,p.created_at desc;
end;
$$;
revoke all on function public.get_request_matches(uuid) from public,anon;
grant execute on function public.get_request_matches(uuid) to authenticated;

create or replace function public.match_new_property_trigger()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare req record; inserted_match uuid;
begin
  delete from public.matches m using public.requests r
  where m.property_id=new.id and r.id=m.request_id and (
    new.deleted_at is not null or new.status<>'available'
    or (r.type_id is not null and new.type_id is distinct from r.type_id)
    or (r.area_id is not null and new.area_id is distinct from r.area_id)
    or (r.min_size is not null and (new.area_m2 is null or new.area_m2<r.min_size))
    or (r.max_size is not null and (new.area_m2 is null or new.area_m2>r.max_size))
    or (r.min_price is not null and (new.asking_price_kwd is null or new.asking_price_kwd<r.min_price))
    or (r.max_price is not null and (new.asking_price_kwd is null or new.asking_price_kwd>r.max_price))
  );
  if new.deleted_at is not null or new.status<>'available' then return new; end if;
  for req in
    select r.id,r.assigned_to,
      (case when r.type_id is not null then 25 else 0 end+
       case when r.area_id is not null then 35 else 0 end+
       case when r.min_size is not null or r.max_size is not null then 20 else 0 end+
       case when r.min_price is not null or r.max_price is not null then 20 else 0 end)::numeric as score
    from public.requests r
    where r.status='open'
      and (r.type_id is null or new.type_id=r.type_id)
      and (r.area_id is null or new.area_id=r.area_id)
      and (r.min_size is null or new.area_m2>=r.min_size)
      and (r.max_size is null or new.area_m2<=r.max_size)
      and (r.min_price is null or new.asking_price_kwd>=r.min_price)
      and (r.max_price is null or new.asking_price_kwd<=r.max_price)
      and public.can_view_record(new.assigned_to)
  loop
    insert into public.matches(request_id,property_id,score,notified_at)
    values(req.id,new.id,req.score,now()) on conflict(request_id,property_id) do nothing
    returning id into inserted_match;
    if inserted_match is not null then
      insert into public.notifications(user_id,type,title,body,link)
      values(req.assigned_to,'request_match','عقار جديد يطابق طلب عميلك','تمت إضافة العقار '||new.code||' وهو يطابق مواصفات الطلب.','/');
      inserted_match:=null;
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists properties_match_open_requests on public.properties;
create trigger properties_match_open_requests after insert or update of type_id,area_id,area_m2,asking_price_kwd,status,deleted_at on public.properties
for each row execute function public.match_new_property_trigger();
