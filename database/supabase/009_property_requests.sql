-- The requests relation already exists in the base schema; expose its scoped API.
grant select,insert,update on public.requests to authenticated;
