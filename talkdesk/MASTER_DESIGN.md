# P&C Insurance Multi-Agent System — Master Design
## Talkdesk Multi Agent Framework

**Version:** Consolidated Master (v3)
**Scope:** Voice + Chat AI Agents for Property & Casualty Insurance
**Lines of Business:** Auto (primary), Home (limited), Umbrella (limited)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Line of Business Automation Matrix](#3-line-of-business-automation-matrix)
4. [Phased Rollout Model](#4-phased-rollout-model)
5. [Agent Contracts](#5-agent-contracts)
6. [Shared Persona & Guardrails](#6-shared-persona--guardrails)
7. [Orchestrator Agent](#7-orchestrator-agent)
8. [Auth Agent](#8-auth-agent)
9. [Policy Agent](#9-policy-agent)
10. [Claims Agent](#10-claims-agent)
11. [Billing Agent](#11-billing-agent)
12. [Quote Agent](#12-quote-agent)
13. [Address Data Model](#13-address-data-model)
14. [Voice vs. Chat Adaptation](#14-voice-vs-chat-adaptation)
15. [Error Handling & Warm Transfers](#15-error-handling--warm-transfers)
16. [Compliance & Regulatory Notes](#16-compliance--regulatory-notes)
17. [Complete Tool Inventory](#17-complete-tool-inventory)
18. [Configuration Management](#18-configuration-management)
19. [Worked Examples](#19-worked-examples)
20. [Testing Scenarios](#20-testing-scenarios)
21. [Implementation Checklist](#21-implementation-checklist)

---

## 1. Executive Summary

This document defines a multi-agent AI system for a P&C insurance
carrier, built on Talkdesk's Multi Agent framework, serving both voice
and chat channels.

**Automated use cases (subject to phased rollout):**
- Update address (mailing and garaging for Auto)
- Update vehicles and drivers (Auto)
- Receive ID cards (email, text, or mail)
- First Notice of Loss reporting (Auto)
- Claim status inquiries (all LOBs)
- Self-service payments (all LOBs)
- Billing inquiries (all LOBs)
- Change payment schedules (all LOBs)
- Manage billing preferences (all LOBs)
- New business quick quote (Auto)

**Design principles:**

1. **Thin Orchestrator.** The Orchestrator handles only greeting, coarse
   routing, and conversation lifecycle. It contains zero business logic.

2. **Isolated Authentication.** All identity verification lives in a
   dedicated Auth Agent, callable at conversation start and for step-up
   authentication before sensitive operations.

3. **Domain Ownership.** Each domain agent (Policy, Claims, Billing,
   Quote) owns its fine-grained intent classification, edge cases, and
   escalation decisions within its scope.

4. **Configuration-Driven Enablement.** Use cases are enabled via JSON
   configuration, not prompt edits. New capabilities roll out as config
   changes.

5. **Graceful Escalation.** Non-automated requests warm-transfer to
   human specialists with full conversation context. The customer
   experience never distinguishes between "we can't do this yet" and
   "this requires human judgment."

6. **Auto-First LOB Strategy.** Auto gets full automation. Home and
   Umbrella get billing and claim status only. Everything else for
   Home/Umbrella escalates.

---

## Implementation State (2026-04-27)

The rest of this document describes the **target architecture**. This
section documents what is **actually deployed today** in the
`Crestline_Insurance` Talkdesk agent system (system version 16, draft
status). Read this first to calibrate expectations, then read the rest
as forward-looking design. When reality catches up to the design, this
section gets deleted.

### Deployed agents (8 total)

| # | Agent name (in Talkdesk)   | Role               | Scope as deployed |
|---|----------------------------|--------------------|-------------------|
| 1 | **Crestline Orchestrator** | `SUPERVISING_AGENT`| Greeting, routing, verbatim relay of sub-agent `customer_message`, warm-handoff messaging on escalate. Zero business logic. |
| 2 | **Auth Agent**             | `ACTION_AGENT`     | Phone-based identity verification via 6-digit SMS OTP. Sets four session variables: `customer_id`, `customer_fname`, `customer_lname`, `customer_email`. |
| 3 | **Policy Agent**           | `ACTION_AGENT`     | **Mailing-address updates only.** Writes `customers.mailing_address` JSONB. Every other request (including physical moves) → `escalate` to `policy_service`. |
| 4 | **Vehicle Agent**          | `ACTION_AGENT`     | Add / remove vehicle on the active Auto policy. Free-text VIN (no VIN decode). Garaging address collected at add time. Soft-delete on removal. ID card / proof of coverage / replace → escalate. |
| 5 | **Drivers Agent**          | `ACTION_AGENT`     | Add / remove non-self, non-named-insured driver on the active Auto policy. License number/state optional. No MVR check. Soft-delete on removal. |
| 6 | **Claims Agent**           | `ACTION_AGENT`     | Auto FNOL only. Collects loss date/type/location/description, police report number, and vehicle, then INSERTs into `claims` with a hardcoded adjuster (Sarah Mitchell). Status / Q&A → reroute to Claims Knowledge. Home/Umbrella FNOL → escalate. |
| 7 | **Claims Knowledge Agent** | `ACTION_AGENT`     | Read-only. Claim status lookup, claim-specific explanations, and general insurance Q&A backed by Talkdesk's `search_knowledge_internal` against the `crestline_claims` segment. |
| 8 | **Escalation Agent**       | `ACTION_AGENT`     | Stub. Classifies the request as billing or quote, returns `escalate` with `billing_specialist` or `sales_agent` target. No data collection. Stands in for the still-unbuilt Billing and Quote agents. |

### What the design specifies but isn't built

- **Billing Agent** (entire section 11) — not built. Billing requests
  route to the Escalation Agent stub, which warm-transfers to a human
  `billing_specialist`. None of the billing tools (`get_billing_summary`,
  `process_payment`, `update_autopay`, etc.) exist.
- **Quote Agent** (entire section 12) — not built. Quote requests route
  to the Escalation Agent stub, which warm-transfers to a `sales_agent`.
  No `generate_auto_quote`, `vin_decode`, or `save_quote` tools exist.
- **Step-up authentication** — `requires_step_up_auth` status is
  defined in the contract (section 5b) but no deployed agent ever
  returns it, and the Orchestrator has no step-up auth handler.
- **ID card delivery / proof of insurance** — Vehicle Agent escalates
  these. No `send_id_card` tool exists.
- **Vehicle replace / VIN decode / MVR check / address validation** —
  none of `replace_vehicle`, `vin_decode`, `driver_mvr_check`,
  `validate_address` exist. Free-text fields go directly to SQL.
- **Tow / rental during FNOL** — no `request_tow` or `setup_rental`
  tools. The Auto FNOL flow records the loss and assigns a hardcoded
  adjuster.
- **Physical-move automation (Path B in section 9)** — Policy Agent
  escalates all physical moves regardless of LOB mix.
- **Rich auth context** — the contract in section 5a shows the Auth
  Agent returning policies, vehicles, claims, billing_status, etc.
  The deployed Auth Agent only persists four scalar session variables
  (`customer_id`, `customer_fname`, `customer_lname`, `customer_email`).
  Each domain agent re-queries Postgres for what it needs.

### Config-driven enablement: aspirational

Section 4 (Phased Rollout) and section 18 (Configuration Management)
describe an `enabled_domains` / `enabled_use_cases` / `backlog_use_cases`
/ `lob_automation_matrix` JSON config layer with kill switches and
per-channel overrides. **None of that is implemented.** Phasing today
lives entirely in two places:

1. The Orchestrator's `routing_condition` and `instruction` prose,
   which hardcodes which intents go to which agent.
2. Each ACTION_AGENT's `instruction` text, which prose-encodes what
   that agent does and what it escalates.

There is no external config store, no kill switch, no per-channel
config, no graceful-degradation default.

### As-built tool inventory

The deployed system uses six tools total across all agents:

| Tool                       | Type                | Used by                                                              | Purpose |
|----------------------------|---------------------|----------------------------------------------------------------------|---------|
| `execute_sql`              | Supabase MCP        | Policy, Vehicle, Drivers, Claims, Claims Knowledge, Auth             | Raw SQL against the partner Supabase project |
| `Call_Send_Email_claims_`  | n8n MCP             | Policy, Vehicle, Drivers, Claims                                     | Send branded confirmation email after a successful write |
| `get_customer_context`     | Talkdesk workflow   | Policy, Vehicle, Drivers, Claims, Claims Knowledge                   | Read session vars set by Auth |
| `set_customer_context`     | Talkdesk workflow   | Auth                                                                 | Persist session vars after successful OTP |
| `send_one_time_pin`        | Talkdesk workflow   | Auth                                                                 | Generate a 6-digit OTP and SMS it |
| `search_knowledge_internal`| Talkdesk built-in   | Claims Knowledge                                                     | KB search against the `crestline_claims` segment |

### Channel scope

Only chat is wired up at present (`conversation_settings.enabled = false`,
no voice channel map). All voice-specific guidance in this document
(DTMF, silence-fillers, spelling phonetically) is target-state.

### Known demo shortcuts

These are deliberate simplifications to keep the demo tight, not bugs:

- Claims FNOL inserts a hardcoded adjuster on every claim
  (Sarah Mitchell, +18005551234, sarah.mitchell@crestline-ins.com)
  rather than picking one based on territory/LOB/load.
- All physical-move requests escalate to `policy_service` even when
  the design's Path B logic could automate them.
- Soft-delete on vehicle/driver removal — the rows stay in the table
  with a status flag rather than being archived to a history table.

---

## 2. Architecture Overview

```
    ┌──────────────────────────────────────────────────────────────┐
    │                     ORCHESTRATOR                             │
    │              (Communication + Routing ONLY)                  │
    │                                                              │
    │  Owns: greeting, conversation lifecycle, coarse routing,     │
    │        "anything else?" loop, closing, warm transfers       │
    │                                                              │
    │  Does NOT own: any business logic, intent sub-classification,│
    │        escalation decisions, domain edge cases               │
    └────┬──────────┬──────────┬──────────┬──────────┬────────────┘
         │          │          │          │          │
         ▼          ▼          ▼          ▼          ▼
    ┌─────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
    │  AUTH   │ │ POLICY │ │ CLAIMS │ │BILLING │ │ QUOTE  │
    │  AGENT  │ │ AGENT  │ │ AGENT  │ │ AGENT  │ │ AGENT  │
    └─────────┘ └────────┘ └────────┘ └────────┘ └────────┘
```

**Conversation Flow:**

```
Customer connects
       │
       ▼
  ORCHESTRATOR ──greets──► "How can I help?"
       │
       ├── account access needed? ──► AUTH AGENT ──► returns context
       │
       ├── coarse classify ──► "policy"   ──► POLICY AGENT
       │                  ──► "claims"   ──► CLAIMS AGENT
       │                  ──► "billing"  ──► BILLING AGENT
       │                  ──► "quote"    ──► QUOTE AGENT
       │                  ──► unclear    ──► ask ONE clarifier
       │
       │    ◄── domain agent returns contract signal
       │
       ├── "complete"  ──► "Anything else?" ──► loop or close
       ├── "reroute"   ──► route to indicated domain
       ├── "escalate"  ──► warm transfer with context
       └── "requires_step_up_auth" ──► re-invoke AUTH AGENT
```

---

## 3. Line of Business Automation Matrix

This matrix is the single source of truth for what the system does
with each line of business. All agents respect it.

| Use Case                      | Auto    | Home         | Umbrella     |
|-------------------------------|---------|--------------|--------------|
| **Policy Administration**     |         |              |              |
| Mailing address update        | ✅       | ✅            | ✅            |
| Garaging address update       | ✅       | N/A          | N/A          |
| Dwelling address change       | N/A     | ❌ Escalate   | N/A          |
| Update vehicles               | ✅       | N/A          | N/A          |
| Update drivers                | ✅       | N/A          | N/A          |
| ID cards                      | ✅       | N/A          | N/A          |
| Coverage changes              | ❌       | ❌            | ❌            |
| **Claims**                    |         |              |              |
| FNOL (new claim)              | ✅       | ❌ Escalate   | ❌ Escalate   |
| Claim status                  | ✅       | ✅            | ✅            |
| **Billing**                   |         |              |              |
| Make payment                  | ✅       | ✅            | ✅            |
| Billing inquiry               | ✅       | ✅            | ✅            |
| Change payment schedule       | ✅       | ✅            | ✅            |
| Manage billing preferences    | ✅       | ✅            | ✅            |
| **Quote**                     |         |              |              |
| New business quote            | ✅       | ❌ Escalate   | ❌ Escalate   |

**Summary in plain English:**
- **Auto:** full automation across policy, claims, and billing.
- **Home:** billing (all functions), claim status, and mailing address updates. Everything else escalates.
- **Umbrella:** billing (all functions) and claim status. Everything else escalates.
- **New business quotes:** Auto only.

**Key insight:** Because billing is fully automated across all three
LOBs, the Billing Agent does not need LOB gating for its core functions.
It simply processes whatever billing the customer has. LOB gating is
concentrated in the Policy, Claims, and Quote agents.

---

## 4. Phased Rollout Model

Use cases will be automated one at a time. The design supports this
through two independent configuration layers that stack together:

1. **Phased rollout config** — which specific use cases are built yet?
2. **LOB scope config** — which LOBs does each use case cover?

An intent is executed by the automated flow only if **both** checks pass.
Otherwise, it escalates.

### Domain-Level Config (Orchestrator)

```json
{
  "enabled_domains": {
    "auth": true,
    "policy": true,
    "claims": true,
    "billing": true,
    "quote": false
  }
}
```

If the Orchestrator classifies a request to a disabled domain, it
escalates directly to a human without attempting to route.

### Use-Case-Level Config (Each Domain Agent)

Example for a partially-built Billing Agent:

```json
{
  "enabled_use_cases": ["BILLING_PAYMENT", "BILLING_INQUIRY"],
  "backlog_use_cases": ["BILLING_SCHEDULE", "BILLING_PREFERENCES"]
}
```

When a customer's request classifies to a backlog intent, the domain
agent escalates with a warm handoff.

### Phased Rollout Example — Phase 1 Launch

```json
// Orchestrator
{
  "enabled_domains": {
    "auth": true, "policy": false, "claims": true,
    "billing": true, "quote": false
  }
}

// Claims Agent
{
  "enabled_use_cases": ["CLAIMS_FNOL"],
  "backlog_use_cases": ["CLAIMS_STATUS"]
}

// Billing Agent
{
  "enabled_use_cases": ["BILLING_PAYMENT"],
  "backlog_use_cases": ["BILLING_INQUIRY", "BILLING_SCHEDULE", "BILLING_PREFERENCES"]
}
```

| Customer says...                 | System behavior                             |
|----------------------------------|---------------------------------------------|
| "File a claim"                   | → Claims Agent → FNOL flow (automated)      |
| "Check claim status"             | → Claims Agent → backlog → warm transfer     |
| "Make a payment"                 | → Billing Agent → payment flow (automated)   |
| "Why did my bill go up?"         | → Billing Agent → backlog → warm transfer     |
| "Update my address"              | → Policy domain disabled → warm transfer      |
| "Get a quote"                    | → Quote domain disabled → warm transfer       |

### Escalation Language for Backlog Items

The customer never knows whether a handoff is due to complexity or
backlog. Use warm, intentional phrasing:

**Do say:**
- "I can get you connected with a specialist who handles that."
- "Let me bring in a team member who can take care of this for you."
- "That's something our [policy/claims/billing] team handles directly.
  Let me connect you — I'll share what we've discussed so far."
- "Sure thing — let me transfer you to someone who can walk you through that."

**Do not say:**
- "I'm sorry, I can't help with that." (feels like rejection)
- "That's not something I can do." (implies limitation)
- "That feature isn't available yet." (leaks roadmap)
- "You'll need to speak to a human." (draws attention to AI/human split)

### Configuration Management Recommendations

1. **Store configs externally** — not hardcoded in prompts. Use
   Talkdesk's config layer, env vars, or a feature flag system.
2. **Version configs** — track which use cases were enabled on which
   date for debugging and rollback.
3. **Separate configs per channel** — enable use cases on chat before
   voice (or vice versa) since interaction patterns differ:
   ```json
   {
     "voice": { "enabled_use_cases": ["BILLING_PAYMENT"] },
     "chat": { "enabled_use_cases": ["BILLING_PAYMENT", "BILLING_INQUIRY"] }
   }
   ```
4. **Graceful degradation** — if config fails to load, default to
   escalating everything. Never default to "everything enabled."
5. **Kill switch** — ability to instantly disable any use case without
   a full deployment.

---

## 5. Agent Contracts

Every agent communicates with the Orchestrator through a defined
contract. This keeps the Orchestrator thin — it reads signals and acts
without interpreting business content.

### 5a. Auth Agent → Orchestrator

```json
// INPUT
{
  "action": "initial_auth" | "step_up_auth",
  "channel": "voice" | "chat",
  "known_phone": "...",
  "reason": "session_start" | "sensitive_operation"
}

// OUTPUT
{
  "status": "authenticated" | "failed" | "skipped",
  "customer_context": {
    "customer_id": "...",
    "phone_number": "...",
    "name_first": "...",
    "name_last": "...",
    "mailing_address": {
      "street": "...", "city": "...", "state": "...", "zip": "..."
    },
    "active_policies": [
      {
        "policy_id": "POL-12345",
        "type": "auto",
        "vehicles": [
          {
            "vehicle_id": "VEH-001",
            "year": 2022, "make": "Honda", "model": "Civic",
            "garaging_address": { "..." }
          }
        ]
      },
      {
        "policy_id": "POL-67890",
        "type": "home",
        "dwelling_address": { "..." }
      },
      {
        "policy_id": "POL-55555",
        "type": "umbrella"
      }
    ],
    "policy_types": ["auto", "home", "umbrella"],
    "open_claims": ["CLM-11111"],
    "billing_status": "current" | "past_due" | "payment_pending",
    "auth_level": "otp_verified",
    "auth_timestamp": "..."
  },
  "failure_reason": "max_attempts" | "no_account" | "otp_expired"
}
```

Note: `mailing_address` is a top-level field on the customer record
because it applies to all policies. `garaging_address` is per vehicle.
`dwelling_address` is per home policy. Umbrella policies carry no
address of their own.

### 5b. Domain Agent → Orchestrator

```json
{
  "status": "complete" | "reroute" | "escalate" | "requires_step_up_auth",
  "summary": "Updated mailing address on customer record.",
  "actions_taken": ["mailing_address_updated", "confirmation_email_sent"],
  "reroute_domain": "billing",          // only if status = "reroute"
  "reroute_context": "Customer needs to make a payment",
  "escalation_target": "home_claims_intake",   // only if status = "escalate"
  "escalation_reason": "Home FNOL not automated",
  "conversation_data": { /* collected data */ },
  "customer_sentiment": "calm" | "frustrated" | "distressed"
}
```

The Orchestrator never decides WHY an escalation or reroute is
happening — the domain agent makes that business decision and tells
the Orchestrator what to do.

> **Implementation note (2026-04-27):** the deployed agents return
> `customer_message` (delivered verbatim by the Orchestrator) instead
> of `summary`/`actions_taken`, and reroutes use a `target` field
> rather than `reroute_domain`. The `requires_step_up_auth` status is
> not yet implemented in any deployed agent. See Implementation State.

---

## 6. Shared Persona & Guardrails

Inherited by all agents.

### Persona

```
You are a licensed virtual insurance assistant for [CARRIER NAME],
specializing in Property & Casualty insurance. You are helpful,
empathetic, and efficient. You speak in a warm but professional tone —
like a knowledgeable agent at a local insurance office.
```

### Voice Channel Rules

- Keep responses to 2-3 sentences maximum. Customers are listening, not reading.
- Always confirm critical data by reading it back (addresses, policy numbers, payment amounts).
- Use natural speech: contractions, conversational phrasing.
- Avoid jargon. Say "your car insurance" not "your personal auto policy PAP."
- Max 3 options at a time. Ask "would you like to hear more?" before continuing.
- For sensitive input (OTP, payment info), prompt clearly: "Please say or enter your 6-digit code now."
- After 8 seconds of silence, gently prompt: "Are you still there? Take your time."
- Never spell out URLs or long reference numbers in voice — offer to send via text/email.

### Chat Channel Rules

- Slightly more detailed than voice, but still concise.
- Short paragraphs, not walls of text.
- Numbered lists OK (max 5 options).
- Collect data one field at a time, or use form cards if available.
- Proactively offer confirmations via email.

### Universal Guardrails

- Never provide legal advice. Use: "I can share your coverage details,
  but for legal questions, I'd recommend speaking with your agent or attorney."
- Never guarantee claim outcomes or timelines not confirmed in the system.
- Never disclose another person's information, even if they are on the same
  policy, unless they are authenticated.
- If a customer expresses distress (injury, emergency), lead with empathy:
  "I'm sorry you're going through this. Let's get you taken care of."
- If you cannot resolve the request, return control to the Orchestrator with
  a reroute or escalate signal. Never dead-end.
- Always end with: a summary, next steps, and return control to the Orchestrator.
- PII handling: Never read back full SSN, full card numbers, or full bank
  numbers. Use masking ("ending in 4532").

### Escalation Triggers (signal escalate to Orchestrator when)

- Customer explicitly requests a human
- Request is out of automation scope (per phased rollout or LOB matrix)
- Coverage disputes, claim denials, legal/litigation matters
- Fraud indicators detected
- System errors prevent completion
- Complex endorsements requiring underwriting review

---

## 7. Orchestrator Agent

### Purpose

Owns the conversation thread. Greets, routes, manages transitions,
closes. Contains ZERO business logic.

### Absolute Rule — Never Answer on the Customer's Behalf

This is an architectural commitment, not just a prompt line. The
Orchestrator must never satisfy a sub-agent's question or
confirmation prompt without an actual customer turn. When a
sub-agent asks the Orchestrator to collect information OR to obtain
confirmation (including questions like "Is that correct?", "Is that
all right?", "Do you confirm?"), the Orchestrator MUST:

  1. Voice the question to the customer in natural language.
  2. STOP and wait for the customer's actual typed or spoken response.
  3. Only AFTER the customer responds, relay their actual response
     back to the sub-agent.

The Orchestrator MUST NEVER:

  - Answer the sub-agent's confirmation question itself.
  - Assume the customer confirmed because the data looks right.
  - Reply "Yes, that's correct" to a sub-agent without the customer
    actually saying yes.
  - Skip a customer turn. Every sub-agent question requires a real
    customer response.

This rule applies ESPECIALLY to:

  - Confirmation questions before writes (INSERT, UPDATE).
  - Yes/no questions of any kind.
  - Collection of individual fields (name, date, amount, etc.).

**Why this is architectural, not stylistic:** if violated, the
customer's data may be recorded incorrectly without their
knowledge. This is a data-integrity and consent boundary, not a
phrasing preference. Any future Orchestrator implementation —
prompt-based, fine-tuned, or rule-based — must enforce this rule.

### Prompt

```
ROLE
----
You are the conversational host of [CARRIER NAME]'s virtual assistant.
You own the conversation from open to close. Your responsibilities are:

  1. Greet the customer
  2. Invoke the Auth Agent when account access is needed
  3. Listen to the customer's request
  4. Route to the correct domain agent based on COARSE topic classification
  5. Receive the domain agent's completion signal
  6. Ask if there's anything else
  7. Route again or close the conversation

You do NOT:
  - Execute insurance transactions
  - Make business decisions (escalations, retention, underwriting)
  - Classify detailed intents within a domain
  - Handle domain-specific edge cases
  - Decide what requires a human — domain agents tell you

You are a router and conversational host. Nothing more.

═══════════════════════════════════════════════════════
CONVERSATION LIFECYCLE
═══════════════════════════════════════════════════════

1. GREETING
   Voice: "Thanks for calling [CARRIER NAME]. I'm your virtual
   assistant and I can help with your policy, claims, billing, or
   get you a quick quote."
   
   Chat: "Hi there! Welcome to [CARRIER NAME]. I can help with
   your policy, claims, billing, or get you a quick quote."

2. INITIAL REQUEST
   Listen for the customer's first statement.
   
3. AUTHENTICATION DECISION
   This is the ONE decision you make that touches business context:
   - If the request involves an existing account (policy changes,
     claims, billing, status lookups, anything account-specific)
     → Invoke AUTH AGENT with action: "initial_auth"
   - If the customer only wants a new quote with no account reference
     → Skip auth, route directly to QUOTE AGENT
   - If unclear → ask: "Do you have an existing policy with us,
     or are you looking for a new quote?"

4. POST-AUTH ROUTING
   After the Auth Agent returns "authenticated," use the customer's
   original request to route to a domain.
   
   Greeting after auth: "Hi [FIRST NAME], how can I help you today?"
   (Do NOT announce LOB limitations upfront. They surface contextually.)

   COARSE ROUTING RULES (topic-level only):
   ┌─────────────────────────────────────────────────────────────┐
   │ Customer mentions...              → Route to...            │
   │─────────────────────────────────────────────────────────────│
   │ policy, coverage, address, car,   → POLICY AGENT           │
   │ vehicle, driver, ID card, proof                            │
   │ of insurance                                               │
   │─────────────────────────────────────────────────────────────│
   │ claim, accident, damage, theft,   → CLAIMS AGENT           │
   │ file, report, storm, break-in                              │
   │─────────────────────────────────────────────────────────────│
   │ bill, payment, pay, balance,      → BILLING AGENT          │
   │ amount due, autopay, due date,                             │
   │ charge, premium, rate                                      │
   │─────────────────────────────────────────────────────────────│
   │ quote, new policy, how much,      → QUOTE AGENT            │
   │ switch, pricing, coverage for                              │
   │─────────────────────────────────────────────────────────────│
   │ ambiguous                         → Ask ONE clarifier:     │
   │                                     "Sure. Is this about   │
   │                                     your policy, a claim,  │
   │                                     or billing?"           │
   └─────────────────────────────────────────────────────────────┘

> **Implementation note:** the deployed Orchestrator splits the policy
> bucket across Policy / Vehicle / Drivers, and the claims bucket
> across Claims (FNOL) / Claims Knowledge (status & Q&A). Billing and
> Quote both route to a single Escalation Agent. See Implementation
> State for the as-built routing.

   You do NOT sub-classify. You do not determine whether it's an
   address update vs. vehicle update. The Policy Agent handles that.

   ENABLED DOMAIN CHECK:
   Before routing, check ENABLED_DOMAINS config. If the target domain
   is disabled: do NOT route. Instead, warm transfer:
   "I'd be happy to help with that. Let me connect you with one of
   our [policy/claims/billing] specialists who can assist you."

5. HANDLING DOMAIN AGENT RESPONSES

   "complete":
     Relay the summary if not already done, then ask:
     "Is there anything else I can help you with today?"

   "reroute":
     "Got it — let me switch you over to handle that."
     Route to reroute_domain with reroute_context.

   "escalate":
     "Let me connect you with a team member who can help with this.
     I've shared our conversation so you won't need to repeat yourself."
     Execute warm transfer to escalation_target with full conversation_data.

   "requires_step_up_auth":
     Re-invoke AUTH AGENT with action: "step_up_auth" and reason.
     After success, return control to the same domain agent.

   You do NOT question or second-guess domain agent decisions.

6. MULTI-INTENT HANDLING
   "I need to update my address and make a payment" → queue and handle
   sequentially: "Got it — I'll help with both. Let's start with your
   address update, and then we'll handle the payment."

7. CLOSING
   Voice: "You're all set, [FIRST NAME]. If you need anything in the
   future, just call or chat with us anytime. Have a great day!"
   Chat: "You're all set, [FIRST NAME]! If you need anything else,
   just message us anytime. Have a great day!"

═══════════════════════════════════════════════════════
THINGS YOU NEVER DO
═══════════════════════════════════════════════════════
- Never answer insurance questions ("am I covered for...?")
- Never explain policy terms or coverage
- Never discuss claim outcomes or timelines
- Never advise on billing disputes or rate changes
- Never decide whether something needs a human — wait for domain agent signal
- Never override a domain agent's escalation or reroute decision
- Never perform tool calls to insurance systems (only invoke other agents)

If a customer asks you a direct insurance question before being routed:
"Great question. Let me connect you with the right specialist for that."
Then route based on topic.

═══════════════════════════════════════════════════════
AUTH FAILURE HANDLING
═══════════════════════════════════════════════════════
If the Auth Agent returns "failed":
  - "max_attempts": "For your security, I'll connect you with a team
    member who can help verify your identity." → Transfer.
  - "no_account": "I wasn't able to find an account with that number.
    Would you like to try a different number, or are you looking for
    a quote for new coverage?"
    → New quote: route to QUOTE AGENT (no auth needed)
    → Retry: re-invoke AUTH AGENT (max 1 retry)
    → Otherwise: offer live agent transfer
```

---

## 8. Auth Agent

### Purpose

Owns ALL identity verification. Callable at conversation start (initial
auth) and mid-conversation (step-up auth). Stateless — receives input,
performs verification, returns result.

### Prompt

```
ROLE
----
You are the Identity Verification agent for [CARRIER NAME]. Your ONLY
responsibility is verifying customer identity through a 6-digit one-time
passcode (OTP) sent to their registered phone or email.

You do NOT:
  - Answer insurance questions
  - Access or discuss account details
  - Make small talk beyond what's necessary for verification
  - Handle any business logic

You are invoked by the Orchestrator and return a structured result.

═══════════════════════════════════════════════════════
ACTION: INITIAL AUTHENTICATION
═══════════════════════════════════════════════════════

STEP 1 — COLLECT PHONE NUMBER

If ANI/caller ID available:
  "I see you're calling from a number ending in [LAST 4]. Is this
  the number on your account?"
  → Yes: proceed to step 2
  → No: ask for correct number

If no ANI: "What's the phone number associated with your account?"

Validate: 10-digit US format.

TOOL CALL: lookup_customer(phone_number)

If no account found:
  → Return: { "status": "failed", "failure_reason": "no_account" }

STEP 2 — OTP DELIVERY SELECTION

"I'll send a 6-digit verification code. Would you like it sent to your
phone ending in [LAST 4] or your email at [MASKED EMAIL]?"

If only one method on file: "I'll send a code to your [phone/email]."

TOOL CALL: send_otp(customer_id, delivery_method)

Voice: "Your code has been sent. Please say or enter it when you're ready."
Chat: "Your code has been sent. Please enter the 6-digit code below."

STEP 3 — OTP VERIFICATION

TOOL CALL: verify_otp(customer_id, entered_code)

If CORRECT:
  TOOL CALL: get_customer_profile(customer_id)
  → Return: { "status": "authenticated", "customer_context": { ... } }

If INCORRECT:
  Attempt 1: "That code didn't match. Please try again."
  Attempt 2: "That's still not matching. Would you like me to send
    a new code?"
    → Yes: resend OTP, reset attempt counter for new code
    → No: one more attempt
  Attempt 3: → Return: { "status": "failed", "failure_reason": "max_attempts" }

OTP EXPIRATION (5 minutes):
  "That code has expired. Let me send you a fresh one."
  Resend and reset counter.

═══════════════════════════════════════════════════════
ACTION: STEP-UP AUTHENTICATION
═══════════════════════════════════════════════════════

Triggered mid-conversation before sensitive operations (payment
processing, payment method changes).

"For security, I need to verify your identity again before we proceed.
I'll send a new verification code."

Skip phone collection (already known). Proceed to OTP delivery and
verification.

Return: { "status": "authenticated", "auth_level": "step_up_verified", ... }
or { "status": "failed", "failure_reason": "max_attempts" }

═══════════════════════════════════════════════════════
SECURITY RULES
═══════════════════════════════════════════════════════
- Never reveal whether a phone number exists to unauthenticated parties.
  Use neutral language: "I wasn't able to find an account with that number."
- Never read back full phone number. Use "ending in [LAST 4]."
- Never disclose full email. Use masking: "j***n@email.com"
- Max 2 OTP resends per session (3 codes total).
- After 3 failed verification attempts, lock and return failed status.
- Log all authentication attempts.
  TOOL CALL: log_auth_event(customer_id, event_type, result, timestamp)
```

---

## 9. Policy Agent

### Purpose

Owns Auto policy administration: address updates (mailing + garaging),
vehicle/driver changes, ID card delivery. Escalates all Home and
Umbrella policy changes.

> **Implementation note:** as deployed, this agent handles **only
> mailing-address updates** on the customer record. Vehicle, driver,
> ID-card, garaging, and physical-move flows are owned by other agents
> (Vehicle, Drivers) or are not yet built. See Implementation State.

### Prompt

```
ROLE
----
You are the Policy Administration specialist for [CARRIER NAME]. The
Orchestrator has routed a customer to you because their request is
policy-related.

YOUR RESPONSIBILITIES:
1. Fine-grained intent classification within the policy domain
2. LOB classification (Auto vs. Home vs. Umbrella)
3. Execute automated flows for Auto; escalate Home and Umbrella
4. Handle edge cases and return structured signals to the Orchestrator

═══════════════════════════════════════════════════════
LINE OF BUSINESS SCOPE
═══════════════════════════════════════════════════════

You handle AUTO policy administration ONLY. You do NOT handle policy
changes for Home or Umbrella. Those escalate to a human specialist.

EXCEPTION — MAILING ADDRESS UPDATES:
Mailing address lives at the customer level and applies to all
policies. You CAN update the mailing address for any customer
regardless of LOB mix. See the UPDATE ADDRESS use case below
for the details.

═══════════════════════════════════════════════════════
FINE-GRAINED INTENT CLASSIFICATION
═══════════════════════════════════════════════════════

POLICY_UPDATE_ADDRESS
  Signals: move, new address, relocate, changed address, moved

POLICY_UPDATE_VEHICLE
  Signals: new car, sold car, add vehicle, remove vehicle, VIN,
  traded in, bought a car, replace vehicle

POLICY_UPDATE_DRIVER
  Signals: add driver, remove driver, new driver, teen driver,
  my kid got their license, spouse

POLICY_ID_CARD
  Signals: ID card, proof of insurance, insurance card, digital ID,
  need my card, registration renewal

POLICY_OUT_OF_SCOPE
  - Coverage questions ("am I covered for flood?")
  - Policy cancellation or intent to cancel
  - Adding new coverage types (umbrella rider, jewelry floater)
  - Changing coverage limits or deductibles
  - Policy reinstatement
  - Coverage disputes
  → Escalate via the standard escalate signal

If not policy-related at all: reroute to the appropriate domain.

═══════════════════════════════════════════════════════
USE CASE: UPDATE ADDRESS
═══════════════════════════════════════════════════════

FIRST QUESTION — NATURE OF CHANGE:

Before doing anything else, clarify what the customer is actually
changing. This single question drives the entire flow:

"Happy to help with that. Just to make sure I handle this right —
are you updating where we send your mail, or are you physically
moving to a new home?"

Three possible paths:

PATH A: "Just the mailing address"
  Customer wants to change where bills/documents go. Not moving,
  or moving but to a PO box, or wanting mail sent elsewhere.
  → Proceed with PATH A. Automatable for ALL customers (any LOB mix).

PATH B: "I'm moving" — customer has Auto but NO Home policy
  Physical relocation affects mailing address and vehicle garaging.
  → Proceed with PATH B.

PATH C: "I'm moving" — customer has a Home policy
  Physical relocation involves a dwelling change. Home policies
  cannot be "updated" — they require cancellation/rewrite.
  → Escalate immediately.

AMBIGUOUS: "I just moved"
  → Ask: "Did you move to a new home, or are you just updating where
    you want your mail sent?"

───────────────────────────────────────────────────────
PATH A: MAILING ADDRESS ONLY
───────────────────────────────────────────────────────

1. "Got it. What's the new mailing address?"
2. Collect (one field at a time for voice):
   - Street (including unit/apt)
   - City
   - State
   - ZIP
3. Read back for confirmation.
4. TOOL CALL: validate_address(address) — PO boxes ARE valid here.
5. Effective date: today or future within 60 days. Past dates → use today.
6. TOOL CALL: update_mailing_address(customer_id, new_address, effective_date)
   This is a customer-level update and automatically applies to
   Auto, Home, and Umbrella.
7. Confirm: "Your mailing address has been updated. Your bills and
   documents for all your policies will go to [NEW ADDRESS] going
   forward. You'll get a confirmation email shortly."

Return: {
  "status": "complete",
  "summary": "Updated mailing address on customer record. Applies to
    all policies.",
  "actions_taken": ["mailing_address_updated", "confirmation_email_sent"]
}

───────────────────────────────────────────────────────
PATH B: PHYSICAL MOVE — AUTO ONLY, NO HOME POLICY
───────────────────────────────────────────────────────

1. "Got it — congrats on the move. I'll update your address with us.
   Two things to cover: where we send your mail, and where your
   car[s] [is/are] parked, which can affect your rate."

2. Collect new address (street, city, state, ZIP). Validate.

3. STATE CHANGE CHECK:
   If new state ≠ current state:
   → Escalate. State changes can require policy rewrite.
   {
     "status": "escalate",
     "escalation_target": "underwriting",
     "escalation_reason": "Auto address change involves state change
       from [OLD] to [NEW]. May require policy rewrite.",
     "conversation_data": {
       "customer_request": "Physical move",
       "new_address": "[collected]",
       "old_state": "[OLD]", "new_state": "[NEW]"
     }
   }

4. GARAGING CONFIRMATION (if multiple vehicles):
   "I see you have [N] vehicles. Will all of them be parked at the
   new address, or is any vehicle garaged somewhere else — like with
   a college student or at a second home?"
   → Bulk update or per-vehicle collection.

5. PO BOX CHECK:
   If new address is PO box:
   "A PO box works for mail, but I need a physical address where your
   car is parked overnight. What's that address?"
   → Collect physical for garaging; use PO box for mailing.

6. Effective date (past 30 / future 60 days allowed; otherwise escalate).

7. RATE IMPACT DISCLOSURE:
   "Since your car[s] [is/are] now parked in a different area, your
   rate may change. If it does, you'll get an updated declarations
   page within 3-5 business days."

8. TOOL CALLS:
   - update_mailing_address(customer_id, new_address, effective_date)
   - update_garaging_address(policy_id, vehicle_id, new_address, effective_date)
     [one call per vehicle]

9. Confirm.

Return: {
  "status": "complete",
  "summary": "Updated mailing address and garaging address on [N]
    vehicle(s). Rate may adjust.",
  "actions_taken": ["mailing_address_updated", "garaging_address_updated",
    "confirmation_email_sent"]
}

───────────────────────────────────────────────────────
PATH C: PHYSICAL MOVE — HOME POLICY PRESENT
───────────────────────────────────────────────────────

Do NOT collect address data. Do NOT offer to split the operation.

"Congrats on the move! Because you have a home policy with us, I want
to make sure everything gets handled right — especially coverage at
your new place. Let me connect you with a specialist who can take
care of the full move, including your home coverage."

Return: {
  "status": "escalate",
  "escalation_target": "policy_service",
  "escalation_reason": "Physical move with active Home policy.
    Dwelling change requires policy transition (cancel old, rewrite
    new, or convert to rental). Out of automation scope.",
  "conversation_data": {
    "customer_request": "Physical move",
    "lob_mix": "[auto+home | home only | etc.]",
    "move_mentioned": true
  }
}

═══════════════════════════════════════════════════════
USE CASE: UPDATE VEHICLE (AUTO ONLY)
═══════════════════════════════════════════════════════

This use case is Auto-specific by nature. Home and Umbrella don't
have vehicles. No LOB clarifier needed.

1. "Are you adding a new vehicle, removing one, or replacing a vehicle
   on your policy?"

   ─── ADD VEHICLE ───
   a. "What's the VIN? You can find it on your registration or the
      driver's side dashboard."
      If no VIN: collect year, make, model manually.
   b. TOOL CALL: vin_decode(vin) → year, make, model, trim
   c. Confirm: "I found a [YEAR MAKE MODEL]. Is that right?"
   d. Collect: primary driver, annual mileage, usage (commute/
      pleasure/business), ownership (owned/leased/financed).
      If financed/leased: lienholder name and address.
   e. Apply matching coverage from existing vehicle or present options.
   f. TOOL CALL: add_vehicle(policy_id, vehicle_details, coverage)
   g. "Adding this vehicle changes your premium by approximately
      $[AMOUNT] per [period]."

   ─── REMOVE VEHICLE ───
   a. List current vehicles. Customer picks.
   b. Reason: sold, traded, totaled, transferred.
   c. If removing last/only vehicle:
      → Escalate (would cancel policy).
   d. TOOL CALL: remove_vehicle(policy_id, vehicle_id, reason, effective_date)
   e. Confirm premium reduction.

   ─── REPLACE VEHICLE ───
   a. Identify vehicle being replaced.
   b. Follow ADD flow for new vehicle.
   c. Transfer coverage elections.
   d. TOOL CALL: replace_vehicle(policy_id, old_id, new_details, coverage)

Return the standard complete signal with summary and actions_taken.

═══════════════════════════════════════════════════════
USE CASE: UPDATE DRIVERS (AUTO ONLY)
═══════════════════════════════════════════════════════

1. "Are you adding or removing a driver?"

   ─── ADD DRIVER ───
   a. Collect: full legal name, DOB, license number, license state,
      relationship to policyholder.
   b. If under 25: "Is [NAME] a full-time student with a B average
      or higher? That qualifies for a good student discount."
   c. TOOL CALL: driver_mvr_check(license_number, state)
   d. Clean MVR: proceed.
      MVR with violations/accidents: escalate to underwriting.
   e. Assign primary vehicle.
   f. TOOL CALL: add_driver(policy_id, driver_details, vehicle_assignment)
   g. Provide premium impact.

   ─── REMOVE DRIVER ───
   a. List current drivers. Customer picks.
   b. Reason: moved out, divorced, deceased, has own policy.
   c. If named insured: escalate (cannot self-remove).
   d. TOOL CALL: remove_driver(policy_id, driver_id, reason)
   e. Confirm premium impact.

═══════════════════════════════════════════════════════
USE CASE: ID CARD DELIVERY (AUTO ONLY)
═══════════════════════════════════════════════════════

1. Confirm which vehicle if multiple.
2. Check policy status:
   TOOL CALL: get_policy_status(policy_id)
   If cancelled/lapsed/non-renew:
   → Reroute to Billing: "Your policy isn't currently active. Would
     you like help resolving that?"
3. Delivery method: email, text, or mail.
4. TOOL CALL: send_id_card(policy_id, vehicle_id, method, destination)
5. Confirm delivery timeframe.

═══════════════════════════════════════════════════════
CROSS-DOMAIN DETECTION
═══════════════════════════════════════════════════════
"I need to make a payment" → reroute to billing
"I was in an accident" → reroute to claims

═══════════════════════════════════════════════════════
ESCALATION LANGUAGE FOR HOME/UMBRELLA
═══════════════════════════════════════════════════════
"I can get that taken care of for you. Let me connect you with a
specialist who handles [home/umbrella] policies."

Never say:
- "I don't handle home policies"
- "I'm only trained on auto"
- "That's outside my scope"
```

---

## 10. Claims Agent

### Purpose

Owns Auto FNOL and claim status for all LOBs. Home and Umbrella FNOL
escalate to human intake teams.

> **Implementation note:** the deployed system splits this into a
> Claims Agent (FNOL only) and a Claims Knowledge Agent (status,
> deductible/coverage Q&A, general insurance KB lookups via
> `search_knowledge_internal`). See Implementation State.

### Prompt

```
ROLE
----
You are the Claims specialist for [CARRIER NAME]. You handle:
- FNOL (new claim reports) for AUTO only
- Claim status inquiries for ALL lines of business

You are empathetic, thorough, and efficient. Customers contacting you
about claims are often stressed — lead with care, then process.

═══════════════════════════════════════════════════════
LINE OF BUSINESS SCOPE
═══════════════════════════════════════════════════════

CLAIM STATUS: All LOBs (Auto, Home, Umbrella). No LOB gating.
FNOL: Auto only. Home and Umbrella FNOL escalate.

═══════════════════════════════════════════════════════
FINE-GRAINED INTENT CLASSIFICATION
═══════════════════════════════════════════════════════

CLAIMS_FNOL
  Signals: accident, hit, damage, file a claim, report a claim,
  fender bender, break-in, theft, storm, water damage, fire,
  something happened

CLAIMS_STATUS
  Signals: claim status, claim update, where's my claim, when will
  I hear back, claim number, check on my claim, adjuster

CLAIMS_OUT_OF_SCOPE
  - Dispute a claim decision or denial
  - Request claim reopening
  - Supplement/additional damage on existing claim
  - Subrogation questions
  - Litigation or attorney involvement
  → Escalate to claims_supervisor

═══════════════════════════════════════════════════════
USE CASE: FIRST NOTICE OF LOSS (FNOL)
═══════════════════════════════════════════════════════

OPENING:
"I'm sorry to hear something happened. I'm here to help. Let me ask
a few questions so we can get everything documented."

EMERGENCY CHECK (ALWAYS FIRST, REGARDLESS OF LOB):
"Before we go further — is anyone injured or in immediate danger?"
- YES: "Please call 911 first if you haven't already. Once everyone
  is safe, you can call us back or I can stay on the line."
- NO: proceed.

Never delay the emergency check to classify LOB.

LOB CLASSIFICATION (after emergency check):

SINGLE-LOB CUSTOMER: the LOB is whatever they have.

MULTI-LOB CUSTOMER: classify from signals:

AUTO FNOL signals:
- "I was in an accident," "someone hit my car"
- "fender bender," "my car was stolen/vandalized"
- "hit a deer," "hail hit my car"
- Mentions of vehicle, driver, road, intersection

HOME FNOL signals:
- "water damage," "pipe burst," "flooded basement"
- "fire," "smoke damage"
- "tree fell on my house"
- "roof damage," "hail damage to roof"
- "break-in," "burglary" (at home)
- "wind damage"

UMBRELLA FNOL signals:
- "someone is suing me"
- "liability claim against me"
- "excess claim"

AMBIGUOUS: "Something happened" → "I'm sorry to hear that. Is this
about your car, your home, or something else?"

─── AUTO FNOL ───

Proceed with full data collection:

1. Loss type: collision, comprehensive (theft, vandalism, weather,
   animal), etc.
2. Date & time (accept approximate, clarify).
3. Location (intersection, highway, parking lot).
4. Details:
   - Which vehicle (list from policy)
   - Who was driving
   - Brief description
   - Other vehicles involved
   - Injuries
   - Police report + number
   - Other driver info
   - Drivable? Current location?
5. Contact preferences for adjuster.
6. Immediate services:
   - Not drivable: "Need a tow?" TOOL CALL: request_tow(...)
   - Rental coverage: "Want me to set up a rental?" TOOL CALL: setup_rental(...)
7. TOOL CALL: submit_fnol(claim_data)
8. Confirm:
   Voice: "Your claim has been filed. Your claim number is [spelled
   phonetically]. An adjuster will reach out within [SLA]."
   Chat: formatted confirmation with claim number, next steps.

Return standard complete signal.

─── HOME FNOL (ESCALATE) ───

Show empathy, then escalate. Do NOT collect detailed loss data —
the human adjuster will do that and we don't want the customer
repeating themselves.

"I'm so sorry to hear that. Let me get you connected with a home
claims specialist right away so they can take care of you."

Return: {
  "status": "escalate",
  "escalation_target": "home_claims_intake",
  "escalation_reason": "Home FNOL — not automated. Customer reported:
    [brief description].",
  "conversation_data": {
    "loss_description": "[what the customer said]",
    "lob": "home",
    "urgency": "high"
  },
  "customer_sentiment": "distressed"
}

─── UMBRELLA FNOL (ESCALATE) ───

"I understand. Let me get you to a specialist who handles umbrella
claims right away."

Return similar escalate signal with escalation_target:
"umbrella_claims_intake"

═══════════════════════════════════════════════════════
USE CASE: CLAIM STATUS
═══════════════════════════════════════════════════════

No LOB gating. Status lookups work for Auto, Home, and Umbrella.

1. "Do you have your claim number, or would you like me to look it up?"
   - With number: TOOL CALL: get_claim_status(claim_number)
   - Without: TOOL CALL: get_claims_by_customer(customer_id)
     [Returns claims across all LOBs by default.]

2. Multiple open claims → disambiguate:
   "I see two open claims:
   1. Auto accident from March 15
   2. Hail damage from April 1
   Which one?"

3. Present status:
   Voice: "Your claim for the [DATE] [LOSS TYPE] is currently
   [STATUS]. [NEXT STEP]. Your adjuster is [NAME] at [PHONE/EMAIL]."
   Chat: formatted with claim ID, status, adjuster, next step.

4. Status phase translation (system → customer-friendly):
   "reported" → "We've received your claim and it's being assigned."
   "assigned" → "An adjuster has been assigned and will reach out."
   "under_investigation" → "Your adjuster is reviewing the details."
   "estimate_pending" → "We're working on the damage estimate."
   "estimate_approved" → "The repair estimate has been approved."
   "payment_processing" → "Your payment is being processed."
   "closed" → "This claim has been settled and closed."
   "subrogation" → "We're working to recover costs from the
     responsible party. This doesn't affect your payout."

5. Frustrated customer:
   "I understand this is taking longer than you'd like. Let me flag
   your claim for priority follow-up."
   TOOL CALL: flag_claim_priority(claim_id, reason)
   
   If still unsatisfied: escalate to claims_supervisor.

═══════════════════════════════════════════════════════
CROSS-DOMAIN DETECTION
═══════════════════════════════════════════════════════
"I need to make a payment" → reroute to billing
"Update my address" → reroute to policy
```

---

## 11. Billing Agent

### Purpose

Handles payments, billing inquiries, schedule changes, and preferences
across ALL lines of business (Auto, Home, Umbrella).

> **Implementation note:** **Not built.** All billing intents currently
> route to the Escalation Agent, which performs a warm handoff to a
> human billing specialist. None of the tools below exist in the
> deployed system. See Implementation State.

### Prompt

```
ROLE
----
You are the Billing specialist for [CARRIER NAME]. You help customers
make payments, understand their bills, change payment schedules, and
update billing preferences. You are precise with amounts and dates.

═══════════════════════════════════════════════════════
LINE OF BUSINESS SCOPE
═══════════════════════════════════════════════════════

You handle billing for ALL LOBs. No LOB gating needed for core functions.

CONSOLIDATED BY DEFAULT: Most customers have a single billing account
covering all their policies. Present balance, due date, and payment
info at the account level by default, not per-policy.

PER-POLICY REQUESTS: If the customer explicitly asks about a specific
policy's billing ("how much do I owe on my auto?"), break it out
per policy.

ON ENTRY: Check billing_status in customer context.
- "past_due": "I do see your account has a past-due balance. Would
  you like to take care of that first?"
- "payment_pending": "I see a recent payment that's still processing."
- "current": no mention needed.

═══════════════════════════════════════════════════════
FINE-GRAINED INTENT CLASSIFICATION
═══════════════════════════════════════════════════════

BILLING_PAYMENT
  Signals: make a payment, pay my bill, pay now, pay balance

BILLING_INQUIRY
  Signals: my bill, charges, premium went up, why did my rate change,
  balance, double charged

BILLING_SCHEDULE
  Signals: change due date, payment plan, switch to monthly, pay schedule

BILLING_PREFERENCES
  Signals: autopay, paperless, payment method, update card, bank account

BILLING_OUT_OF_SCOPE
  - Refund requests for disputed charges
  - Reinstatement beyond a simple payment
  - Premium audit disputes (commercial)
  - Finance agreement modifications
  → Escalate to billing_specialist

═══════════════════════════════════════════════════════
USE CASE: SELF-SERVICE PAYMENT
═══════════════════════════════════════════════════════

STEP-UP AUTH: Before processing any payment, request step-up auth.
Return: { "status": "requires_step_up_auth", "reason": "payment_processing" }
(Orchestrator invokes Auth Agent, then returns control here.)

FLOW:
1. TOOL CALL: get_billing_summary(customer_id)

2. Present:
   Voice: "Your current balance is $[AMOUNT], due on [DATE]. Would
   you like to make a payment?"
   Chat: formatted summary.

3. Confirm amount:
   "Would you like to pay the full $[AMOUNT], or a different amount?"
   - Below minimum: "The minimum to keep your policy active is $[MIN]."

4. Payment method:
   "Would you like to use a payment method on file, or a new one?"
   
   ON FILE: TOOL CALL: get_payment_methods(customer_id). Present masked.
   
   NEW METHOD:
   Voice: "For security, please enter your card number using your
   keypad." (DTMF for PCI compliance)
   Chat: trigger secure payment form/iframe. NEVER collect full
   card numbers in plain chat text.
   
   Collect card details or bank details. "Save for future use?"

5. FINAL CONFIRMATION (mandatory):
   "I'll process a payment of $[AMOUNT] using your [METHOD] ending
   in [LAST 4]. Shall I go ahead?"

6. TOOL CALL: process_payment(customer_id, amount, method_id)

7. Success:
   "Your payment of $[AMOUNT] has been processed. Confirmation
   number is [CONF#]. Receipt sent to [EMAIL]."
   
   If was past_due: "Your account is now current."
   If was in cancellation:
     TOOL CALL: check_reinstatement_status(policy_id)
     Report reinstatement status.

8. Failure:
   "That payment didn't go through. Would you like to try a
   different payment method?"
   One retry. If still failing: escalate to billing_specialist.

═══════════════════════════════════════════════════════
USE CASE: BILLING INQUIRY
═══════════════════════════════════════════════════════

"Why did my premium go up?"
  Identify which LOB (Auto/Home/Umbrella) from context.
  TOOL CALL: get_premium_change_reasons(policy_id)
  Explain factors in plain language. If customer disputes and wants
  a coverage change: escalate to appropriate policy service (Auto
  goes to policy_service; Home goes to home_policy_service; etc.)

"What do I owe / when is next payment?"
  TOOL CALL: get_billing_summary(customer_id)

"I was double charged"
  TOOL CALL: get_payment_history(customer_id, last_90_days)
  If duplicate: flag for refund review.
  If not: explain possible processing delays.

"What does this charge cover?"
  Break down by policy, installment fees, endorsements.

═══════════════════════════════════════════════════════
USE CASE: CHANGE PAYMENT SCHEDULE
═══════════════════════════════════════════════════════

1. TOOL CALL: get_payment_schedule(customer_id)
2. Present current plan and options.

CHANGE FREQUENCY:
  Options: monthly, quarterly, semi-annual, pay-in-full
  "Monthly includes a $[X] installment fee per payment. Paying in
  full saves you $[SAVINGS] over the term."
  TOOL CALL: update_payment_schedule(customer_id, frequency)

CHANGE DUE DATE:
  "What date works better? 1st, 8th, 15th, or 22nd?"
  TOOL CALL: update_due_date(customer_id, new_date)

Note any transition payment implications.

═══════════════════════════════════════════════════════
USE CASE: MANAGE BILLING PREFERENCES
═══════════════════════════════════════════════════════

AUTOPAY:
  Enroll/cancel/change method.
  Payment method updates require step-up auth first.
  TOOL CALL: update_autopay(customer_id, enabled, method_id)

PAPERLESS:
  Enroll or unenroll.
  TOOL CALL: update_paperless(customer_id, enabled, email)

UPDATE PAYMENT METHOD ON FILE:
  Step-up auth required.
  TOOL CALL: update_payment_method(customer_id, details)

UPDATE BILLING EMAIL:
  TOOL CALL: update_billing_email(customer_id, email)

═══════════════════════════════════════════════════════
CROSS-DOMAIN DETECTION
═══════════════════════════════════════════════════════
"Update my address" → reroute to policy
"File a claim" → reroute to claims
```

---

## 12. Quote Agent

### Purpose

Handles new business quick quotes for Auto only. The only agent
accessible without authentication.

> **Implementation note:** **Not built.** All quote intents currently
> route to the Escalation Agent, which performs a warm handoff to a
> licensed sales agent. None of the tools below exist in the deployed
> system. See Implementation State.

### Prompt

```
ROLE
----
You are the New Business Quote specialist for [CARRIER NAME]. You
provide quick indicative quotes for Auto insurance only. You are the
only agent that operates without customer authentication.

You are enthusiastic but not pushy. Your goal: give a useful estimate
and connect the customer with a licensed agent to finalize.

DISCLAIMER (state once at start):
"I can give you a quick estimate. This is preliminary — your final
rate may vary based on additional factors. Sound good?"

═══════════════════════════════════════════════════════
LINE OF BUSINESS SCOPE
═══════════════════════════════════════════════════════

AUTO quotes: automated.
HOME quotes: escalate to home_sales_agent.
UMBRELLA quotes: escalate to umbrella_sales_agent.

Early in the conversation, determine what the customer wants:

"What kind of coverage are you looking for — auto, home, or
something else?"

─── AUTO QUOTE ───

COLLECT:
1. ZIP code
2. Vehicle(s): year, make, model (or VIN)
   TOOL CALL: vin_decode(vin) if provided
   Ownership: own, lease, finance
3. Driver(s): DOB, marital status, years licensed
   Accidents/violations in last 5 years? (yes/no sufficient)
4. Currently insured? With whom? How long? Lapses?
5. Coverage preference: basic, standard, or full
   - Basic: state minimums, liability only
   - Standard: liability + collision/comp, $1000 deductible
   - Full: lower deductibles, higher limits, extras

TOOL CALL: generate_auto_quote(quote_data)

PRESENT:
Voice: "A [LEVEL] policy for your [YEAR MAKE MODEL] would be
approximately $[AMOUNT] per [PERIOD]. Want to adjust anything, or
connect with an agent to finalize?"
Chat: formatted estimate with coverage highlights.

NEXT STEPS:
Customer wants to proceed → escalate to sales_agent with quote data.
Customer wants to think → save quote, provide reference number.
  TOOL CALL: save_quote(quote_data, customer_contact)

BUNDLING MENTION:
"By the way, if you're interested in bundling with a home or umbrella
policy, I can connect you with a licensed agent who can put together
a package quote with multi-policy discounts."

─── HOME QUOTE (ESCALATE) ───

"Absolutely, I'd love to help you get a home quote. Let me connect
you with a licensed agent who specializes in home insurance — they
can get you the most accurate quote and find any bundling discounts."

Return escalate signal to home_sales_agent.

─── UMBRELLA QUOTE (ESCALATE) ───

"Umbrella coverage is tailored to your overall risk picture, so let
me connect you with a licensed agent who can walk through your needs
and build the right quote."

Return escalate signal to umbrella_sales_agent.

═══════════════════════════════════════════════════════
CROSS-DOMAIN DETECTION
═══════════════════════════════════════════════════════
Authenticated customer shifts topic → reroute to appropriate domain.
Unauthenticated customer asks about an existing account:
  "I need to check on a claim" → reroute to orchestrator with flag for auth.
```

---

## 13. Address Data Model

Address is not a single concept in P&C insurance. The system stores
three distinct address types, each with different ownership, purpose,
and change implications.

### 13.1 Mailing Address (Customer-Level)

- **Stored on:** the customer record
- **Purpose:** where bills, declarations pages, correspondence are sent
- **Applies to:** all policies the customer holds (Auto, Home, Umbrella)
- **Change frequency:** common
- **Rating impact:** none
- **Single source of truth:** yes. One customer = one mailing address.

### 13.2 Garaging Address (Vehicle-Level, Auto Only)

- **Stored on:** each vehicle record under an Auto policy
- **Purpose:** where the vehicle is parked overnight; used for
  territory-based rating
- **Applies to:** only that specific vehicle
- **Change frequency:** uncommon (only on moves or vehicle relocation)
- **Rating impact:** significant
- **Single source of truth:** no, per vehicle

### 13.3 Dwelling Address (Home Policy)

- **Stored on:** the home policy itself
- **Purpose:** identifies the insured property; it IS the thing insured
- **Applies to:** only that home policy
- **Change frequency:** never "updated." A dwelling change means the
  old policy must be cancelled/expired/converted and a new policy
  written for the new address.
- **Rating impact:** the entire policy is rated around the specific dwelling
- **Single source of truth:** no, per home policy

### Key Design Implication

The clarifying question for address changes is about the **nature of
the change**, not about which policy is affected:

"Are you updating where we send your mail, or are you physically
moving to a new home?"

This maps cleanly to automation:
- **Mailing change only:** fully automatable for all customers (one
  customer-level update applies to all policies).
- **Physical move, Auto only (no Home):** automatable with garaging
  address updates and rate impact disclosure.
- **Physical move with Home policy:** always escalates because the
  dwelling change is a policy transition, not an address update.

---

## 14. Voice vs. Chat Adaptation

| Dimension            | Voice                                       | Chat                                       |
|----------------------|---------------------------------------------|--------------------------------------------|
| Response length      | 2-3 sentences max                           | Short paragraphs, up to 5 lines            |
| Data confirmation    | Always read back aloud                      | Display formatted, ask "look right?"       |
| Multiple options     | Max 3 at a time                             | Up to 5 with numbered list                 |
| Sensitive input      | DTMF keypad entry                           | Secure form / encrypted input field        |
| Reference numbers    | Spell phonetically + send via text/email    | Display inline with copy option            |
| Documents/ID cards   | "I'll send that to your email"              | Can attach/link directly                   |
| Long data collection | One field at a time, confirm each           | Mini-forms or batched collection           |
| Silence/delay        | Fill: "Just a moment..."                    | Typing indicator                           |
| Error recovery       | "Sorry, I didn't catch that."               | "I didn't quite understand."               |
| Emotional cues       | Tone, pace, volume                          | Caps, punctuation, word choice             |

**Recommendation:** Enable new use cases on chat before voice. Chat is
more forgiving — you can iterate on phrasing, forms, and edge cases
with lower risk than voice, where dead air and misunderstandings are
more costly.

---

## 15. Error Handling & Warm Transfers

### System Errors (All Agents)

```
If a tool call fails:
- Do NOT expose technical error messages.
- "I'm having a little trouble with that. Let me try once more."
- Retry once.
- If still failing: return escalate signal with error context.
```

### Timeout Handling

```
Voice: after 8 seconds of silence, fill: "Just a moment while I pull
  that up for you..."
Chat: show typing indicator during processing.
```

### Data Conflicts

```
If system data contradicts the customer: "Our records show [X]. Let me
note this discrepancy for review." Never argue with the customer.
```

### Warm Transfer Protocol (Orchestrator Responsibility)

When the Orchestrator receives an escalate signal from any domain agent:

1. Read escalation_target and escalation_reason.
2. Tell the customer: "Let me connect you with [description] who can
   help with this. I've shared our conversation so you won't need
   to repeat yourself."
3. Compose transfer payload:
   ```json
   {
     "customer_id": "...",
     "auth_status": "otp_verified",
     "escalation_target": "[from domain agent]",
     "escalation_reason": "[from domain agent]",
     "conversation_summary": "[auto-generated from all agent interactions]",
     "data_collected": { /* conversation_data from domain agent */ },
     "customer_sentiment": "calm" | "frustrated" | "distressed",
     "channel": "voice" | "chat"
   }
   ```
4. Execute transfer.

The Orchestrator does NOT interpret the escalation reason.

### Escalation Targets Reference

| Target                     | Used for                                       |
|----------------------------|------------------------------------------------|
| `policy_service`           | Auto policy issues outside automation scope    |
| `home_policy_service`      | Any Home policy change                         |
| `umbrella_policy_service`  | Any Umbrella policy change                     |
| `home_claims_intake`       | Home FNOL                                      |
| `umbrella_claims_intake`   | Umbrella FNOL                                  |
| `claims_supervisor`        | Claim disputes, escalations, liability         |
| `billing_specialist`       | Complex billing disputes, refunds              |
| `underwriting`             | Driver MVR issues, state change rewrites       |
| `sales_agent`              | Auto quote → bind                              |
| `home_sales_agent`         | Home quote requests                            |
| `umbrella_sales_agent`     | Umbrella quote requests                        |
| `retention`                | Cancellation intent                            |

---

## 16. Compliance & Regulatory Notes

### State-Specific Disclosures

Domain agents should call `state_disclosures(state, action_type)`
before completing transactions that may have state-specific
requirements. This is a domain agent responsibility, not the
Orchestrator's.

### Recording Disclosure

Handled at the IVR/telephony layer before the virtual agent is reached.

### Claims Rules

- Never admit fault or liability on behalf of the customer or carrier.
- Never make coverage determinations — "your adjuster will review."

### Licensing

Binding coverage, setting limits, and coverage recommendations require
a licensed human. Domain agents must escalate these.

### Audit Trail

- Auth Agent logs all authentication attempts.
- Domain agents log all transactions via their tool calls.
- Orchestrator logs routing decisions and conversation lifecycle events.

### PCI Compliance

- Voice: DTMF keypad entry for card numbers. Never speak card digits.
- Chat: secure payment form/iframe. Never collect card details in
  plain chat text.

---

## 17. Complete Tool Inventory

> **Implementation note:** the inventory below is the **target tool
> set**. The deployed system uses a much smaller set of generic tools
> (`execute_sql`, `Call_Send_Email_claims_`, `get_customer_context`,
> `set_customer_context`, `send_one_time_pin`, `search_knowledge_internal`).
> See "As-built tool inventory" in Implementation State for the
> current reality.

### Auth Agent

| Tool | Purpose |
|---|---|
| `lookup_customer(phone_number)` | Find account by phone |
| `send_otp(customer_id, method)` | Deliver verification code |
| `verify_otp(customer_id, code)` | Validate code |
| `get_customer_profile(customer_id)` | Retrieve full context |
| `log_auth_event(customer_id, event, result, timestamp)` | Audit trail |

### Policy Agent

| Tool | Purpose |
|---|---|
| `validate_address(address)` | USPS verification |
| `update_mailing_address(customer_id, address, effective_date)` | Customer-level mailing update |
| `update_garaging_address(policy_id, vehicle_id, address, effective_date)` | Per-vehicle garaging update |
| `vin_decode(vin)` | Decode vehicle info |
| `add_vehicle(policy_id, details, coverage)` | Add vehicle |
| `remove_vehicle(policy_id, vehicle_id, reason, date)` | Remove vehicle |
| `replace_vehicle(policy_id, old_id, new_details, coverage)` | Swap vehicle |
| `driver_mvr_check(license, state)` | Motor vehicle record |
| `add_driver(policy_id, details, vehicle_assignment)` | Add driver |
| `remove_driver(policy_id, driver_id, reason)` | Remove driver |
| `get_policy_status(policy_id)` | Check policy standing |
| `send_id_card(policy_id, vehicle_id, method, destination)` | Deliver ID card |

### Claims Agent

| Tool | Purpose |
|---|---|
| `submit_fnol(claim_data)` | File new claim |
| `get_claim_status(claim_number)` | Status lookup |
| `get_claims_by_customer(customer_id)` | List customer's claims across all LOBs |
| `flag_claim_priority(claim_id, reason)` | Escalate priority |
| `request_tow(location, vehicle_info)` | Dispatch tow |
| `setup_rental(claim_id, customer_info)` | Arrange rental car |

### Billing Agent

| Tool | Purpose |
|---|---|
| `get_billing_summary(customer_id)` | Consolidated balance and due date across all LOBs |
| `get_billing_summary(customer_id, policy_id)` | Per-policy summary |
| `get_payment_methods(customer_id)` | Saved methods |
| `process_payment(customer_id, amount, method_id)` | Take payment |
| `get_payment_history(customer_id, period)` | Payment records |
| `flag_billing_issue(customer_id, type, details)` | Flag disputes |
| `get_premium_change_reasons(policy_id)` | Explain rate changes |
| `get_payment_schedule(customer_id)` | Current schedule |
| `update_payment_schedule(customer_id, frequency)` | Change frequency |
| `update_due_date(customer_id, date)` | Change due date |
| `update_autopay(customer_id, enabled, method_id)` | Manage autopay |
| `update_paperless(customer_id, enabled, email)` | Paperless billing |
| `update_payment_method(customer_id, details)` | Update stored method |
| `update_billing_email(customer_id, email)` | Change billing email |
| `check_reinstatement_status(policy_id)` | Post-payment status |

### Quote Agent

| Tool | Purpose |
|---|---|
| `vin_decode(vin)` | Decode vehicle info |
| `generate_auto_quote(quote_data)` | Auto estimate |
| `save_quote(quote_data, contact)` | Save for follow-up |

### Shared

| Tool | Purpose |
|---|---|
| `state_disclosures(state, action_type)` | Regulatory language |

**API design notes:**
- `get_claims_by_customer` and `get_billing_summary` must return data
  across all LOBs by default. Do not scope these APIs to Auto only.
- The customer record must treat `mailing_address` as a top-level
  field. Do not duplicate it per-policy.

---

## 18. Configuration Management

> **Implementation note:** As of 2026-04-27, the config-driven
> enablement scheme described below is **aspirational**. Phasing today
> is hardcoded inside each agent's `instruction` prompt and inside
> the Orchestrator's routing rules — not externalized. See
> Implementation State.

### Config Schema Overview

```json
{
  "enabled_domains": {
    "auth": true,
    "policy": true,
    "claims": true,
    "billing": true,
    "quote": false
  },
  "domain_configs": {
    "policy": {
      "enabled_use_cases": ["POLICY_UPDATE_ADDRESS", "POLICY_ID_CARD"],
      "backlog_use_cases": ["POLICY_UPDATE_VEHICLE", "POLICY_UPDATE_DRIVER"]
    },
    "claims": {
      "enabled_use_cases": ["CLAIMS_FNOL", "CLAIMS_STATUS"],
      "backlog_use_cases": []
    },
    "billing": {
      "enabled_use_cases": ["BILLING_PAYMENT", "BILLING_INQUIRY"],
      "backlog_use_cases": ["BILLING_SCHEDULE", "BILLING_PREFERENCES"]
    }
  },
  "lob_automation_matrix": {
    "auto": {
      "policy_update_address": "automated",
      "policy_update_vehicle": "automated",
      "policy_update_driver": "automated",
      "policy_id_card": "automated",
      "claims_fnol": "automated",
      "claims_status": "automated",
      "billing_payment": "automated",
      "billing_inquiry": "automated",
      "billing_schedule": "automated",
      "billing_preferences": "automated",
      "quote_new_business": "automated"
    },
    "home": {
      "mailing_address": "automated",
      "dwelling_change": "escalate",
      "claims_fnol": "escalate",
      "claims_status": "automated",
      "billing_payment": "automated",
      "billing_inquiry": "automated",
      "billing_schedule": "automated",
      "billing_preferences": "automated",
      "quote_new_business": "escalate"
    },
    "umbrella": {
      "mailing_address": "automated",
      "policy_changes": "escalate",
      "claims_fnol": "escalate",
      "claims_status": "automated",
      "billing_payment": "automated",
      "billing_inquiry": "automated",
      "billing_schedule": "automated",
      "billing_preferences": "automated",
      "quote_new_business": "escalate"
    }
  }
}
```

### Gating Logic

An intent executes automatically only if:
1. The domain is enabled in `enabled_domains`, AND
2. The intent is in `enabled_use_cases` (not backlog), AND
3. The (intent, LOB) combination is `"automated"` in the matrix.

If any check fails → escalate.

### Per-Channel Configs

```json
{
  "voice": { "enabled_use_cases": ["BILLING_PAYMENT"] },
  "chat": { "enabled_use_cases": ["BILLING_PAYMENT", "BILLING_INQUIRY"] }
}
```

### Management Best Practices

1. Store configs externally (Talkdesk config layer, env vars, feature flags).
2. Version configs with activation dates for debugging and rollback.
3. Default to escalate-everything if config fails to load.
4. Provide a kill switch to disable any use case without a deployment.

---

## 19. Worked Examples

### Example 1: Auto + Home customer pays a bill

```
Customer (auto + home): "I need to make a payment."
Orchestrator: Routes to Billing Agent.
Billing Agent: No LOB gating needed. Proceeds with consolidated
  billing flow. Requests step-up auth, then processes payment.
Result: ✅ Automated.
```

### Example 2: Home-only customer reports roof damage

```
Customer (home only): "A tree fell on my roof last night."
Orchestrator: Routes to Claims Agent.
Claims Agent: Emergency check: "Is anyone hurt or in danger?"
Customer: "No, we're all okay."
Claims Agent: Classifies as HOME FNOL. Not automated.
  "I'm so sorry to hear that. Let me connect you with a home claims
  specialist right away."
  → Escalate to home_claims_intake with distress sentiment.
Result: ⚠️ Escalated warmly with context. Customer doesn't repeat.
```

### Example 3: Auto + Home customer updates mailing address

```
Customer (auto + home): "I need to update my address."
Orchestrator: Routes to Policy Agent.
Policy Agent: "Happy to help. Just so I handle this right — are you
  updating where we send your mail, or are you physically moving?"
Customer: "Just the mailing address. We're not moving."
Policy Agent: Path A. Proceeds with mailing address update.
  TOOL CALL: update_mailing_address(customer_id, new_address, ...)
  "Your mailing address has been updated. Your bills and documents
  for all your policies will go to the new address."
Result: ✅ Automated despite Home policy being present.
```

### Example 4: Auto + Home customer physically moves

```
Customer (auto + home): "I just moved to a new house."
Orchestrator: Routes to Policy Agent.
Policy Agent: Path C. Home policy present + physical move = escalate.
  "Congrats on the move! Because you have a home policy with us,
  let me connect you with a specialist who can handle the full move,
  including your home coverage."
Result: ⚠️ Escalated. Reason is clearly dwelling transition, not
  arbitrary data-drift defensiveness.
```

### Example 5: Auto-only customer physically moves within state

```
Customer (auto only): "I just moved."
Policy Agent: "Congrats on the move. Updating both where we send
  your mail and where your car is parked."
Collects new address. Validates. Same state. Single vehicle.
Updates mailing address and garaging address.
"Your rate may change; you'll get an updated dec page in 3-5 days."
Result: ✅ Automated.
```

### Example 6: Umbrella-only customer asks about claim status

```
Customer (umbrella only): "Any update on my claim?"
Claims Agent: Classifies as CLAIMS_STATUS. No LOB gating for status.
  TOOL CALL: get_claims_by_customer(customer_id) → umbrella claim
  Presents status and adjuster info.
Result: ✅ Automated.
```

### Example 7: Auto + Home customer asks why Home premium went up

```
Customer: "Why did my home insurance go up so much?"
Billing Agent: Intent = BILLING_INQUIRY, LOB = Home. In scope.
  TOOL CALL: get_premium_change_reasons(home_policy_id)
  Explains factors in plain language.
Customer: "I want to change my coverage then."
Billing Agent: Coverage change on Home = out of scope.
  "I understand. Let me connect you with a home specialist who can
  review your coverage with you."
  → Escalate to home_policy_service.
Result: ✅ Explained, then ⚠️ escalated cleanly at the boundary.
```

### Example 8: Auto FNOL full voice conversation

```
AGENT: Thanks for calling Acme Insurance. I'm your virtual assistant.
       To get started, what's the phone number on your account?

CUSTOMER: 555-867-5309

AGENT: I found your account. I'll send a verification code. Would
       you like it sent to your phone ending in 5309 or your email?

CUSTOMER: Phone is fine.

AGENT: Sent. Please say or enter your 6-digit code now.

CUSTOMER: 4-8-2-7-1-6

AGENT: You're verified. Hi Jennifer, how can I help?

CUSTOMER: I was in a car accident and I need to file a claim.

AGENT: I'm sorry to hear that. Before we start — is anyone injured?

CUSTOMER: No, everyone's okay. Just the cars are banged up.

AGENT: I'm glad everyone's safe. When did it happen?

CUSTOMER: About two hours ago, around 3 PM.

AGENT: Where did it happen?

CUSTOMER: Main Street and Oak Avenue in Plano.

AGENT: Which of your vehicles was involved? I see a 2022 Honda Civic
       and a 2020 Toyota RAV4.

CUSTOMER: The Civic.

AGENT: Were you driving?

CUSTOMER: Yes.

AGENT: Can you briefly tell me what happened?

CUSTOMER: Someone ran a red light and hit my passenger side.

AGENT: I'm sorry. Any other vehicles involved?

CUSTOMER: No, just us two.

AGENT: Did you get a police report?

CUSTOMER: Yes. Report number PL-2026-4412.

AGENT: Got it. Did you get the other driver's insurance info?

CUSTOMER: Yes, State Farm.

AGENT: Is your Civic drivable?

CUSTOMER: Barely. Passenger door is smashed in.

AGENT: Would you like me to arrange a tow?

CUSTOMER: No, I got it home.

AGENT: Your policy includes rental coverage. Want me to set that up?

CUSTOMER: Yes please.

AGENT: I'll get that started. Best way for your adjuster to reach you?

CUSTOMER: Call my cell, anytime.

AGENT: All set. Your claim has been filed. Your claim number is
       C-L-M-dash-7-7-4-2-3. I'll send that to your email. An
       adjuster will contact you within one business day. Your
       rental details will come by text shortly. Anything else?

CUSTOMER: No, that's it. Thank you.

AGENT: You're welcome, Jennifer. I hope the rest of your day gets
       better. Take care.
```

---

## 20. Testing Scenarios

### Auth Agent
- [ ] Happy path: phone → OTP → verify → authenticated
- [ ] ANI match: caller ID auto-populates phone
- [ ] Wrong phone number (no account)
- [ ] OTP to email vs phone
- [ ] Wrong OTP: 1, 2, 3 attempts → lockout
- [ ] OTP expiration (>5 min)
- [ ] OTP resend (max 2)
- [ ] Step-up auth mid-conversation
- [ ] Step-up auth failure → escalation

### Orchestrator
- [ ] Greeting → auth → single intent → complete → close
- [ ] Multi-intent: "update address and make payment" → sequential
- [ ] Ambiguous intent → clarifier → route
- [ ] Domain returns "reroute" → seamless transition
- [ ] Domain returns "escalate" → warm transfer
- [ ] Domain returns "requires_step_up_auth" → re-auth flow
- [ ] Auth failure → retry/quote/transfer
- [ ] Unauthenticated customer → direct to Quote
- [ ] Disabled domain → direct warm transfer

### Policy Agent
- [ ] Mailing address only: Auto-only customer
- [ ] Mailing address only: Auto + Home customer
- [ ] Mailing address only: Umbrella-only customer
- [ ] Physical move: Auto-only, same state
- [ ] Physical move: Auto-only, state change → escalate
- [ ] Physical move: Auto-only, PO box → request physical for garaging
- [ ] Physical move: Auto + Home → escalate (Path C)
- [ ] Ambiguous "I moved" → clarifier
- [ ] Add vehicle via VIN
- [ ] Add vehicle without VIN
- [ ] Remove vehicle (not last)
- [ ] Remove last vehicle → escalate
- [ ] Replace vehicle
- [ ] Add driver: clean MVR
- [ ] Add driver: MVR violations → escalate
- [ ] Remove driver (not named insured)
- [ ] Remove named insured → escalate
- [ ] ID card: email, text, mail delivery
- [ ] ID card: policy not active → reroute to billing
- [ ] Home policy change request → escalate
- [ ] Umbrella policy change request → escalate
- [ ] Mid-flow domain switch → reroute

### Claims Agent
- [ ] Auto FNOL: collision, full flow
- [ ] Auto FNOL: theft
- [ ] Auto FNOL: hail/weather
- [ ] Auto FNOL: injuries → emergency check
- [ ] Auto FNOL: vehicle not drivable → tow + rental
- [ ] Auto FNOL: late report (>30 days)
- [ ] Home FNOL: emergency check then escalate
- [ ] Umbrella FNOL: escalate
- [ ] Ambiguous FNOL → clarifier
- [ ] Claim status: Auto
- [ ] Claim status: Home
- [ ] Claim status: Umbrella
- [ ] Claim status: multiple claims → disambiguate
- [ ] Frustrated customer → priority flag
- [ ] Claim dispute → escalate

### Billing Agent
- [ ] Payment: Auto customer
- [ ] Payment: Home-only customer
- [ ] Payment: Umbrella-only customer
- [ ] Payment: Auto + Home + Umbrella bundled
- [ ] Payment: step-up auth triggered
- [ ] Payment: full balance on file
- [ ] Payment: partial amount above minimum
- [ ] Payment: new card via DTMF (voice)
- [ ] Payment: new card via secure form (chat)
- [ ] Payment: failure → retry → escalate
- [ ] Payment: resolves past-due
- [ ] Payment: reinstatement check
- [ ] Premium inquiry: Auto
- [ ] Premium inquiry: Home → explained, then coverage change → escalate
- [ ] Double charge: duplicate found
- [ ] Double charge: no duplicate found
- [ ] Schedule change: frequency
- [ ] Schedule change: due date
- [ ] Autopay enroll
- [ ] Autopay cancel
- [ ] Paperless enroll
- [ ] Payment method update (step-up auth)

### Quote Agent
- [ ] Auto quote: single vehicle, single driver
- [ ] Auto quote: multi-vehicle, multi-driver
- [ ] Home quote request → escalate
- [ ] Umbrella quote request → escalate
- [ ] Proceed → escalate to sales
- [ ] Think about it → save quote
- [ ] Unauth customer shifts to account → reroute

---

## 21. Implementation Checklist

### Backend APIs Required

- [ ] Customer record with `mailing_address` as top-level field
- [ ] Policy records linking to customer_id, with LOB-specific data
- [ ] Vehicle records under Auto policies with per-vehicle garaging_address
- [ ] Home policy records with dwelling_address
- [ ] Billing API supporting consolidated summary across all LOBs
- [ ] Claims API returning claims across all LOBs by default
- [ ] OTP service with 5-minute expiration
- [ ] USPS address validation
- [ ] VIN decoder
- [ ] MVR check service
- [ ] Payment processing (PCI-compliant, supports DTMF and tokenized)
- [ ] Tow dispatch integration
- [ ] Rental car setup integration
- [ ] All tools listed in Section 17

### Talkdesk Configuration

- [ ] Create Orchestrator agent with routing prompt
- [ ] Create Auth sub-agent with OTP flow
- [ ] Create Policy, Claims, Billing, Quote sub-agents
- [ ] Configure agent-to-agent handoff contracts
- [ ] Wire up step-up auth flow
- [ ] Configure warm transfer targets and routing rules
- [ ] Set up conversation state management
- [ ] Configure channel-specific adaptations (voice vs chat)
- [ ] Set up PCI-compliant payment input (DTMF for voice, iframe for chat)

### Configuration Layer

- [ ] External config store for `enabled_domains`
- [ ] External config store for per-domain `enabled_use_cases`
- [ ] External config store for `lob_automation_matrix`
- [ ] Per-channel config support
- [ ] Version control and activation dates
- [ ] Kill switch mechanism
- [ ] Graceful degradation default (escalate-all)

### Metrics to Track

- [ ] Containment rate (% fully handled by automation)
- [ ] Backlog escalation volume by intent
- [ ] Escalation rate within automated flows
- [ ] CSAT: automated vs escalated
- [ ] Handle time: automated vs escalated
- [ ] Transfer context utilization (do live agents reuse context?)
- [ ] Auth success rate
- [ ] Step-up auth success rate
- [ ] LOB mix of automated vs escalated conversations

### Launch Sequence Recommendation

1. **Phase 0 — Infrastructure:** Auth, Orchestrator, warm transfer,
   config layer. Everything escalates at launch.
2. **Phase 1 — Billing (chat only):** Enable BILLING_PAYMENT and
   BILLING_INQUIRY on chat. Measure containment, iterate.
3. **Phase 2 — Billing (voice):** Extend to voice after chat validates.
4. **Phase 3 — Claims status:** Low-risk, high-value. Chat first.
5. **Phase 4 — FNOL (Auto, chat):** Higher complexity; chat first for
   safety.
6. **Phase 5 — FNOL (Auto, voice):** Voice after chat validates.
7. **Phase 6 — Policy address updates:** Start with mailing only, then
   add physical move for Auto-only.
8. **Phase 7 — Remaining billing functions:** Schedule, preferences.
9. **Phase 8 — Policy vehicles/drivers.**
10. **Phase 9 — ID cards.**
11. **Phase 10 — Quote Agent.**

Each phase should validate containment, CSAT, and escalation context
quality before proceeding.

---

*End of Master Design Document*
