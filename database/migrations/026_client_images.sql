-- Client photo gallery: managers can attach, replace and remove pictures on any
-- existing client file. Images live in a private storage bucket and are read
-- through short-lived signed URLs.
create table if not exists public.client_images (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  storage_path text not null unique,
  caption text,
  created_by text references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists client_images_client_created_idx on public.client_images(client_id, created_at desc);

alter table public.client_images enable row level security;

drop policy if exists "client images readable by staff" on public.client_images;
create policy "client images readable by staff" on public.client_images for select
using (
  (select public.has_permission('clients','view'))
  and exists(select 1 from public.clients c where c.id=client_images.client_id and c.deleted_at is null)
);

drop policy if exists "client images managed by managers" on public.client_images;
create policy "client images managed by managers" on public.client_images for all
using (public.current_app_role() in ('super_admin','manager'))
with check (public.current_app_role() in ('super_admin','manager'));

grant select on table public.client_images to authenticated;
grant insert, update, delete on table public.client_images to authenticated;

create or replace function public.can_manage_client_images()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select (auth.uid()::text) is not null
    and public.current_app_role() in ('super_admin','manager')
    and public.has_permission('clients','edit')
$$;
revoke all on function public.can_manage_client_images() from public,anon;
grant execute on function public.can_manage_client_images() to authenticated;

-- Private bucket for client photos. The UI shows them through signed URLs.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('client-images','client-images',false,8388608,array['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif'])
on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "client images storage read" on storage.objects;
create policy "client images storage read" on storage.objects for select to authenticated
using (bucket_id='client-images');

drop policy if exists "client images storage write" on storage.objects;
create policy "client images storage write" on storage.objects for insert to authenticated
with check (bucket_id='client-images' and public.current_app_role() in ('super_admin','manager'));

drop policy if exists "client images storage delete" on storage.objects;
create policy "client images storage delete" on storage.objects for delete to authenticated
using (bucket_id='client-images' and public.current_app_role() in ('super_admin','manager'));
