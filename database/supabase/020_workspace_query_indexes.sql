-- Keep the initial workspace pages below Neon Data API's statement timeout.
-- These match the stable sort keys used by paginated client/property reads.
create index if not exists properties_entry_date_id_active_idx
  on public.properties(entry_date desc, id asc)
  where deleted_at is null;

create index if not exists clients_created_at_id_active_idx
  on public.clients(created_at desc, id asc)
  where deleted_at is null;

create index if not exists comments_property_created_at_idx
  on public.comments(property_id, created_at desc)
  where property_id is not null;

create index if not exists comments_client_created_at_idx
  on public.comments(client_id, created_at desc)
  where client_id is not null;
