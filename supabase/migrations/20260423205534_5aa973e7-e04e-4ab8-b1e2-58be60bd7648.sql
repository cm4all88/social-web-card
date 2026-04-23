
create table public.social_links (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  url text not null default '',
  display_order int not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.social_links enable row level security;

create policy "Public can view enabled links"
  on public.social_links for select
  using (enabled = true);

create policy "Authenticated can view all"
  on public.social_links for select
  to authenticated
  using (true);

create policy "Authenticated can insert"
  on public.social_links for insert
  to authenticated
  with check (true);

create policy "Authenticated can update"
  on public.social_links for update
  to authenticated
  using (true) with check (true);

create policy "Authenticated can delete"
  on public.social_links for delete
  to authenticated
  using (true);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger social_links_updated_at
  before update on public.social_links
  for each row execute function public.set_updated_at();

insert into public.social_links (platform, url, display_order) values
  ('instagram', '', 1),
  ('snapchat', '', 2),
  ('facebook', '', 3),
  ('gmail', '', 4);
