create table public.company_profile (
  id smallint primary key default 1 check(id=1),
  name_ar text not null default 'اسم الشركة',
  name_en text,
  phone text,
  fax text,
  address text,
  logo_url text,
  updated_by text references public.profiles(id),
  updated_at timestamptz not null default now()
);
insert into public.company_profile(id) values(1) on conflict(id) do nothing;
alter table public.company_profile enable row level security;
create policy "company profile is readable by staff" on public.company_profile for select to authenticated using(true);
grant select on public.company_profile to authenticated;

create or replace function public.save_company_profile(p_name_ar text,p_name_en text,p_phone text,p_fax text,p_address text,p_logo_url text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if (auth.uid()::text) is null or public.current_app_role() not in ('super_admin','manager') then raise exception 'Only managers can update company branding'; end if;
  if nullif(trim(coalesce(p_name_ar,'')),'') is null then raise exception 'اسم الشركة بالعربية مطلوب'; end if;
  if p_logo_url is not null and trim(p_logo_url)<>'' and p_logo_url !~ '^https://[^[:space:]]+$' then raise exception 'Logo URL must use HTTPS'; end if;
  insert into public.company_profile(id,name_ar,name_en,phone,fax,address,logo_url,updated_by,updated_at)
  values(1,trim(p_name_ar),nullif(trim(p_name_en),''),nullif(trim(p_phone),''),nullif(trim(p_fax),''),nullif(trim(p_address),''),nullif(trim(p_logo_url),''),(auth.uid()::text),now())
  on conflict(id) do update set name_ar=excluded.name_ar,name_en=excluded.name_en,phone=excluded.phone,fax=excluded.fax,address=excluded.address,logo_url=excluded.logo_url,updated_by=excluded.updated_by,updated_at=now();
end;
$$;
revoke all on function public.save_company_profile(text,text,text,text,text,text) from public,anon;
grant execute on function public.save_company_profile(text,text,text,text,text,text) to authenticated;
