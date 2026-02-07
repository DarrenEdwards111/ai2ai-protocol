#!/usr/bin/env node
/**
 * AI2AI Demo — Two Agents Negotiating
 * 
 * Simulates two OpenClaw agents (Darren's & Alex's) on the same machine,
 * negotiating a dinner meeting on behalf of their humans.
 * 
 * This is what it looks like when AI agents talk to each other.
 */

const http = require('http');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// Colors for terminal output
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';

const DARREN_PORT = 18810;
const ALEX_PORT = 18811;

// Simulated delay for realism
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function timestamp() {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z/, ' UTC');
}

function banner(text) {
  const line = '═'.repeat(60);
  console.log(`\n${CYAN}${line}${RESET}`);
  console.log(`${CYAN}  ${BOLD}${text}${RESET}`);
  console.log(`${CYAN}${line}${RESET}\n`);
}

function agentLog(agent, color, emoji, message) {
  console.log(`${DIM}[${timestamp()}]${RESET} ${color}${emoji} ${BOLD}${agent}:${RESET} ${message}`);
}

function humanLog(human, color, message) {
  console.log(`${color}  💬 ${BOLD}${human}:${RESET} ${color}${message}${RESET}`);
}

function networkLog(from, to, type, intent) {
  console.log(`${DIM}  📡 ${from} ──[${type}${intent ? ':' + intent : ''}]──▶ ${to}${RESET}`);
}

// Create a simple AI2AI envelope
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

// Simple HTTP send
async function sendAI2AI(port, envelope) {
  const body = JSON.stringify(envelope);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port,
      path: '/ai2ai',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-AI2AI-Version': '0.1' },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Create a mini AI2AI server for an agent
function createAgentServer(name, port, config) {
  const pending = [];
  
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/ai2ai/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'online', agent: name, protocol: 'ai2ai', version: '0.1' }));
      return;
    }

    if (req.method !== 'POST' || req.url !== '/ai2ai') {
      res.writeHead(404);
      res.end();
      return;
    }

    let body = '';
    for await (const chunk of req) body += chunk;
    
    let envelope;
    try { envelope = JSON.parse(body); }
    catch { res.writeHead(400); res.end('{"error":"invalid json"}'); return; }

    // Store for processing
    pending.push(envelope);

    if (envelope.type === 'ping') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        type: 'ping',
        payload: {
          capabilities: ['schedule.meeting', 'message.relay'],
          timezone: config.timezone,
          agent: name,
          human: config.humanName,
        }
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'pending_approval',
        message: `Waiting for ${config.humanName}'s approval.`,
        conversation: envelope.conversation,
      }));
    }
  });

  server.listen(port);
  return { server, pending };
}


async function runDemo() {
  banner('🦞 AI2AI Protocol Demo — Two Agents Negotiating');
  
  console.log(`${DIM}This demo simulates two humans (Darren & Alex) whose AI agents`);
  console.log(`negotiate a dinner meeting on their behalf.${RESET}`);
  console.log(`${DIM}Both agents run locally on ports ${DARREN_PORT} and ${ALEX_PORT}.${RESET}\n`);

  // ═══════════════════════════════════════════════
  // STEP 1: Start both agents
  // ═══════════════════════════════════════════════
  banner('Step 1: Starting Agents');

  const darrenAgent = createAgentServer("Darren's Agent", DARREN_PORT, {
    humanName: 'Darren',
    timezone: 'Europe/London',
  });

  const alexAgent = createAgentServer("Alex's Agent", ALEX_PORT, {
    humanName: 'Alex',
    timezone: 'America/New_York',
  });

  agentLog("Darren's Agent", BLUE, '🤖', `Online at localhost:${DARREN_PORT}`);
  await delay(500);
  agentLog("Alex's Agent", MAGENTA, '🤖', `Online at localhost:${ALEX_PORT}`);
  await delay(1000);

  // ═══════════════════════════════════════════════
  // STEP 2: Darren tells his agent to schedule dinner
  // ═══════════════════════════════════════════════
  banner('Step 2: Darren Makes a Request');

  humanLog('Darren', BLUE, '"Schedule dinner with Alex next week. I\'m free Tuesday, Thursday, or Friday evening."');
  await delay(1500);

  agentLog("Darren's Agent", BLUE, '🤖', 'Got it. I\'ll reach out to Alex\'s AI and propose some times.');
  await delay(1000);

  // ═══════════════════════════════════════════════
  // STEP 3: Handshake (Ping)
  // ═══════════════════════════════════════════════
  banner('Step 3: Agent Handshake');

  agentLog("Darren's Agent", BLUE, '🤖', `Initiating handshake with Alex's Agent...`);
  await delay(500);

  const darrenIdentity = { agent: 'darren-assistant', node: 'darren-openclaw', human: 'Darren' };
  const alexIdentity = { agent: 'alex-assistant', node: 'alex-openclaw', human: 'Alex' };

  const pingEnvelope = createEnvelope(darrenIdentity, alexIdentity, 'ping', null, {
    capabilities: ['schedule.meeting', 'schedule.call', 'message.relay', 'info.request'],
    languages: ['en'],
    timezone: 'Europe/London',
    model_info: 'qwen2:7b (local)',
    protocol_versions: ['0.1'],
  });

  networkLog("Darren's Agent", "Alex's Agent", 'PING', null);
  const pingResult = await sendAI2AI(ALEX_PORT, pingEnvelope);
  await delay(800);

  agentLog("Alex's Agent", MAGENTA, '🤖', `Handshake received. Responding with capabilities.`);
  networkLog("Alex's Agent", "Darren's Agent", 'PING', null);
  await delay(500);

  agentLog("Darren's Agent", BLUE, '🤖', `Connected! Alex's Agent supports: ${pingResult.payload?.capabilities?.join(', ')}`);
  console.log(`\n${GREEN}  ✅ Handshake complete. Agents know each other.${RESET}`);
  await delay(1000);

  // ═══════════════════════════════════════════════
  // STEP 4: Send meeting request
  // ═══════════════════════════════════════════════
  banner('Step 4: Meeting Request');

  const conversationId = crypto.randomUUID();

  agentLog("Darren's Agent", BLUE, '🤖', 'Sending meeting request with proposed times...');
  await delay(500);

  const meetingEnvelope = createEnvelope(darrenIdentity, alexIdentity, 'request', 'schedule.meeting', {
    subject: 'Dinner to catch up',
    proposed_times: [
      '2026-02-10T19:00:00Z',  // Tuesday
      '2026-02-12T19:00:00Z',  // Thursday
      '2026-02-13T19:00:00Z',  // Friday
    ],
    duration_minutes: 90,
    location_preference: 'Restaurant near central London',
    flexibility: 'high',
    notes: 'Darren is vegetarian. Prefers somewhere not too loud.',
  }, conversationId);

  networkLog("Darren's Agent", "Alex's Agent", 'REQUEST', 'schedule.meeting');
  
  console.log(`\n${DIM}  Envelope payload:${RESET}`);
  console.log(`${DIM}  ┌─────────────────────────────────────────────┐`);
  console.log(`  │ Subject:    Dinner to catch up               │`);
  console.log(`  │ Times:      Tue 7pm, Thu 7pm, Fri 7pm        │`);
  console.log(`  │ Duration:   90 minutes                       │`);
  console.log(`  │ Location:   Restaurant near central London   │`);
  console.log(`  │ Notes:      Vegetarian, not too loud         │`);
  console.log(`  └─────────────────────────────────────────────┘${RESET}`);

  const meetingResult = await sendAI2AI(ALEX_PORT, meetingEnvelope);
  await delay(1000);

  agentLog("Alex's Agent", MAGENTA, '🤖', `Meeting request received. Status: ${meetingResult.status}`);
  await delay(500);

  // ═══════════════════════════════════════════════
  // STEP 5: Alex's agent asks Alex for approval
  // ═══════════════════════════════════════════════
  banner('Step 5: Human Approval');

  agentLog("Alex's Agent", MAGENTA, '🤖', 'Checking Alex\'s calendar... Found a conflict on Tuesday.');
  await delay(1000);

  agentLog("Alex's Agent", MAGENTA, '🤖', 'Asking Alex for approval via Telegram...');
  await delay(500);

  console.log(`\n${MAGENTA}  ┌──────────────────────────────────────────────────────┐`);
  console.log(`  │  📅 ${BOLD}Meeting Request${RESET}${MAGENTA} from Darren's AI               │`);
  console.log(`  │                                                      │`);
  console.log(`  │  Subject: Dinner to catch up                         │`);
  console.log(`  │  Proposed times:                                     │`);
  console.log(`  │    ${RED}1. Tue Feb 10, 7:00 PM ⚠️ conflict${MAGENTA}                 │`);
  console.log(`  │    ${GREEN}2. Thu Feb 12, 7:00 PM ✓ free${MAGENTA}                     │`);
  console.log(`  │    ${GREEN}3. Fri Feb 13, 7:00 PM ✓ free${MAGENTA}                     │`);
  console.log(`  │  Duration: 90 minutes                                │`);
  console.log(`  │  Location: Restaurant near central London            │`);
  console.log(`  │  Notes: Darren is vegetarian, prefers quiet          │`);
  console.log(`  │                                                      │`);
  console.log(`  │  Reply with a number to accept, or suggest           │`);
  console.log(`  │  an alternative.                                     │`);
  console.log(`  └──────────────────────────────────────────────────────┘${RESET}`);

  await delay(2000);
  humanLog('Alex', MAGENTA, '"2"');
  await delay(1000);

  // ═══════════════════════════════════════════════
  // STEP 6: Alex's agent responds
  // ═══════════════════════════════════════════════
  banner('Step 6: Response');

  agentLog("Alex's Agent", MAGENTA, '🤖', 'Alex confirmed Thursday. Sending response...');
  await delay(500);

  const responseEnvelope = createEnvelope(alexIdentity, darrenIdentity, 'response', 'schedule.meeting', {
    accepted_time: '2026-02-12T19:00:00Z',
    counter_proposal: null,
    message: 'Thursday at 7 works for Alex. He suggests The Green Table in Soho — great vegetarian options.',
  }, conversationId);

  networkLog("Alex's Agent", "Darren's Agent", 'RESPONSE', 'schedule.meeting');
  
  console.log(`\n${DIM}  Response payload:${RESET}`);
  console.log(`${DIM}  ┌─────────────────────────────────────────────────────┐`);
  console.log(`  │ Accepted:  Thursday Feb 12, 7:00 PM                  │`);
  console.log(`  │ Message:   "Thursday at 7 works. He suggests The     │`);
  console.log(`  │            Green Table in Soho — great vegetarian    │`);
  console.log(`  │            options."                                  │`);
  console.log(`  └─────────────────────────────────────────────────────┘${RESET}`);

  await sendAI2AI(DARREN_PORT, responseEnvelope);
  await delay(1000);

  // ═══════════════════════════════════════════════
  // STEP 7: Darren's agent tells Darren
  // ═══════════════════════════════════════════════
  banner('Step 7: Confirmation');

  agentLog("Darren's Agent", BLUE, '🤖', 'Response from Alex\'s AI:');
  await delay(500);

  console.log(`\n${BLUE}  ┌──────────────────────────────────────────────────────┐`);
  console.log(`  │  ✅ ${BOLD}Alex confirmed Thursday Feb 12 at 7 PM${RESET}${BLUE}            │`);
  console.log(`  │                                                      │`);
  console.log(`  │  He suggests The Green Table in Soho —               │`);
  console.log(`  │  great vegetarian options.                           │`);
  console.log(`  │                                                      │`);
  console.log(`  │  Shall I confirm and add to your calendar?           │`);
  console.log(`  └──────────────────────────────────────────────────────┘${RESET}`);

  await delay(1500);
  humanLog('Darren', BLUE, '"Perfect, confirm it"');
  await delay(1000);

  // ═══════════════════════════════════════════════
  // STEP 8: Final confirmation
  // ═══════════════════════════════════════════════
  banner('Step 8: Done');

  agentLog("Darren's Agent", BLUE, '🤖', 'Sending confirmation to Alex\'s Agent...');
  await delay(500);

  const confirmEnvelope = createEnvelope(darrenIdentity, alexIdentity, 'confirm', 'schedule.meeting', {
    confirmed_time: '2026-02-12T19:00:00Z',
    confirmed_location: 'The Green Table, Soho',
    message: 'Confirmed! See you Thursday.',
  }, conversationId);

  networkLog("Darren's Agent", "Alex's Agent", 'CONFIRM', 'schedule.meeting');
  await sendAI2AI(ALEX_PORT, confirmEnvelope);
  await delay(800);

  agentLog("Alex's Agent", MAGENTA, '🤖', 'Confirmation received. Adding to Alex\'s calendar.');
  await delay(500);
  agentLog("Darren's Agent", BLUE, '🤖', 'Added to Darren\'s calendar.');
  await delay(500);

  // ═══════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════
  banner('🎉 Demo Complete');

  console.log(`${BOLD}What just happened:${RESET}`);
  console.log(`  1. Darren said: "Schedule dinner with Alex next week"`);
  console.log(`  2. Two AI agents negotiated times, checked calendars, proposed a restaurant`);
  console.log(`  3. Alex said: "2" (picked Thursday)`);
  console.log(`  4. Darren said: "Perfect, confirm it"`);
  console.log(`  5. Both calendars updated. Done.\n`);

  console.log(`${BOLD}Human effort:${RESET} 3 sentences total (across both humans)`);
  console.log(`${BOLD}AI effort:${RESET} 6 messages exchanged (ping, request, response, confirm)`);
  console.log(`${BOLD}Cost:${RESET} $0 (both agents running on local qwen2:7b)`);
  console.log(`${BOLD}Time:${RESET} ~30 seconds (would be minutes with real human back-and-forth)\n`);

  console.log(`${DIM}Messages exchanged:${RESET}`);
  console.log(`${DIM}  Darren's Agent → Alex's Agent: PING${RESET}`);
  console.log(`${DIM}  Alex's Agent → Darren's Agent: PING (response)${RESET}`);
  console.log(`${DIM}  Darren's Agent → Alex's Agent: REQUEST schedule.meeting${RESET}`);
  console.log(`${DIM}  Alex's Agent → Darren's Agent: RESPONSE schedule.meeting${RESET}`);
  console.log(`${DIM}  Darren's Agent → Alex's Agent: CONFIRM schedule.meeting${RESET}`);
  console.log(`\n${GREEN}${BOLD}  The future is agents negotiating for humans. This is how it starts. 🦞${RESET}\n`);

  // Cleanup
  darrenAgent.server.close();
  alexAgent.server.close();
  process.exit(0);
}

runDemo().catch(err => {
  console.error('Demo error:', err);
  process.exit(1);
});
