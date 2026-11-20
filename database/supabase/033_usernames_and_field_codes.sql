-- 1) Sign in with a username instead of an email address.
--    The auth account keeps an internal email (Supabase Auth needs one); the
--    login API resolves username -> email on the server, so it is never exposed.
alter table public.profiles add column if not exists username text;
create unique index if not exists profiles_username_unique on public.profiles (lower(username)) where username is not null;
alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_format
  check (username is null or (char_length(username) between 2 and 40 and username !~ '[[:space:]@]'));

-- Existing email accounts get the part before "@" as their username when it is
-- unique, so nobody is locked out. The admin can change it from the employees page.
with candidates as (
  select id, lower(split_part(email, '@', 1)) as u
  from public.profiles
  where username is null
    and email not like '%@marketers.aqar.local'
    and email not like '%@users.aqar.local'
), unique_candidates as (
  select u from candidates group by u having count(*) = 1
)
update public.profiles p set username = c.u
from candidates c
join unique_candidates uc on uc.u = c.u
where p.id = c.id
  and c.u ~ '^[a-z0-9._-]{2,40}$'
  and not exists (select 1 from public.profiles x where lower(x.username) = c.u);

-- 2) Field codes: any field can have its own list of values (e.g. N1, N2, N3)
--    that the admin types in Settings; forms then show it as a dropdown.
--    The lookups table already keys rows by "type" (the field name); add a
--    free-text short code next to the existing numeric one.
alter table public.lookups add column if not exists short_code text;
create unique index if not exists lookups_type_short_code_unique
  on public.lookups (type, lower(short_code)) where short_code is not null;
