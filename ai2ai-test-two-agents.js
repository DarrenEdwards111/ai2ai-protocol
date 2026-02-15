#!/usr/bin/env node
/**
 * AI2AI Two-Agent Integration Test
 * 
 * Tests real communication between Darren's and Alex's servers:
 * 1. Starts both servers
 * 2. Ping from Darren → Alex (handshake)
 * 3. Meeting request from Darren → Alex
 * 4. Message relay from Alex → Darren
 * 5. Verifies pending queues
 * 6. Cleans up
 */

const http = require('http');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { fork } = require('child_process');

const DARREN_PORT = 18810;
const ALEX_PORT = 18811;
const DARREN_SKILL = '/home/darre/.openclaw/workspace/skills/ai2ai';
const ALEX_SKILL = '/home/darre/.openclaw/workspace-alex/skills/ai2ai';

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`   ✅ ${message}`);
  } else {
    failed++;
    failures.push(message);
    console.log(`   ❌ ${message}`);
  }
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sendJSON(port, data) {
  const body = JSON.stringify(data);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port,
      path: '/ai2ai',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-AI2AI-Version': '0.1' },
    }, (res) => {
      let buf = '';
      res.on('data', chunk => buf += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); }
        catch { resolve({ raw: buf }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function fetchHealth(port) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${port}/ai2ai/health`, (res) => {
      let buf = '';
      res.on('data', chunk => buf += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); }
        catch { resolve(null); }
      });
    }).on('error', reject);
  });
}

function createEnvelope(from, to, type, intent, payload, convId) {
  return {
    ai2ai: '0.1',
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    from,
    to,
    conversation: convId || crypto.randomUUID(),
    type,
    intent,
    payload: payload || {},
    requires_human_approval: true,
  };
}

async function cleanPending(skillDir) {
  const pendingDir = path.join(skillDir, 'pending');
  if (fs.existsSync(pendingDir)) {
    for (const f of fs.readdirSync(pendingDir)) {
      fs.unlinkSync(path.join(pendingDir, f));
    }
  }
}

async function listPending(skillDir) {
  const pendingDir = path.join(skillDir, 'pending');
  if (!fs.existsSync(pendingDir)) return [];
  return fs.readdirSync(pendingDir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(pendingDir, f), 'utf-8')); }
      catch { return null; }
    })
    .filter(Boolean);
}

function startServer(skillDir, port, name, envVars) {
  // Ensure directories exist
  for (const subdir of ['.keys', 'pending', 'conversations', 'logs', 'outbox']) {
    const dir = path.join(skillDir, subdir);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  const child = fork(
    path.join(skillDir, 'ai2ai-server.js'),
    [],
    {
      cwd: skillDir,
      env: { ...process.env, ...envVars },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    }
  );

  child.stdout.on('data', (data) => {
    // Suppress normal output during tests
  });
  child.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) console.error(`   [${name} ERR] ${msg}`);
  });

  return child;
}

async function waitForServer(port, maxMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const health = await fetchHealth(port);
      if (health?.status === 'online') return true;
    } catch { /* not ready */ }
    await delay(200);
  }
  return false;
}

// Setup contacts files
function setupContacts() {
  // Darren knows Alex
  const darrenContactsPath = path.join(DARREN_SKILL, 'contacts.json');
  fs.writeFileSync(darrenContactsPath, JSON.stringify({
    'alex-assistant': {
      humanName: 'Alex',
      endpoint: `http://localhost:${ALEX_PORT}/ai2ai`,
      trustLevel: 'known',
      lastSeen: new Date().toISOString(),
    }
  }, null, 2));

  // Alex knows Darren
  const alexContactsPath = path.join(ALEX_SKILL, 'contacts.json');
  fs.writeFileSync(alexContactsPath, JSON.stringify({
    'darren-assistant': {
      humanName: 'Darren',
      endpoint: `http://localhost:${DARREN_PORT}/ai2ai`,
      trustLevel: 'known',
      lastSeen: new Date().toISOString(),
    }
  }, null, 2));
}

async function runTests() {
  console.log('🧪 AI2AI Two-Agent Integration Test\n');

  // Clean state
  await cleanPending(DARREN_SKILL);
  await cleanPending(ALEX_SKILL);
  setupContacts();

  // Start servers
  console.log('━━━ Starting servers ━━━');
  
  const darrenServer = startServer(DARREN_SKILL, DARREN_PORT, 'Darren', {
    AI2AI_PORT: String(DARREN_PORT),
    AI2AI_AGENT_NAME: 'darren-assistant',
    AI2AI_HUMAN_NAME: 'Darren',
    AI2AI_TIMEZONE: 'Europe/London',
  });

  const alexServer = startServer(ALEX_SKILL, ALEX_PORT, 'Alex', {
    AI2AI_PORT: String(ALEX_PORT),
    AI2AI_AGENT_NAME: 'alex-assistant',
    AI2AI_HUMAN_NAME: 'Alex',
    AI2AI_TIMEZONE: 'America/New_York',
  });

  try {
    const darrenReady = await waitForServer(DARREN_PORT);
    assert(darrenReady, `Darren's server started on port ${DARREN_PORT}`);

    const alexReady = await waitForServer(ALEX_PORT);
    assert(alexReady, `Alex's server started on port ${ALEX_PORT}`);

    if (!darrenReady || !alexReady) {
      console.error('Servers failed to start. Aborting.');
      return;
    }

    // ━━━ Test 1: Health checks ━━━
    console.log('\n━━━ 1. Health Checks ━━━');
    const darrenHealth = await fetchHealth(DARREN_PORT);
    assert(darrenHealth?.status === 'online', "Darren's health: online");
    assert(darrenHealth?.intents?.includes('schedule.meeting'), "Darren supports schedule.meeting");

    const alexHealth = await fetchHealth(ALEX_PORT);
    assert(alexHealth?.status === 'online', "Alex's health: online");

    // ━━━ Test 2: Ping (Darren → Alex) ━━━
    console.log('\n━━━ 2. Ping: Darren → Alex ━━━');
    const darrenId = { agent: 'darren-assistant', node: 'darren-openclaw', human: 'Darren' };
    const alexId = { agent: 'alex-assistant', node: 'alex-openclaw', human: 'Alex' };

    const pingEnvelope = createEnvelope(darrenId, alexId, 'ping', null, {
      capabilities: ['schedule.meeting', 'message.relay', 'info.request'],
      languages: ['en'],
      timezone: 'Europe/London',
      protocol_versions: ['0.1'],
    });

    const pingResult = await sendJSON(ALEX_PORT, pingEnvelope);
    assert(pingResult.status === 'ok', 'Ping response: ok');
    assert(pingResult.type === 'ping', 'Ping response type: ping');
    assert(Array.isArray(pingResult.payload?.capabilities), 'Ping returns capabilities');
    assert(pingResult.payload?.x25519_public_key, 'Ping returns X25519 public key');

    // ━━━ Test 3: Ping back (Alex → Darren) ━━━
    console.log('\n━━━ 3. Ping: Alex → Darren ━━━');
    const pingBack = createEnvelope(alexId, darrenId, 'ping', null, {
      capabilities: ['schedule.meeting', 'message.relay'],
      languages: ['en'],
      timezone: 'America/New_York',
      protocol_versions: ['0.1'],
    });

    const pingBackResult = await sendJSON(DARREN_PORT, pingBack);
    assert(pingBackResult.status === 'ok', 'Ping back: ok');
    
    // ━━━ Test 4: Meeting request (Darren → Alex) ━━━
    console.log('\n━━━ 4. Meeting Request: Darren → Alex ━━━');
    const convId = crypto.randomUUID();
    
    const meetingEnvelope = createEnvelope(darrenId, alexId, 'request', 'schedule.meeting', {
      subject: 'Dinner to catch up',
      proposed_times: [
        '2026-02-10T19:00:00Z',
        '2026-02-12T19:00:00Z',
        '2026-02-13T19:00:00Z',
      ],
      duration_minutes: 90,
      location_preference: 'Restaurant near central London',
      flexibility: 'high',
      notes: 'Darren is vegetarian.',
    }, convId);

    const meetingResult = await sendJSON(ALEX_PORT, meetingEnvelope);
    assert(meetingResult.status === 'pending_approval', 'Meeting: pending_approval');
    assert(meetingResult.conversation === convId, 'Meeting: correct conversation ID');

    await delay(200);

    // Check Alex's pending queue
    const alexPending = await listPending(ALEX_SKILL);
    const meetingPending = alexPending.find(p => p.envelope?.conversation === convId);
    assert(meetingPending !== undefined, 'Meeting request in Alex\'s pending queue');
    assert(meetingPending?.approvalMessage?.includes('Meeting Request'), 'Pending has approval message');
    assert(meetingPending?.approvalMessage?.includes('Dinner to catch up'), 'Approval message includes subject');

    // ━━━ Test 5: Message relay (Alex → Darren) ━━━
    console.log('\n━━━ 5. Message Relay: Alex → Darren ━━━');
    const msgEnvelope = createEnvelope(alexId, darrenId, 'request', 'message.relay', {
      message: 'Hey Darren, looking forward to catching up!',
      urgency: 'low',
      reply_requested: true,
    });

    const msgResult = await sendJSON(DARREN_PORT, msgEnvelope);
    assert(msgResult.status === 'pending_approval', 'Message relay: pending_approval');

    await delay(200);

    const darrenPending = await listPending(DARREN_SKILL);
    const msgPending = darrenPending.find(p => 
      p.envelope?.intent === 'message.relay' && 
      p.envelope?.from?.agent === 'alex-assistant'
    );
    assert(msgPending !== undefined, 'Message in Darren\'s pending queue');
    assert(msgPending?.approvalMessage?.includes('looking forward'), 'Message content preserved');

    // ━━━ Test 6: Info request (Darren → Alex) ━━━
    console.log('\n━━━ 6. Info Request: Darren → Alex ━━━');
    const infoEnvelope = createEnvelope(darrenId, alexId, 'request', 'info.request', {
      question: 'What restaurant would you prefer?',
      context: 'For our dinner next week',
    });

    const infoResult = await sendJSON(ALEX_PORT, infoEnvelope);
    assert(infoResult.status === 'pending_approval', 'Info request: pending_approval');

    // ━━━ Test 7: Commerce request (Darren → Alex) ━━━
    console.log('\n━━━ 7. Commerce Request: Darren → Alex ━━━');
    const commerceEnvelope = createEnvelope(darrenId, alexId, 'request', 'commerce.request', {
      item: 'Custom AI training data',
      description: '1000 curated conversation pairs',
      quantity: 1,
      budget: '500',
      currency: 'GBP',
    });

    const commerceResult = await sendJSON(ALEX_PORT, commerceEnvelope);
    assert(commerceResult.status === 'pending_approval', 'Commerce: pending_approval');

    // ━━━ Test 8: Verify pending counts ━━━
    console.log('\n━━━ 8. Verify Pending Counts ━━━');
    const finalAlexPending = await listPending(ALEX_SKILL);
    const finalDarrenPending = await listPending(DARREN_SKILL);

    // Alex should have: meeting request + info request + commerce request = 3
    const alexUnresolved = finalAlexPending.filter(p => !p.resolved);
    assert(alexUnresolved.length >= 3, `Alex has ${alexUnresolved.length} pending (expected ≥3)`);

    // Darren should have: message relay = 1
    const darrenUnresolved = finalDarrenPending.filter(p => !p.resolved);
    assert(darrenUnresolved.length >= 1, `Darren has ${darrenUnresolved.length} pending (expected ≥1)`);

    // ━━━ Test 9: Response flow (Alex confirms meeting → Darren) ━━━
    console.log('\n━━━ 9. Response Flow: Alex confirms → Darren ━━━');
    const responseEnvelope = createEnvelope(alexId, darrenId, 'response', 'schedule.meeting', {
      accepted_time: '2026-02-12T19:00:00Z',
      counter_proposal: null,
      message: 'Thursday at 7 works. How about The Green Table in Soho?',
    }, convId);

    const responseResult = await sendJSON(DARREN_PORT, responseEnvelope);
    assert(responseResult.status === 'ok', 'Response: ok');

    // ━━━ Test 10: Confirmation (Darren → Alex) ━━━
    console.log('\n━━━ 10. Confirmation: Darren → Alex ━━━');
    const confirmEnvelope = createEnvelope(darrenId, alexId, 'confirm', 'schedule.meeting', {
      confirmed_time: '2026-02-12T19:00:00Z',
      confirmed_location: 'The Green Table, Soho',
      message: 'Perfect! See you Thursday.',
    }, convId);

    const confirmResult = await sendJSON(ALEX_PORT, confirmEnvelope);
    assert(confirmResult.status === 'ok', 'Confirm: ok');

  } finally {
    // Cleanup
    console.log('\n━━━ Cleanup ━━━');
    darrenServer.kill('SIGTERM');
    alexServer.kill('SIGTERM');
    await delay(500);
  }

  // Summary
  console.log('\n' + '═'.repeat(50));
  console.log(`  ✅ Passed: ${passed}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log('═'.repeat(50));

  if (failures.length > 0) {
    console.log('\n  Failures:');
    failures.forEach(f => console.log(`    • ${f}`));
  }

  console.log();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('❌ Test crashed:', err);
  process.exit(1);
});
