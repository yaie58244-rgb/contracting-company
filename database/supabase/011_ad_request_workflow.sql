alter table public.ads add column if not exists deleted_at timestamptz;
update public.ads set status=case status when 'مسودة' then 'مطلوب نشر' when 'قيد النشر' then 'قيد التنفيذ' when 'متوقف' then 'مطلوب استكمال بيانات' else status end;
create index if not exists ads_deleted_at_idx on public.ads(deleted_at) where deleted_at is not null;

create or replace function public.purge_expired_ads()
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare removed_count integer;
begin
  delete from public.ads where deleted_at is not null and deleted_at<now()-interval '60 days';
  get diagnostics removed_count=row_count;
  return removed_count;
end;
$$;
revoke all on function public.purge_expired_ads() from public,anon;
grant execute on function public.purge_expired_ads() to authenticated;
