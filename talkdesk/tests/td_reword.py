"""Flag sub-agent messages the Orchestrator reworded or leaked agent names in.
Usage: python3 -I td_reword.py <run.json> [...]"""
import json, sys
NAMES = ('Auth Agent', 'Policy Agent', 'Vehicle Agent', 'Drivers Agent', 'Claims Agent', 'Claims Knowledge', 'Escalation Agent')
tot = rew = leak = 0
for f in sys.argv[1:]:
    recs = json.load(open(f))['records']
    for i, r in enumerate(recs):
        m = r.get('message')
        if not (m and m.get('to') == 'USER' and m.get('from') == 'COORDINATOR'):
            continue
        b = m['msg'] or ''
        if any(n.lower() in b.lower() for n in NAMES):
            leak += 1; print('LEAK   ', f.split('/')[-1], '|', b[:140])
        p = recs[i - 1].get('message') if i else None
        if p and p.get('from') == 'ACTION_AGENT' and r.get('llm_action') == 'send_to_user' and not r.get('exit'):
            a = p['msg'] or ''
            tot += 1
            if 'phone number' in a and 'phone number' not in b or 'code' in b and 'phone number' in a and 'code' not in a or "can't" in b and "can't" not in a:
                rew += 1; print('WRONG  ', f.split('/')[-1], '|', a[:80], '=>', b[:110])
print(f'relayed {tot}, wrong-meaning {rew}, agent-name leaks {leak}')
