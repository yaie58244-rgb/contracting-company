-- Show a client phone number to every staff member who can view clients, so a
-- sales rep can call or open WhatsApp directly from the client card instead of
-- unlocking the number first. The reveal flow stays available for auditing.
drop policy if exists "client phones visible to assigned rep or claimant" on public.client_phones;
drop policy if exists "client phones readable by staff" on public.client_phones;
create policy "client phones readable by staff" on public.client_phones for select
using (
  public.has_permission('clients','view')
  and exists(select 1 from public.clients c where c.id=client_phones.client_id and c.deleted_at is null)
);

-- The table never received a SELECT grant for signed-in users, so the client
-- card stayed empty even when the policy allowed the rows.
grant select on table public.client_phones to authenticated;
