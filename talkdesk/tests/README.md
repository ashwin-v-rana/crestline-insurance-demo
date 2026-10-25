# Crestline agent test suite

A scripted customer that chats with the Crestline AI agent system through the
Talkdesk simulator, and a scorer that marks each conversation PASS or FAIL.

**These runs use real tools.** Every scenario that reaches sign-in sends a real
SMS code to `TD_TEST_PHONE`. Driver add/remove and address changes write to the
database and send confirmation emails to the test customer's email.

## Setup

```bash
cd talkdesk/tests
npm install                      # installs ws
./get_token.sh                   # reads TALKDESK_CLIENT_ID / _SECRET from ../../../.env.local
export TD_TEST_PHONE=+1...       # phone of the test customer record (E.164)
```

Optional: `TD_SYSTEM_ID` (agent system), `TD_ACCOUNT_ID`, `TD_ORIGIN`
(`https://<tenant>.mytalkdesk.com`), `TD_TENANT` for the token host.
Tokens expire after about an hour; run `./get_token.sh` again.

## Run

```bash
./run_suite.sh v25_try1          # against the DRAFT version
./run_suite.sh v25_live live     # against the published version
python3 -I td_score.py runs/v25_try1/*.json      # rescore, with agent hops
python3 -I td_reword.py runs/v25_try1/*.json     # relay wording / agent-name leaks
```

One scenario: `node td_sim.js .tok <systemId> <true|false> out.json <scenario>`.

## Scenarios

| Scenario | Customer says | Pass when |
|---|---|---|
| `probe:<text>` | the text, first turn only | first hop is the right sub-agent and the gate goes to the Auth Agent |
| `address` | change mailing address | Policy Agent reports the address updated |
| `lockout` | address change, then 4 wrong codes | handoff (escalate) with Transfer Data loaded |
| `person` | asks for a real person | handoff with Transfer Data loaded |
| `billing` / `billing_q` | autopay / next payment due | handoff to the billing team |
| `quote` | homeowners price | handoff to the sales team |
| `driver_add` / `driver_remove` | adds, then removes "Sam Testdriver" | Drivers Agent reports added / removed |
| `vehicle_add` / `vehicle_remove` | adds, then removes a 1957 Studebaker Champion | Vehicle Agent reports added / removed |
| `claim_status` | status of my claim | Claims Knowledge Agent gives a status |

Every run also fails on these Orchestrator faults:
`answered_for_customer` (a sub-agent question answered without the customer),
`list_dropped`, `own_question`, `skipped_escalation`,
`wrote_without_confirmation` (a database write before the customer said yes),
and the platform fallback "Sorry, I cannot handle your request right now."

The simulated customer answers by keyword (`nextUserMessage` in `td_sim.js`).
The remove scenarios say yes only to removing their own test record and "No" to anything else.
It reads the sign-in code from the `send_one_time_pin` tool output and never
prints it. A run that stops early with an unexpected question usually needs a
new keyword rule there.
