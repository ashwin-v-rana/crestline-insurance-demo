# Starter prompt for Talkdesk agent projects

Paste the prompt below into Claude Code at the start of a new or existing
Talkdesk AI Agent project. Fill in the PROJECT block and the last line.
Background and evidence: `MASTER_DESIGN.md`, "Sub-agent hand-off (as built)"
and "Human handoff (as built)"; tests: `tests/README.md`.

```text
You are helping me build or improve a Talkdesk AI Agent system: one Orchestrator (the platform's Coordinator, a SUPERVISING_AGENT) and several sub-agents (ACTION_AGENTs), running on gpt-4.1-mini at temperature 0. Apply the practices below. When something in my project conflicts with them, point it out and propose a fix; do not silently change behaviour.

PROJECT
- Type: <new system | existing system>
- Tenant / account / agent system id: <...>
- Business domains and what each sub-agent should do: <...>
- Which agents touch customer data (these need sign-in): <...>
- Human teams we hand off to: <...>
- Where the config and tests live in git: <...>

HOW TO START
- Existing system: export the live config and the latest draft, diff them against git, and summarise the differences before changing anything.
- Pull the full LLM calls of one real conversation (Databricks obs:databricks extract, the interaction's own UTC day, the account id, --no-unique-agent-keys) and read what each model actually receives before judging any prompt.
- New system: design the agent list, the auth gate, the reply format and the escalation path first; write instructions after.

1. PLATFORM FACTS TO DESIGN AROUND
- Only the Orchestrator talks to the customer. A sub-agent's message reaches the Orchestrator's model as "[X Agent to COORDINATOR] ...", and a sub-agent only sees what the Orchestrator writes to it, so it cannot tell the customer's words from the Orchestrator's summary.
- Talkdesk's wrapper tells every sub-agent to speak to the Coordinator, not the user ("I need the user's name", not "Can I have your name?"). Never instruct sub-agents in a way that contradicts this.
- After the conversation, on every turn, the platform appends a System Hint, Security Guidelines and a ~18k character Date Resolution block to the Orchestrator AND the sub-agents. They carry the most recency weight; instructions that conflict with them lose ("ask for missing parameters", "never ask for information already available", "after one clear confirmation, continue").
- A sub-agent's transfer_to_human does not end the conversation; it returns to the Orchestrator. Only the Orchestrator's transfer_to_human exits with escalate.
- Calling the same skill with the same input twice in one turn ends the conversation with "Sorry, I cannot handle your request right now."
- No {{variable}} substitution in instructions; sub-agents read session data through a workflow skill.
- A workflow persists a variable only when mapped in its End flow block.

2. AUTH GUARD (deterministic, outside the LLM)
- One session variable (e.g. authenticated) is marked "Set as auth condition". The gate opens only on the string "true".
- security_settings.gated_agents lists every agent that reads or writes customer data. Orchestrator, Auth and Escalation are not gated. Re-check this list after every GUI edit and before every publish.
- The platform answers STATUS: NEEDS_AUTHENTICATION for a gated agent without running it. The Orchestrator routes on intent regardless of sign-in status, then: NEEDS_AUTHENTICATION -> Auth Agent with "Authentication required. <request>"; auth success -> back to the gated agent with the original request restated.
- Verification happens in a workflow, never in the model: the workflow generates and sends the code, compares the entered code with the stored one, counts wrong attempts itself, returns MATCH / NO_MATCH / LOCKED, and is the only thing that sets the auth variable and the customer identity variables. The model never sets them.
- Give the 2nd wrong code a different reply from the 1st (identical consecutive replies make the model repeat its last action). On LOCKED -> escalate to an identity-verification team.
- Never reveal whether a phone number or account exists to an unauthenticated caller.

3. SUB-AGENT <-> ORCHESTRATOR REPLY FORMAT
Put a "HOW YOU REPLY - READ THIS FIRST" block at the top of every sub-agent. Every reply_to_coordinator message is exactly one of:
- A question, read-back, pick-list or skill-provided line for the customer:
  STATUS: NEED_INPUT | ASK_CUSTOMER: "<text, word for word>"
  Whole text inside the quotes (every list item); one question per message; a read-back is always its own message.
- A result or escalation as JSON, with a documented STATUS list:
  {"status":"complete","customer_message":"..."} / {"status":"escalate","escalation_target":"...","escalation_reason":"..."} / auth: {"auth_result":"success"|"failed","failure_reason":"..."}
The Orchestrator sends the customer's answer back as:
  CUSTOMER_REPLY: "<the customer's exact words>"
- A read-back is confirmed only by a CUSTOMER_REPLY that says yes. "The customer confirms ..." from the Orchestrator is not consent: re-ask.
- No database write, cancellation, payment or email for a change before that confirmation.

4. ORCHESTRATOR RULES
- No business logic and no data of its own. Keep the instruction around 8-12k characters, ASCII only.
- CRITICAL RULES first: route first (sub-agents collect details; this overrides the platform's ask-for-missing-parameters hint); it is a messenger - it never answers a sub-agent's question, even when it thinks it knows the answer; it delivers quoted text exactly; it passes the customer's answer back as CUSTOMER_REPLY; it never writes its own questions except the greeting, a clarifier, "anything else", a not-found line and the closing line; it never reveals agent or tool names.
- Decide each turn by who sent the last message. Customer message: person / out-of-scope teams -> Escalation; goodbye -> end_conversation; answer to a sub-agent's question -> that sub-agent as CUSTOMER_REPLY, even if it looks incomplete; new request -> route, restating every detail; unclear -> one clarifier.
- Sub-agent message: a first-match table keyed on the field present (ASK_CUSTOMER, STATUS: TRANSFER, NEEDS_AUTHENTICATION, auth_result, customer_message, status escalate, reroute), one action per row.
- Before delivering, a relay check: same closing question, every name/number/date/list item kept, not shorter than the source.
- routing_condition: one "## <Agent>" block per agent with its scope and "NOT: <near-miss> -> <other agent>" lines.
- Examples at the end, with placeholders for anything that should vary (examples get copied literally).

5. ESCALATION AGENT (single path to humans)
- Every handoff goes Orchestrator -> Escalation Agent, silently, with escalation_target plus two labelled lines: "Interaction summary: ISSUE: ... || ACTIONS: ..." and "Transfer reason: TEAM: ... || NEXT ACTION: ...". Facts from the conversation only; no IDs or agent names.
- The Escalation Agent picks the team (named target, else classify), reads session context, loads the human agent's brief (a workflow writing the Application Output; retry once if empty, else a system_error line), then calls transfer_to_human with:
  STATUS: TRANSFER | TELL_CUSTOMER: "<that team's fixed line>"
- The Orchestrator completes it with transfer_to_human and the quoted line, word for word. One fixed line per team, including identity_verification and system_error.

6. SUB-AGENT RULES
- First action on every call: read the customer identity from session context. Every SQL statement names the customer only by that id as a quoted literal - never a subquery, LIMIT or remembered value. Empty id -> system_error escalate.
- Out-of-scope requests escalate before any query or skill call.
- Collect one field per message; convert formats yourself (state names, dates) and never ask the customer to reformat.
- Every write uses RETURNING and checks it; errors -> escalate JSON.
- "Act, don't narrate": a step that must call a skill says "Do NOT output any message. Your next action is the <skill> call, in this same turn."
- Never call the same skill twice with the same input in one turn.

7. AUTHORING RULES
- State the rule as what to do; avoid "never say X" rules about wording (the model repeats the forbidden phrase).
- No "WRONG:" examples. ASCII only. Keep each instruction under ~12-14k characters.
- Work with the platform blocks, not against them.

8. TESTING
- A scripted-customer suite against the simulator API (/chat/context + simulator WebSocket), runnable on draft or live: first-turn routing probes, every business flow, sign-in, lockout, each escalation team, and add-then-remove pairs on made-up test records.
- Fail a run not only on its outcome but on how it got there: a sub-agent question answered without the customer, a dropped list, the Orchestrator asking its own question, a skipped escalation, a write before the customer's yes, the "Sorry, I cannot handle your request" fallback.
- Runs use real tools (real SMS, real writes): use a test customer, and make remove scenarios refuse anything but their own test record.

9. WORKING PRACTICES
- Before every API save of the draft, re-read it and check updated_utc has not changed; afterwards report the saved time so anyone with the editor open refreshes it (a stale editor tab overwrites API changes).
- Publish in the Talkdesk UI; publishing creates the next draft as a copy. After a publish or any GUI edit, export the config to git and update the design doc.
- Never print or commit secrets, tokens, OTP codes or personal phone numbers.

WHAT I WANT FROM YOU NOW
<e.g. "Review the exported config against these practices and list the gaps, most severe first" / "Design the agent list, gate settings, reply format and escalation teams for the domains above" / "Write the Orchestrator instruction and routing_condition">
```
