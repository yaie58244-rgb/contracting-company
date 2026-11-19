create or replace function public.get_client_activity(p_client_ids uuid[])
returns table(
  client_id uuid,
  employee_id text,
  employee_name text,
  claimed_at timestamptz,
  comment_id uuid,
  comment_body text,
  comment_author_name text,
  comment_created_at timestamptz
)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if (auth.uid()::text) is null or not public.has_permission('clients','view') then
    raise exception 'Client view permission is required';
  end if;
  if coalesce(array_length(p_client_ids,1),0)>100 then
    raise exception 'A maximum of 100 clients can be loaded at once';
  end if;
  return query
  select c.id,cl.employee_id,rep.full_name,cl.claimed_at,
    note.id,note.body,author.full_name,note.created_at
  from public.clients c
  left join public.client_claims cl on cl.client_id=c.id and cl.released_at is null
  left join public.profiles rep on rep.id=cl.employee_id
  left join public.comments note on note.client_id=c.id
  left join public.profiles author on author.id=note.created_by
  where c.id=any(coalesce(p_client_ids,'{}'::uuid[])) and c.deleted_at is null
  order by c.id,note.created_at desc;
end;
$$;
revoke all on function public.get_client_activity(uuid[]) from public,anon;
grant execute on function public.get_client_activity(uuid[]) to authenticated;
