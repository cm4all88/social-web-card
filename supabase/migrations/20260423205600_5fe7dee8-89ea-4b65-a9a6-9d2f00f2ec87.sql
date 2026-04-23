
-- Fix function search_path
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin new.updated_at = now(); return new; end;
$$;

-- Roles
create type public.app_role as enum ('admin', 'user');

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role public.app_role not null,
  unique (user_id, role)
);

alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create policy "Users can view their own roles"
  on public.user_roles for select
  to authenticated
  using (user_id = auth.uid());

-- Replace permissive policies on social_links
drop policy if exists "Authenticated can view all" on public.social_links;
drop policy if exists "Authenticated can insert" on public.social_links;
drop policy if exists "Authenticated can update" on public.social_links;
drop policy if exists "Authenticated can delete" on public.social_links;

create policy "Admins can view all"
  on public.social_links for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create policy "Admins can insert"
  on public.social_links for insert
  to authenticated
  with check (public.has_role(auth.uid(), 'admin'));

create policy "Admins can update"
  on public.social_links for update
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

create policy "Admins can delete"
  on public.social_links for delete
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- Auto-grant admin to the FIRST user who signs up
create or replace function public.grant_first_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.user_roles where role = 'admin') then
    insert into public.user_roles (user_id, role) values (new.id, 'admin');
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created_grant_admin
  after insert on auth.users
  for each row execute function public.grant_first_admin();
