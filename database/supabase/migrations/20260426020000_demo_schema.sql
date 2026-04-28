-- Crestline Insurance — demo schema (10 tables)
--
-- The Crestline Core CSR app reads these tables via the anon role
-- with permissive read-only RLS policies. Writes happen exclusively
-- through Core's service-role-backed /api/* routes (Phase 2), which
-- bypass RLS, so no INSERT/UPDATE/DELETE policies are defined.
--
-- Tables are created in foreign-key dependency order. Apply this once
-- to a fresh Supabase project, then run seed.sql to populate demo data.

create extension if not exists "pgcrypto";

-- ==========================================================================
-- 1. customers
-- ==========================================================================
create table public.customers (
  cid              uuid primary key default gen_random_uuid(),
  phone            text not null unique
                     check (phone is not null and phone ~ '^\+[1-9]\d{10,14}$'),
  email            varchar,
  first_name       varchar,
  last_name        varchar,
  mailing_address  jsonb default '{}'::jsonb,
  demo_otp         varchar default '123456',
  source           varchar default 'synthetic',
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

create index idx_customers_phone on public.customers (phone);

-- ==========================================================================
-- 2. policies
-- ==========================================================================
create table public.policies (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid not null references public.customers(cid),
  policy_number     varchar not null unique,
  type              varchar not null check (type in ('auto', 'home', 'umbrella')),
  status            varchar not null default 'active'
                      check (status in ('active','cancelled','lapsed','non_renew','pending')),
  effective_date    date not null,
  expiration_date   date not null,
  premium_amount    numeric,
  dwelling_address  jsonb,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index idx_policies_customer on public.policies (customer_id);
create index idx_policies_type     on public.policies (type);

-- ==========================================================================
-- 3. vehicles
-- ==========================================================================
create table public.vehicles (
  id                  uuid primary key default gen_random_uuid(),
  policy_id           uuid not null references public.policies(id),
  vin                 varchar,
  year                integer not null,
  make                varchar not null,
  model               varchar not null,
  trim                varchar,
  usage               varchar default 'commute'
                        check (usage in ('commute','pleasure','business')),
  annual_mileage      integer,
  ownership           varchar default 'owned'
                        check (ownership in ('owned','leased','financed')),
  lienholder_name     varchar,
  lienholder_address  jsonb,
  garaging_address    jsonb default '{}'::jsonb,
  status              varchar not null default 'active'
                        check (status in ('active','inactive')),
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create index idx_vehicles_policy on public.vehicles (policy_id);
create index idx_vehicles_active on public.vehicles (policy_id) where status = 'active';

-- ==========================================================================
-- 4. drivers
-- ==========================================================================
create table public.drivers (
  id                       uuid primary key default gen_random_uuid(),
  policy_id                uuid not null references public.policies(id),
  first_name               varchar not null,
  last_name                varchar not null,
  date_of_birth            date not null,
  license_number           varchar,
  license_state            varchar,
  relationship             varchar default 'self'
                             check (relationship in ('self','spouse','child','other')),
  is_primary_named_insured boolean default false,
  primary_vehicle_id       uuid references public.vehicles(id),
  status                   varchar not null default 'active'
                             check (status in ('active','inactive')),
  created_at               timestamptz default now(),
  updated_at               timestamptz default now()
);

create index idx_drivers_policy on public.drivers (policy_id);
create index idx_drivers_active on public.drivers (policy_id) where status = 'active';

-- ==========================================================================
-- 5. claims
-- ==========================================================================
create table public.claims (
  id                    uuid primary key default gen_random_uuid(),
  customer_id           uuid not null references public.customers(cid),
  policy_id             uuid not null references public.policies(id),
  claim_number          varchar not null unique,
  loss_type             varchar not null,
  loss_date             date not null
                          check (loss_date <= current_date
                            and loss_date > (current_date - interval '5 years')),
  loss_description      text,
  loss_location         varchar,
  status                varchar not null default 'reported'
                          check (status in ('reported','assigned','under_investigation','estimate_pending','approved','closed')),
  adjuster_name         varchar,
  adjuster_phone        varchar,
  adjuster_email        varchar,
  police_report_number  varchar,
  vehicle_id            uuid references public.vehicles(id),
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

create index idx_claims_customer on public.claims (customer_id);
create index idx_claims_policy   on public.claims (policy_id);
create index idx_claims_status   on public.claims (status);

-- ==========================================================================
-- 6. billing_accounts
-- ==========================================================================
create table public.billing_accounts (
  id                 uuid primary key default gen_random_uuid(),
  customer_id        uuid not null references public.customers(cid),
  balance            numeric not null default 0,
  due_date           date,
  status             varchar not null default 'current'
                       check (status in ('current','past_due','payment_pending')),
  payment_frequency  varchar default 'monthly'
                       check (payment_frequency in ('monthly','quarterly','semi_annual','annual')),
  autopay_enabled    boolean default false,
  paperless_enabled  boolean default false,
  billing_email      varchar,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

create index idx_billing_customer on public.billing_accounts (customer_id);

-- ==========================================================================
-- 7. payment_methods
-- ==========================================================================
create table public.payment_methods (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.customers(cid),
  type         varchar not null check (type in ('credit_card','debit_card','bank_account')),
  last_four    varchar not null,
  brand        varchar,
  is_default   boolean default false,
  created_at   timestamptz default now()
);

create index idx_payment_methods_customer on public.payment_methods (customer_id);

-- ==========================================================================
-- 8. payments
-- ==========================================================================
create table public.payments (
  id                   uuid primary key default gen_random_uuid(),
  billing_account_id   uuid not null references public.billing_accounts(id),
  payment_method_id    uuid references public.payment_methods(id),
  amount               numeric not null,
  status               varchar not null default 'completed'
                         check (status in ('completed','pending','failed','refunded')),
  confirmation_number  varchar not null,
  created_at           timestamptz default now()
);

create index idx_payments_billing on public.payments (billing_account_id);

-- ==========================================================================
-- 9. quotes
-- ==========================================================================
create table public.quotes (
  id                 uuid primary key default gen_random_uuid(),
  reference_number   varchar not null unique,
  contact_name       varchar,
  contact_email      varchar,
  contact_phone      varchar,
  quote_data         jsonb default '{}'::jsonb,
  estimated_premium  numeric,
  coverage_level     varchar check (coverage_level in ('basic','standard','full')),
  status             varchar default 'active'
                       check (status in ('active','expired','converted')),
  created_at         timestamptz default now(),
  expires_at         timestamptz
);

-- ==========================================================================
-- 10. auth_events
-- ==========================================================================
create table public.auth_events (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid references public.customers(cid),
  event_type        varchar not null
                      check (event_type in ('otp_sent','otp_verified','otp_failed','otp_expired','auth_success','auth_failed','step_up_sent','step_up_verified','step_up_failed','lockout')),
  delivery_method   varchar check (delivery_method in ('sms','email')),
  result            varchar not null check (result in ('success','failure')),
  ip_address        varchar,
  created_at        timestamptz default now()
);

create index idx_auth_events_customer on public.auth_events (customer_id);

-- ==========================================================================
-- Row Level Security
-- ==========================================================================
-- Each demo table is read-only for the anon role. Writes go through Core's
-- service-role-backed /api/* routes (which bypass RLS).

alter table public.customers        enable row level security;
alter table public.policies         enable row level security;
alter table public.vehicles         enable row level security;
alter table public.drivers          enable row level security;
alter table public.claims           enable row level security;
alter table public.billing_accounts enable row level security;
alter table public.payment_methods  enable row level security;
alter table public.payments         enable row level security;
alter table public.quotes           enable row level security;
alter table public.auth_events      enable row level security;

create policy anon_read_customers        on public.customers        for select to anon using (true);
create policy anon_read_policies         on public.policies         for select to anon using (true);
create policy anon_read_vehicles         on public.vehicles         for select to anon using (true);
create policy anon_read_drivers          on public.drivers          for select to anon using (true);
create policy anon_read_claims           on public.claims           for select to anon using (true);
create policy anon_read_billing_accounts on public.billing_accounts for select to anon using (true);
create policy anon_read_payment_methods  on public.payment_methods  for select to anon using (true);
create policy anon_read_payments         on public.payments         for select to anon using (true);
create policy anon_read_quotes           on public.quotes           for select to anon using (true);
create policy anon_read_auth_events      on public.auth_events      for select to anon using (true);
