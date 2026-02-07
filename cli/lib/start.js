/**
 * ai2ai start — Start the AI2AI HTTP server
 * Runs the protocol server on the configured port.
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { requireConfig, loadContacts, saveContacts, PENDING_DIR, CONVERSATIONS_DIR } = require('./config');
const { loadOrCreateKeys, getFingerprint, signMessage, verifyMessage } = require('./crypto');

// Rate limiting
const rateLimiter = new Map();
const RATE_LIMIT = 20;
const RATE_WINDOW = 60000;

function checkRateLimit(agentId) {
  const now = Date.now();
  const window = rateLimiter.get(agentId) || [];
  const recent = window.filter(t => now - t < RATE_WINDOW);
  if (recent.length >= RATE_LIMIT) return false;
  recent.push(now);
  rateLimiter.set(agentId, recent);
  return true;
}

/**
 * Save a pending message for human review
 */
function savePending(id, data) {
  const pendingPath = path.join(PENDING_DIR, `${id}.json`);
  fs.writeFileSync(pendingPath, JSON.stringify(data, null, 2));
}

/**
 * Save to conversation history
 */
function saveToConversation(conversationId, message) {
  const convPath = path.join(CONVERSATIONS_DIR, `${conversationId}.jsonl`);
  fs.appendFileSync(convPath, JSON.stringify(message) + '\n');
}

/**
 * Format incoming message for human display
 */
function formatForHuman(envelope) {
  const from = envelope.from?.human || envelope.from?.agent || 'Unknown';
  const intent = envelope.intent || envelope.type;

  if (envelope.intent === 'schedule.meeting') {
    const p = envelope.payload;
    const times = (p.proposed_times || [])
      .map((t, i) => `    ${i + 1}. ${new Date(t).toLocaleString()}`)
      .join('\n');
    return [
      `📅 Meeting Request from ${from}`,
      `   Subject: ${p.subject || 'No subject'}`,
      `   Times:\n${times}`,
      `   Duration: ${p.duration_minutes || 60} min`,
      p.location_preference ? `   Location: ${p.location_preference}` : '',
      p.notes ? `   Notes: ${p.notes}` : '',
    ].filter(Boolean).join('\n');
  }

  if (envelope.intent === 'message.relay') {
    const p = envelope.payload;
    const emoji = p.urgency === 'high' ? '🔴' : p.urgency === 'medium' ? '🟡' : '💬';
    return [
      `${emoji} Message from ${from}:`,
      `   "${p.message}"`,
      p.reply_requested ? '   (Reply requested)' : '',
    ].filter(Boolean).join('\n');
  }

  if (envelope.intent === 'info.request') {
    return [
      `❓ Question from ${from}:`,
      `   "${envelope.payload.question}"`,
      envelope.payload.context ? `   Context: ${envelope.payload.context}` : '',
    ].filter(Boolean).join('\n');
  }

  if (envelope.type === 'response') {
    return `💬 Response from ${from}:\n   ${JSON.stringify(envelope.payload, null, 2)}`;
  }

  if (envelope.type === 'confirm') {
    return `✅ Confirmed by ${from}: ${JSON.stringify(envelope.payload)}`;
  }

  if (envelope.type === 'reject') {
    return `❌ Declined by ${from}: ${envelope.payload?.reason || 'No reason given'}`;
  }

  return `📨 ${intent || 'Message'} from ${from}:\n   ${JSON.stringify(envelope.payload, null, 2)}`;
}

/**
 * Handle a ping (handshake)
 */
function handlePing(envelope, config) {
  const keys = loadOrCreateKeys();
  const fromAgent = envelope.from?.agent;

  // Store their info as a contact
  if (fromAgent && fromAgent !== 'unknown') {
    const contacts = loadContacts();
    contacts[fromAgent] = {
      ...contacts[fromAgent],
      humanName: envelope.from?.human,
      publicKey: envelope.payload?.public_key,
      capabilities: envelope.payload?.capabilities,
      timezone: envelope.payload?.timezone,
      trustLevel: contacts[fromAgent]?.trustLevel || 'none',
      lastSeen: new Date().toISOString(),
    };
    saveContacts(contacts);
  }

  return {
    status: 'ok',
    type: 'ping',
    payload: {
      capabilities: [
        'schedule.meeting', 'schedule.call', 'message.relay',
        'info.request', 'info.share', 'social.introduction',
      ],
      languages: ['en'],
      timezone: config.timezone || 'UTC',
      model_info: 'local',
      protocol_versions: ['0.1'],
      public_key: keys.publicKey,
      fingerprint: getFingerprint(keys.publicKey),
    },
  };
}

/**
 * Process an incoming message
 */
function processMessage(envelope, config) {
  const fromAgent = envelope.from?.agent;

  // Check rate limit
  if (!checkRateLimit(fromAgent)) {
    return { status: 'rejected', reason: 'rate_limited' };
  }

  // Verify signature if we have their public key
  const contacts = loadContacts();
  const contact = contacts[fromAgent];
  if (contact?.publicKey && envelope.signature) {
    const valid = verifyMessage(envelope, envelope.signature, contact.publicKey);
    if (!valid) {
      console.log(`  ⚠️  Invalid signature from ${fromAgent}`);
      return { status: 'rejected', reason: 'invalid_signature' };
    }
    console.log(`  ✅ Signature verified for ${fromAgent}`);
  }

  // Save to conversation
  saveToConversation(envelope.conversation, envelope);

  // Handle by type
  if (envelope.type === 'ping') {
    return handlePing(envelope, config);
  }

  // Everything else goes to pending for human review
  const humanMessage = formatForHuman(envelope);
  savePending(envelope.id, {
    envelope,
    approvalMessage: humanMessage,
    handler: envelope.intent || envelope.type,
    createdAt: new Date().toISOString(),
  });

  console.log(`\n  📥 New message from ${fromAgent}:`);
  console.log(`     ${humanMessage.split('\n')[0]}`);
  console.log('     Run `ai2ai pending` to review.\n');

  return {
    status: 'pending_approval',
    message: 'Message received. Waiting for human approval.',
    conversation: envelope.conversation,
  };
}

async function run() {
  const config = requireConfig();
  const keys = loadOrCreateKeys();
  const fingerprint = getFingerprint(keys.publicKey);

  const server = http.createServer((req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-AI2AI-Version');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // GET /ai2ai/health
    if (req.method === 'GET' && req.url === '/ai2ai/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'online',
        protocol: 'ai2ai',
        version: '0.1',
        agent: config.agentName,
      }));
      return;
    }

    // GET /.well-known/ai2ai.json
    if (req.method === 'GET' && req.url === '/.well-known/ai2ai.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ai2ai: '0.1',
        agent: config.agentName,
        human: config.humanName,
        endpoint: `http://localhost:${config.port}/ai2ai`,
        public_key: keys.publicKey,
        fingerprint,
        capabilities: [
          'schedule.meeting', 'schedule.call', 'message.relay',
          'info.request', 'info.share', 'social.introduction',
        ],
      }, null, 2));
      return;
    }

    // POST /ai2ai
    if (req.method === 'POST' && req.url === '/ai2ai') {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 102400) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Payload too large' }));
          req.destroy();
        }
      });

      req.on('end', () => {
        let envelope;
        try {
          envelope = JSON.parse(body);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
          return;
        }

        if (!envelope.ai2ai || !envelope.type || !envelope.from) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid AI2AI envelope' }));
          return;
        }

        try {
          const result = processMessage(envelope, config);
          const statusCode = result.status === 'rejected' ? 403 : 200;
          res.writeHead(statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          console.error(`  ❌ Error processing message: ${err.message}`);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal error' }));
        }
      });
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found. POST to /ai2ai' }));
  });

  server.listen(config.port, () => {
    const contacts = loadContacts();
    const contactCount = Object.keys(contacts).length;

    console.log(`
╔══════════════════════════════════════════╗
║        🦞 AI2AI Server Running          ║
╚══════════════════════════════════════════╝

  🤖 Agent:        ${config.agentName}
  👤 Human:        ${config.humanName}
  🌐 Endpoint:     http://localhost:${config.port}/ai2ai
  🏥 Health:       http://localhost:${config.port}/ai2ai/health
  🔑 Fingerprint:  ${fingerprint}
  👥 Contacts:     ${contactCount}

  Waiting for incoming messages...
  Press Ctrl+C to stop.
`);
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\n  👋 Shutting down AI2AI server...\n');
    server.close(() => process.exit(0));
  });

  process.on('SIGTERM', () => {
    server.close(() => process.exit(0));
  });
}

module.exports = { run };
