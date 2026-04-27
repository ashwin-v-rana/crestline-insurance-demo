# Crestline Insurance — Talkdesk Multi-Agent Demo

A partner-recreatable reference deployment showing how a property &
casualty insurance carrier can use Talkdesk's Multi-Agent AI to
automate self-service across voice and chat, with a CSR workbench
giving human agents full context when conversations escalate.

This is the **entry point** for Talkdesk partners building joint
customer demos. It points at four specialized repos — clone all of
them, follow the setup order below, and you'll have a working demo
running against your own infrastructure.

## Try it live

**[crestline-partner-core.vercel.app](https://crestline-partner-core.vercel.app/)**

Demo CSR logins (all use password `DemoPass123!`):

| Email | Role |
|---|---|
| `alice@crestline.com` | CSR |
| `bob@crestline.com` | CSR |
| `carol@crestline.com` | CSR |
| `dave@crestline.com` | CSR |
| `erin@crestline.com` | Supervisor |

## What's included

Five repos under the Crestline Insurance umbrella:

| Repo | Purpose |
|---|---|
| [`crestline-insurance-demo`](https://github.com/ashwin-v-rana/crestline-insurance-demo) | **You are here.** Entry point + cross-repo setup guide. |
| [`Crestline_partner_core`](https://github.com/ashishaidemos022/Crestline_partner_core) | Next.js 15 CSR Workbench: agent login, customer lookup, policy/claims views. Reads from Supabase. |
| [`crestline-database`](https://github.com/ashwin-v-rana/crestline-database) | Supabase migrations + seed data. 11 tables (10 demo + agents). |
| [`crestline-talkdesk`](https://github.com/ashwin-v-rana/crestline-talkdesk) | Talkdesk AI Agent system + 3 Studio flows (Voice / Chat / Send SMS). Includes [`MASTER_DESIGN.md`](https://github.com/ashwin-v-rana/crestline-talkdesk/blob/main/MASTER_DESIGN.md) — the full agent architecture spec. |
| [`Crestline_Partners`](https://github.com/ashishaidemos022/Crestline_Partners) | Static marketing site (carrier branding). |

## Architecture

```
                     Customer (voice or chat)
                                │
                                ▼
                ┌──────────────────────────────┐
                │  Talkdesk Studio Flow        │  on escalation:
                │  (Voice Gold / Chat Gold)    ├─────────────┐
                └──────────────┬───────────────┘             │
                               ▼                             ▼
                ┌──────────────────────────────┐    ┌──────────────┐
                │  Talkdesk AI Agent System    │    │ Live human   │
                │  (Crestline_Insurance)       │    │ CSR via ring │
                │                              │    │ group        │
                │  Orchestrator → 7 sub-agents │    │ "agents"     │
                └──┬─────────┬─────────┬───────┘    └──────┬───────┘
                   │         │         │                   │
              SMS OTP   SQL queries   Email                │ uses
              via Send  via Supabase  confirmations        │
              SMS Gold  MCP           via n8n MCP          │
                   │         │         │                   ▼
                   ▼         ▼         ▼          ┌──────────────────┐
            ┌──────────┐ ┌────────┐ ┌──────────┐  │ Core CSR         │
            │ Twilio   │ │Supabase│ │ n8n      │  │ Workbench        │
            │ (SMS)    │ │Postgres│ │ workflow │  │ (Next.js +       │
            └──────────┘ └────┬───┘ └──────────┘  │  Vercel)         │
                              │                   └────────┬─────────┘
                              │ anon-key reads             │ login
                              └────────────────────────────┘
```

The eight Talkdesk agents deployed today:

1. **Crestline Orchestrator** — supervises, routes, relays sub-agent
   messages verbatim. Zero business logic.
2. **Auth Agent** — phone-based identity verification via 6-digit SMS
   OTP.
3. **Policy Agent** — mailing-address updates only.
4. **Vehicle Agent** — add / remove vehicles on the active Auto policy.
5. **Drivers Agent** — add / remove drivers on the active Auto policy.
6. **Claims Agent** — Auto FNOL (first notice of loss) only.
7. **Claims Knowledge Agent** — read-only claim status, deductible /
   coverage Q&A, general insurance KB lookups.
8. **Escalation Agent** — stub that warm-transfers billing and quote
   intents to a human.

For the full target architecture (including agents not yet built), see
[`MASTER_DESIGN.md`](https://github.com/ashwin-v-rana/crestline-talkdesk/blob/main/MASTER_DESIGN.md)
in the talkdesk repo.

## What you'll need

- A **Supabase** account (free tier is fine for the demo).
- A **Talkdesk** tenant with AI Agent Platform + Studio access.
- A **Vercel** account for hosting the CSR app.
- An **SMS-capable DID** provisioned in your Talkdesk tenant for OTP
  delivery.
- An **n8n** instance _(optional)_ if you want the email-confirmation
  flow. Skip if you remove the email steps from the agent prompts.

## Setup order across repos

The pieces have dependencies on each other — set them up in this
order. Detailed steps for each phase live in the linked sub-repo's
README.

1. **Provision your database** —
   [`crestline-database`](https://github.com/ashwin-v-rana/crestline-database)
   - Create a fresh Supabase project.
   - Apply migrations via Supabase Studio SQL Editor in filename
     order.
   - Run `supabase/seed.sql` for demo personas (~250 rows).
   - Run `npm run seed:agents` to seed the 5 demo CSR agents.
2. **Deploy the CSR Workbench** —
   [`Crestline_partner_core`](https://github.com/ashishaidemos022/Crestline_partner_core)
   - Set the four required Vercel env vars
     (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
     `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`).
   - Deploy. Confirm you can log in at the live URL with one of the
     demo CSR accounts.
3. **Set up Talkdesk tenant primitives** —
   [`crestline-talkdesk`](https://github.com/ashwin-v-rana/crestline-talkdesk)
   - Create MCP server connections (Supabase, n8n if used).
   - Create a ring group named `agents`.
   - Create the "Add + if needed" Talkdesk function.
   - Provision an SMS-capable DID.
4. **Import the 4 JSON files** —
   [`crestline-talkdesk`](https://github.com/ashwin-v-rana/crestline-talkdesk)
   - In order: Send SMS Gold → AI Agent system → Voice Gold → Chat
     Gold.
   - Re-bind connection IDs and capture endpoint UUIDs as you go.
5. **Test end-to-end** — call your Talkdesk inbound number, verify the
   agent answers, walks through OTP, and can update an address or
   file an FNOL against your Supabase project.

For the optional carrier marketing site, see
[`Crestline_Partners`](https://github.com/ashishaidemos022/Crestline_Partners)
— it's a static site with no dependencies on the rest of the demo.

## Help & contributing

Each sub-repo's README is the source of truth for its own setup
steps. If something is unclear or broken, open an issue on the
specific sub-repo. Pull requests welcome.

This is a demo — optimize for partner ease-of-setup over production
hardening. Don't be surprised by hardcoded demo data (e.g., a fixed
adjuster on every claim) or simplifications called out in the
talkdesk repo's design doc.
