-- Crestline Insurance — agents table
-- CSR employees who log into the Crestline Core application.
-- Distinct from `customers` (insurance policyholders).
-- Accessed only via service_role from the core backend; no RLS needed.

create extension if not exists "pgcrypto";

create table if not exists public.agents (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  password_hash text not null,
  full_name     text not null,
  role          text not null default 'csr' check (role in ('csr', 'supervisor', 'admin')),
  is_active     boolean not null default true,
  last_login_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists agents_email_idx on public.agents (lower(email));

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists agents_set_updated_at on public.agents;
create trigger agents_set_updated_at
  before update on public.agents
  for each row execute function public.set_updated_at();

comment on table public.agents is 'CSR employees authorized to access the Crestline Core application.';
