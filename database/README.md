# crestline-database

Supabase schema migrations and synthetic seed data for the Crestline Insurance partner demo.

Each partner provisions their own Supabase project and applies these migrations to bring the schema and demo data up. The Crestline Core CSR app expects every table here to exist.

## Prereqs

- A Supabase project (SaaS — no local Docker required)
- Node 20+ and npm

## Apply schema

The migrations in `supabase/migrations/` are plain SQL. **Apply each one in filename order** via your Supabase project's SQL Editor:

1. Open your project at https://supabase.com/dashboard
2. Sidebar → **SQL Editor** → **New query**
3. For each migration (in order):
   - `20260426000000_agents.sql` — agents table for CSR auth
   - `20260426010000_agents_must_change_password.sql` — adds the force-password-change flag
   - `20260426020000_demo_schema.sql` — the 10 demo tables (customers, policies, vehicles, drivers, claims, billing_accounts, payment_methods, payments, quotes, auth_events) plus their RLS policies
4. Paste each file's contents into the editor and click **Run**

## Seed demo data

After all migrations have been applied, load the demo data in two steps.

### Step 1: 10 demo tables (~250 hand-crafted rows)

In the Supabase SQL Editor, paste the contents of `supabase/seed.sql` and click **Run**. This populates `customers`, `policies`, `vehicles`, etc. with the canonical Crestline demo personas (Jennifer Martinez, Marcus Thompson, Sarah Chen, etc.) using stable UUIDs that match all internal docs and Talkdesk Studio flows.

### Step 2: agent accounts (CSR logins)

```bash
cp .env.example .env       # then fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
npm install
npm run seed:agents        # creates 5 demo CSR agents
```

The service role key is in the Supabase dashboard → **Project Settings** → **API** → `service_role`. **Never commit `.env`** — it's gitignored.

### Demo agent credentials (after `npm run seed:agents`)

All 5 share the same password for the demo: `DemoPass123!`. They are seeded with `must_change_password = false` so the canned "log in as alice" demo works without friction.

| Email | Name | Role |
|---|---|---|
| alice@crestline.com | Alice Anderson | csr |
| bob@crestline.com | Bob Bennett | csr |
| carol@crestline.com | Carol Chen | csr |
| dave@crestline.com | Dave Davis | csr |
| erin@crestline.com | Erin Evans | supervisor |

To rotate a password before sharing the demo (which forces the user to change it again on next login), run from the `core/` repo:

```bash
npm run admin:set-password alice@crestline.com NewPassword123
```

To create a new agent (e.g., for a partner engineer):

```bash
npm run admin:create-agent priya@partner.com "Priya Shah" csr 'TempPass-9k2m'
```

The new agent will be required to change their password on first login.

## Repo layout

```
supabase/
  migrations/                # versioned SQL — apply in filename order
    20260426000000_agents.sql
    20260426010000_agents_must_change_password.sql
    20260426020000_demo_schema.sql
  seed.sql                   # demo customer/policy/claim/etc. data (apply once after migrations)
seed/                        # TypeScript seed scripts (currently: agents)
  agents.ts
.env.example                 # template — copy to .env, never commit
```

## What partners get

After running everything above against a fresh Supabase project, partners have:

- **10 demo customers** spread across TX, NY (with one international phone) — covers the Auto / Home / Umbrella LOBs
- **17 policies** with realistic effective/expiration dates
- **15 vehicles**, **11 drivers**, **8 claims** (across various statuses), **9 billing accounts** (some past-due, some current with autopay), **10 payment methods**, **14 payments**
- **~150 auth events** — populates the Auth Activity dashboard with realistic OTP traffic
- **5 demo agents** they can log into the CSR app with
