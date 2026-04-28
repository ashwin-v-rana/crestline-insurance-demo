# crestline-talkdesk

Talkdesk Multi-Agent AI configurations and Studio flow exports for the
Crestline Insurance partner demo.

## What's in this repo

Four importable artifacts:

| File | What it is |
|---|---|
| `crestline-ai-agent-system_english.json` | The full 8-agent system (Orchestrator + Auth + Policy + Vehicle + Drivers + Claims + Claims Knowledge + Escalation), exported from Talkdesk AI Agent Platform. |
| `PC26 Crestline Send SMS Gold - v4.json` | API-triggered Studio flow that sends OTP codes via SMS. The Auth Agent's `send_one_time_pin` workflow tool calls this. |
| `PC26 Crestline Insurance Voice Gold - v5.json` | Voice Studio flow that hands inbound calls to the AI Agent system and falls back to a ring group on escalation. |
| `PC26 Crestline Insurance Chat Gold - v2.json` | Chat Studio flow, same pattern as Voice. |

`MASTER_DESIGN.md` is the design doc that drives the agent architecture.
The "Implementation State (2026-04-27)" section near the top documents
what's deployed today vs. what's still target-state.

## Setup overview

Standing up this demo in a Talkdesk tenant is a multi-step process.
**Partner tenant configuration cannot be fully automated.** Talkdesk
regenerates several IDs on import (MCP server connection IDs, function
IDs, AI Agent endpoint UUIDs) and requires UI-only steps to wire them
back together. Several values in the JSONs are also Crestline-specific
and must be swapped — see "Per-tenant values to swap" below.

The end-to-end setup is roughly:

1. **Pre-Talkdesk infrastructure** — Supabase project, database
   migrations, seed data, n8n email workflow (or substitute), SMS
   provider DID. _(See "Pre-Talkdesk setup" below — TODO.)_
2. **Talkdesk tenant primitives** — MCP server connections (Supabase,
   n8n), the `agents` ring group, the "Add + if needed" function,
   any reusable Connections. _(See "Talkdesk primitives" below — TODO.)_
3. **Import the 4 JSON files in order** — _(detailed below)_.
4. **Post-import wiring** — re-bind connection IDs, capture the
   AI Agent endpoint, test the auth flow end-to-end. _(See "Post-import
   wiring" below — TODO.)_

## Pre-Talkdesk setup

_TODO_

## Talkdesk primitives

_TODO_

## Importing the 4 JSON files

Order matters — there are dependencies between the artifacts.

### 1. Import `PC26 Crestline Send SMS Gold - v4.json`

This is a standalone API-triggered flow with no dependencies on the
other artifacts, so import it first.

- **Where:** Talkdesk Studio → Flows → Import flow
- **After import:**
  - Open the flow → "Send SMS" step → set the **Outbound sender**
    number to a DID provisioned in your tenant. The committed file
    has `+12178820101` as the Crestline reference value; replace
    with your number.
  - Open the **"Add + if needed"** step → re-bind it to the
    function in your tenant. The committed flow references function
    ID `8fe1202a5ae840519ea99c6f08987bba`, which is internal to the
    Crestline tenant. Create an equivalent function (one-line JS
    that prepends `+` if missing from the input number) and bind
    this step to it.
  - **Publish** the flow. Capture its **API trigger URL** — you'll
    need it in step 2.

### 2. Import `crestline-ai-agent-system_english.json`

The 8-agent system. Depends on the Send SMS Gold flow (step 1) and
on your tenant's MCP server connections being set up.

- **Where:** Talkdesk AI Agent Platform → Agent Systems → Import
- **After import:**
  - **Re-bind Supabase MCP connection** on every agent that uses
    `execute_sql` (Auth, Policy, Vehicle, Drivers, Claims, Claims
    Knowledge — 6 agents). The imported `mcp_server_id` references
    Crestline's Talkdesk tenant; replace with your tenant's
    Supabase MCP connection ID.
  - **Re-bind n8n email MCP connection** on every agent that uses
    `Call_Send_Email_claims_` (Policy, Vehicle, Drivers, Claims —
    4 agents). Skip this step if you've removed the email-sending
    sections from the prompts.
  - **Re-bind the `send_one_time_pin` workflow tool** on the Auth
    Agent → point its Connection/Action at the API trigger URL you
    captured from step 1.
  - **Publish** the agent system. Capture its **endpoint UUID** —
    you'll need it in steps 3 and 4. The committed Voice/Chat flows
    use Crestline's endpoint (`cb3669a5-8d0d-49c6-a143-292c667b9494`);
    yours will be different.

### 3. Import `PC26 Crestline Insurance Voice Gold - v5.json`

Routes inbound voice calls to the AI Agent system. Depends on step 2.

- **Where:** Talkdesk Studio → Flows → Import flow
- **Before import:** open the JSON, find the `Autopilot voice` step,
  replace the `va_parameters.endpoint` UUID
  (`cb3669a5-8d0d-49c6-a143-292c667b9494`) with the endpoint from
  step 2.
- **After import:**
  - Open the **Assignment and dial** step → confirm it points at a
    ring group named `agents`. Create that ring group in your
    tenant if it doesn't exist, or edit the step to point at your
    own ring group.
  - **Publish** the flow.
  - Wire it to an inbound number in your Talkdesk tenant's number
    pool.

### 4. Import `PC26 Crestline Insurance Chat Gold - v2.json`

Routes inbound chat messages to the AI Agent system. Depends on
step 2. Same pattern as step 3.

- **Where:** Talkdesk Studio → Flows → Import flow
- **Before import:** open the JSON, find the `Autopilot digital`
  step, replace the `flow_id` UUID
  (`cb3669a5-8d0d-49c6-a143-292c667b9494`) with the endpoint from
  step 2.
- **After import:**
  - Open the **Assign agents to message** step → confirm it points
    at the `agents` ring group.
  - **Publish** the flow.
  - Wire it to a chat channel in your Talkdesk tenant.

## Post-import wiring

_TODO_

## Per-tenant values to swap

The committed JSONs have Crestline reference values literal in the
file. Internal Crestline tenants import them as-is. External partners
must replace these four values — either by editing the JSONs in a
text editor before import, or by editing the corresponding fields
in Talkdesk after import.

| Value | Default | Where it appears | When to swap |
|---|---|---|---|
| Supabase project ref | `mmcswqvakxkyrmqvwohn` | AI Agent JSON, 6× in `mcp_server_url` for `execute_sql` tools | Before import, or via Talkdesk MCP server settings after |
| n8n email MCP URL | `https://n8n.srv973863.hstgr.cloud/mcp/a1f5fd5f-…` | AI Agent JSON, 4× in `mcp_server_url` for `Call_Send_Email_claims_` tools | Same |
| AI Agent endpoint UUID | `cb3669a5-8d0d-49c6-a143-292c667b9494` | Voice flow (`va_parameters.endpoint`) and Chat flow (`flow_id`), 1× each | Before import — get the new endpoint from publishing the AI Agent system in step 2 |
| Outbound SMS number | `+12178820101` | Send SMS Gold flow, 1× in the "Send SMS" step's outbound sender | Before import, or via Studio after |

Everything else that needs swapping (MCP connection IDs, function
bindings, ring groups, OTP workflow wiring) must be done manually in
the Talkdesk UI — there's no JSON path to those values.

## Re-exporting from Talkdesk

When you change agent prompts or routing in your Talkdesk tenant and
want to update this repo, re-export from Talkdesk and replace the
top-level JSONs. If the re-export brings in new tenant-specific values
that partners would also need to swap, add them to the table above.

## Repo conventions

- Top-level JSONs are the **source of truth**, with Crestline reference
  defaults literal in the file. Internal imports use them as-is.
- Branch for substantial changes; merge to `main` directly when stable.
  No PR ceremony required.

## License

See parent repo.
