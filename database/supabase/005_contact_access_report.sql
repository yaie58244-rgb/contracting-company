create or replace function public.get_contact_access_report(p_limit integer default 200)
returns table(viewed_at timestamptz,viewer_name text,item_type text,item_label text,comment text)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if (auth.uid()::text) is null or public.current_app_role() not in ('super_admin','manager') then
    raise exception 'Only managers can view the contact access report';
  end if;
  return query
  select l.viewed_at,coalesce(v.full_name,l.viewer_id),
    case when l.property_id is not null then 'عقار' else 'عميل' end,
    coalesce(p.code,c.name,'—'),cm.body
  from public.contact_access_logs l
  left join public.profiles v on v.id=l.viewer_id
  left join public.properties p on p.id=l.property_id
  left join public.clients c on c.id=l.client_id
  join public.comments cm on cm.id=l.comment_id
  order by l.viewed_at desc
  limit least(greatest(coalesce(p_limit,200),1),1000);
end;
$$;
revoke all on function public.get_contact_access_report(integer) from public,anon;
grant execute on function public.get_contact_access_report(integer) to authenticated;
