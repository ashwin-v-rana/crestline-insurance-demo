"""Score td_sim.js runs. Usage: python3 -I td_score.py <run.json> [...]

Prints, per run, the agent hops and tool calls, then PASS/FAIL against
the scenario's expectation.
"""
import json, re, sys

PROBE_FIRST_HOP = {  # first message -> agent the Orchestrator must route to
    'deductible': 'Claims Knowledge Agent', 'mailing address': 'Policy Agent',
    'add a car': 'Vehicle Agent', 'add my son': 'Drivers Agent', 'accident': 'Claims Agent',
    'moving': 'Policy Agent',
}


def hops(records):
    out = []
    for r in records:
        m, tc = r.get('message'), r.get('tool_call')
        if r['record_type'] == 'MESSAGE' and m:
            src = (m.get('from_agent') or {}).get('name') or m.get('from')
            dst = (m.get('to_agent') or {}).get('name') or m.get('to')
            out.append(f"{src}->{dst}")
        elif r['record_type'] == 'TOOL_CALL' and tc:
            name = (tc.get('tool') or {}).get('tool_name') or tc.get('tool_name') or r.get('llm_action')
            out.append(f"[{name}]")
        if r.get('exit'):
            out.append(f"EXIT:{r['exit'].get('type')}/{r.get('llm_action')}")
    return out


def agent_said(recs, agent, pattern):
    return any(r['record_type'] == 'MESSAGE' and r.get('message') and (r['message'].get('from_agent') or {}).get('name') == agent
               and re.search(pattern, r['message'].get('msg') or '', re.I) for r in recs)


def transfer_team(recs):
    for r in recs:
        tc = r.get('tool_call')
        if r['record_type'] == 'TOOL_CALL' and tc and tc.get('tool_name') == 'Load_Transfer_Data':
            m = re.search(r'TEAM:\s*([^|"\\]+)', tc.get('arguments') or '')
            return (m.group(1).strip() if m else '?')
    return None


ORCH = 'Crestline Orchestrator'
OWN_LINES = r"Welcome to Crestline|anything else I can help|You're all set|could you tell me a bit more|wasn't able to find an account"


def relay_faults(recs):
    """Orchestrator faults any scenario can hit:
    answered_for_customer - a sub-agent's question went back to a sub-agent with no customer reply;
    list_dropped - a sub-agent's numbered list did not reach the customer;
    skipped_escalation - an escalation result was answered with a message instead of a handoff;
    own_question - the Orchestrator wrote to the customer without a sub-agent message to deliver."""
    faults, pending, escalate_due = [], None, False  # pending = last sub-agent message not yet delivered
    for r in recs:
        m = r.get('message')
        if r['record_type'] != 'MESSAGE' or not m:
            continue
        src = (m.get('from_agent') or {}).get('name') or m.get('from')
        dst = (m.get('to_agent') or {}).get('name') or m.get('to')
        msg = m.get('msg') or ''
        if src not in (ORCH, 'USER') and dst == ORCH:
            pending = msg
            escalate_due = bool(re.search(r'"failure_reason":\s*"max_attempts"|"status":\s*"escalate"', msg))
        elif src == ORCH and dst == 'USER':
            if escalate_due and not r.get('exit'):
                faults.append('skipped_escalation')
            escalate_due = False
            if pending and len(re.findall(r'^\s*\d+\.', pending, re.M)) >= 2 and len(re.findall(r'^\s*\d+\.', msg, re.M)) < 2:
                faults.append('list_dropped')
            if not pending and not re.search(OWN_LINES, msg) and '?' in msg:
                faults.append('own_question')
            pending = None
        elif src == ORCH and dst not in ('USER', ORCH) and pending and '?' in pending \
                and (not re.match(r'\s*\{|STATUS:', pending) or 'ASK_CUSTOMER' in pending):
            faults.append('answered_for_customer')
            pending = None
        elif src == 'USER':
            pending = None
    return faults


ESCALATE_TEAM = {'billing': r'billing', 'billing_q': r'billing', 'quote': r'sales'}


def score(d):
    sc, recs = d['scenario'], d['records']
    h = hops(recs)
    last = next((t['text'] for t in reversed(d['transcript']) if t['who'] == 'agent'), '')
    agents_seen = ' '.join(h)
    escalated = (d.get('exit') or {}).get('type') == 'escalate'
    loaded = '[Load_Transfer_Data]' in agents_seen
    sorry = any('cannot handle your request' in (t['text'] or '') for t in d['transcript'] if t['who'] == 'agent')
    if sc == 'address':
        ok = any(r['record_type'] == 'MESSAGE' and r.get('message') and (r['message'].get('from_agent') or {}).get('name') == 'Policy Agent'
                 and re.search(r'has been updated|was updated|have updated|updated to', r['message'].get('msg') or '', re.I) for r in recs)
        why = 'address updated' if ok else 'address NOT updated'
    elif sc == 'lockout':
        ok = escalated and loaded
        why = f"escalate={escalated} transfer_data={loaded}"
    elif sc == 'person':
        ok = escalated and loaded
        why = f"escalate={escalated} transfer_data={loaded}"
    elif sc in ESCALATE_TEAM:
        team = transfer_team(recs)
        ok = escalated and bool(team and re.search(ESCALATE_TEAM[sc], team, re.I))
        why = f"escalate={escalated} team={team}; customer heard: {last[:70]!r}"
    elif sc == 'driver_add':
        ok = agent_said(recs, 'Drivers Agent', r'Added .*Testdriver')
        why = 'driver added' if ok else 'driver NOT added'
    elif sc == 'driver_remove':
        ok = agent_said(recs, 'Drivers Agent', r'Removed .*Testdriver')
        why = 'driver removed' if ok else 'driver NOT removed'
    elif sc == 'vehicle_add':
        ok = agent_said(recs, 'Vehicle Agent', r'added .*Studebaker')
        why = 'vehicle added' if ok else 'vehicle NOT added'
    elif sc == 'vehicle_remove':
        ok = agent_said(recs, 'Vehicle Agent', r'removed .*Studebaker')
        why = 'vehicle removed' if ok else 'vehicle NOT removed'
    elif sc == 'claim_status':
        ok = agent_said(recs, 'Claims Knowledge Agent', r'is currently|don.t have any claims')
        why = 'status given' if ok else 'NO claim status'
    else:  # probe
        first = sc[6:].lower()
        want = next((v for k, v in PROBE_FIRST_HOP.items() if k in first), None)
        first_hop = next((x for x in h if x.startswith('Crestline Orchestrator->') and not x.endswith('USER')), None)
        to_auth = 'Crestline Orchestrator->Auth Agent' in h
        ok = bool(want and first_hop and first_hop.endswith(want)) and to_auth
        why = f"first hop {first_hop or 'none (asked customer)'}; want {want}; gate->Auth {to_auth}"
    faults = relay_faults(recs)
    # A write to customer data must come after the customer said yes to a read-back.
    said_yes = False
    for r in recs:
        m, tc = r.get('message'), r.get('tool_call')
        if m and m.get('from') == 'USER' and re.match(r'\s*yes', m.get('msg') or '', re.I):
            said_yes = True
        if tc and tc.get('tool_name') == 'execute_sql' and re.search(r'(INSERT INTO|UPDATE) (drivers|vehicles|customers|policies)', tc.get('arguments') or '', re.I) and not said_yes:
            faults.append('wrote_without_confirmation')
    if faults:
        ok, why = False, why + '; ' + ', '.join(sorted(set(faults)))
    if sorry:
        ok, why = False, why + '; platform fallback "Sorry..."'
    return ok, why, h, last


for f in sys.argv[1:]:
    d = json.load(open(f))
    ok, why, h, last = score(d)
    print(f"{'PASS' if ok else 'FAIL'}  {f.split('/')[-1]:<22} {d['interactionId'][:8]}  {why}")
    print('      ', ' | '.join(h)[:900])
