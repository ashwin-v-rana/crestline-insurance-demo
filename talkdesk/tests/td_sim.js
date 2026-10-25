// Scripted simulated customer for the Talkdesk simulator (protocol as in td_chat.js).
// The customer answers what the agent asks, by keyword. The OTP code is read from
// send_one_time_pin's output (sent_pin is visible on purpose) and never printed.
// Usage: node td_sim.js <tokenFile> <systemId> <isDraft> <outJson> <scenario>
// Env: TD_TEST_PHONE (required: phone of the test customer, E.164), TD_ACCOUNT_ID, TD_ORIGIN.
// Scenarios: address | lockout | person | billing | billing_q | quote | driver_add |
//   driver_remove | vehicle_add | vehicle_remove | claim_status | probe:<first message>
const fs = require('fs');
const crypto = require('crypto');
const WebSocket = require('ws');

const [tokenFile, systemId, isDraftArg, outJson, scenario] = process.argv.slice(2);
const token = fs.readFileSync(tokenFile, 'utf8').trim();
const ACCOUNT = process.env.TD_ACCOUNT_ID || '68668a003d12ae2f90ebbcb4';
const API = 'https://api.talkdeskapp.com';
const ORIGIN = process.env.TD_ORIGIN || 'https://partner-team1.mytalkdesk.com';
const WS_BASE = 'wss://ai-agent-platform.talkdeskapp.com';
const PHONE = process.env.TD_TEST_PHONE;
if (!PHONE) { console.error('Set TD_TEST_PHONE to the test customer phone (E.164).'); process.exit(2); }
const NEW_ADDRESS = '100 Example Ave, Austin, TX 78701';
const sessionId = crypto.randomUUID();
const interactionId = crypto.randomUUID().replace(/-/g, '');
const records = [];
const transcript = [];
let wrongCodes = ['111111', '222222', '333333', '444444'];

const OPENERS = {
  address: 'I need to change my mailing address.',
  lockout: 'I need to change my mailing address.',
  person: 'Can I talk to a real person please?',
  billing: 'I want to set up autopay on my policy.',
  billing_q: 'When is my next payment due, and how much will it be?',
  quote: 'How much would it cost to get homeowners insurance with you?',
  driver_add: "I'd like to add my son as a driver on my auto policy.",
  driver_remove: 'I need to remove a driver from my auto policy.',
  claim_status: "What's the status of my claim?",
  vehicle_add: "I'd like to add a car to my auto policy.",
  vehicle_remove: 'I need to remove a car from my auto policy.',
};
const DRIVER = { first: 'Sam', last: 'Testdriver', dob: '03-14-2008' };
// Test vehicle: added by vehicle_add, removed by vehicle_remove. A make no real policy holds.
const VEHICLE = { year: '1957', make: 'Studebaker', model: 'Champion' };
// The remove scenarios only ever agree to remove the test record.
const REMOVE_TARGET = { driver_remove: DRIVER.last, vehicle_remove: VEHICLE.make }[scenario];

function sentPin() {
  let pin = null;
  for (const r of records) {
    const te = r.tool_execution;
    if (te && te.tool && te.tool.tool_name === 'send_one_time_pin') {
      const m = JSON.stringify(te).match(/sent_pin\W+(\d{6})/);
      if (m) pin = m[1];
    }
  }
  return pin;
}

// Returns the customer's next message, or null to stop.
function nextUserMessage(agent) {
  const a = agent.toLowerCase();
  if (/anything else/.test(a)) return 'No, that is all. Thanks!';
  if (/phone number/.test(a)) return PHONE;
  if (/code/.test(a) && /(enter|received|6-digit|didn't match|did not match)/.test(a)) {
    if (scenario === 'lockout') return wrongCodes.shift() || null;
    const pin = sentPin();
    return pin ? pin.slice(0, 3) + ' ' + pin.slice(3) : null;
  }
  if (/(correct|confirm|is that right|shall i|should i|go ahead)\W*$|is that correct|are you sure/.test(a)) {
    if (REMOVE_TARGET && !a.includes(REMOVE_TARGET.toLowerCase())) return 'No, that is not the one.';
    return 'Yes, that is correct.';
  }
  // Vehicle Agent fields (add flow).
  if (/year, make and model|make and model/.test(a)) return `A ${VEHICLE.year} ${VEHICLE.make} ${VEHICLE.model}.`;
  if (/\bvin\b/.test(a)) return "No, I don't have it handy.";
  if (/parked/.test(a) && /where/.test(a)) return NEW_ADDRESS;
  if (/parked/.test(a)) return 'Yes, it will be parked there.';
  if (scenario === 'vehicle_remove' && /remove/.test(a) && /which|\?/.test(a)) return `The ${VEHICLE.year} ${VEHICLE.make} ${VEHICLE.model}.`;
  // Drivers Agent fields (add flow), most specific first.
  if (/license/.test(a)) return "No, I don't have it handy.";
  if (/first name/.test(a)) return DRIVER.first;
  if (/last name/.test(a)) return DRIVER.last;
  if (/date of birth/.test(a)) return DRIVER.dob;
  if (/relationship/.test(a)) return 'He is my son.';
  // Drivers Agent remove flow: pick the test driver by name.
  if (/remove/.test(a) && /which|\?/.test(a)) return `${DRIVER.first} ${DRIVER.last}`;
  // Claims Knowledge Agent.
  if (/which claim|here are your claims/.test(a)) return 'The first one.';
  if (/claim number/.test(a)) return 'I do not have it. Please look up my claims.';
  if (/specific claim|general insurance question/.test(a)) return "I'm checking on a specific claim.";
  if (/address/.test(a) && /(\?|provide|give me|enter)/.test(a)) return NEW_ADDRESS;
  return null;
}

function waitForAgent(ws, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.removeListener('message', onMsg); reject(new Error('timeout')); }, timeoutMs);
    function onMsg(data) {
      let r;
      try { r = JSON.parse(data.toString()); } catch { return; }
      for (const rec of r.records || []) records.push(rec);
      const agentMsg = (r.records || []).some(x => x.record_type === 'MESSAGE' && x.message && x.message.to === 'USER' && !x.message.is_filler);
      const exit = (r.records || []).some(x => x.exit);
      if (agentMsg || exit || r.agent_text || r.exit || r.end_connection_reason) {
        clearTimeout(timer); ws.removeListener('message', onMsg); resolve(r);
      }
    }
    ws.on('message', onMsg);
  });
}

function agentText(r) {
  const t = (r.records || []).filter(x => x.record_type === 'MESSAGE' && x.message && x.message.to === 'USER' && !x.message.is_filler).map(x => x.message.msg).join('\n');
  return t || r.agent_text || '';
}

function exitOf(r) {
  const rec = (r.records || []).find(x => x.exit);
  return (rec && { ...rec.exit, llm_action: rec.llm_action, by: rec.message && rec.message.from_agent && rec.message.from_agent.name }) || r.exit || r.end_connection_reason || null;
}

(async () => {
  const res = await fetch(`${API}/chat/context`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({
      interaction_id: interactionId, session_id: sessionId, room_id: 'sample room_id',
      account_id: ACCOUNT, agent_system_id: systemId,
      context: { account_id: ACCOUNT, interaction_id: interactionId, channelType: 'digital', channelName: 'SIMULATOR', callerId: '123456789', businessHours: '' },
      is_draft: isDraftArg === 'true',
    }),
  });
  console.log(`[${scenario}] context ${res.status} interaction=${interactionId}`);
  if (!res.ok) { console.log(await res.text()); process.exit(1); }

  const ws = new WebSocket(`${WS_BASE}/simulator?sessionId=${sessionId}`, { headers: { Origin: ORIGIN } });
  await new Promise((ok, bad) => { ws.once('open', ok); ws.once('error', bad); });
  try {
    const g = await waitForAgent(ws, 20000);
    transcript.push({ who: 'agent', text: agentText(g) });
  } catch { console.log('(no greeting)'); }

  const probe = scenario.startsWith('probe:');
  let text = probe ? scenario.slice(6) : OPENERS[scenario];
  let exit = null;
  for (let turn = 0; text && turn < 12; turn++) {
    const p = waitForAgent(ws, 90000);
    ws.send(JSON.stringify({ id: `user-${Date.now()}`, text, sender: 'user', timestamp: new Date().toISOString(),
      account_id: ACCOUNT, agent_system_id: systemId, interaction_id: interactionId, session_id: sessionId, room_id: 'sample room_id' }));
    const shown = /^\d{3} \d{3}$/.test(text) && scenario !== 'lockout' ? '<correct code>' : text;
    transcript.push({ who: 'user', text: shown });
    console.log(`  USER:  ${shown}`);
    let r;
    try { r = await p; } catch (e) { console.log(`  AGENT: (${e.message})`); exit = { type: 'timeout' }; break; }
    const t = agentText(r);
    exit = exitOf(r);
    transcript.push({ who: 'agent', text: t, exit });
    console.log(`  AGENT: ${t}${exit ? `  [END: ${JSON.stringify(exit)}]` : ''}`);
    if (exit || probe) break;
    text = nextUserMessage(t);
  }
  ws.close();
  fs.writeFileSync(outJson, JSON.stringify({ interactionId, sessionId, systemId, scenario, transcript, exit, records }, null, 2));
  console.log(`[${scenario}] saved ${records.length} records`);
})().catch(e => { console.error(e); process.exit(1); });
