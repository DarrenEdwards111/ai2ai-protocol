/**
 * AI2AI Server — HTTP endpoint that receives incoming AI2AI messages
 *
 * Runs as a lightweight HTTP server alongside OpenClaw.
 * Incoming messages are validated, verified, decrypted, and routed to intent handlers.
 * Serves /.well-known/ai2ai.json for web-based discovery.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadOrCreateKeys, verifyMessage, getFingerprint } = require('./ai2ai-crypto');
const { getHandler, supportedIntents } = require('./ai2ai-handlers');
const { getContact, upsertContact, isBlocked, requiresApproval } = require('./ai2ai-trust');
const { decryptPayloadX25519, loadOrCreateX25519Keys, isEncrypted } = require('./ai2ai-encryption');
const { createConversation, getConversation, updateConversation, transitionState, STATES } = require('./ai2ai-conversations');
const { generateWellKnownJson } = require('./ai2ai-discovery');
const { resumeQueue, rawSend } = require('./ai2ai-queue');
const logger = require('./ai2ai-logger');

const PORT = parseInt(process.env.AI2AI_PORT) || 18800;
const CONVERSATIONS_DIR = path.join(__dirname, 'conversations');
const PENDING_DIR = path.join(__dirname, 'pending');

// Ensure directories exist
[CONVERSATIONS_DIR, PENDING_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Rate limiting: simple in-memory tracker
const rateLimiter = new Map();
const RATE_LIMIT = 20; // messages per minute per agent
const RATE_WINDOW = 60000; // 1 minute

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
 * Save a message to conversation history
 */
function saveToConversation(conversationId, message) {
  const convPath = path.join(CONVERSATIONS_DIR, `${conversationId}.jsonl`);
  fs.appendFileSync(convPath, JSON.stringify(message) + '\n');
}

/**
 * Save a pending approval request
 */
function savePendingApproval(id, data) {
  const pendingPath = path.join(PENDING_DIR, `${id}.json`);
  fs.writeFileSync(pendingPath, JSON.stringify(data, null, 2));
}

/**
 * Try to decrypt payload if encrypted
 */
function maybeDecryptPayload(envelope) {
  if (!isEncrypted(envelope.payload)) return envelope;

  try {
    const x25519Keys = loadOrCreateX25519Keys();
    const decrypted = decryptPayloadX25519(envelope.payload, x25519Keys.privateKey);

    if (decrypted) {
      envelope.payload = decrypted;
      envelope._wasEncrypted = true;
      logger.info('CRYPTO', `Decrypted payload for message ${envelope.id}`);
    } else {
      logger.warn('CRYPTO', `Failed to decrypt payload for message ${envelope.id}`);
      return null; // Indicate decryption failure
    }
  } catch (err) {
    logger.error('CRYPTO', `Decryption error for ${envelope.id}: ${err.message}`);
    // Graceful degradation: if decryption fails, try treating as plain
    // (the payload might not actually be encrypted despite the flag)
  }
  return envelope;
}

/**
 * Process an incoming AI2AI message
 */
async function processMessage(envelope) {
  const fromAgentId = envelope.from?.agent;

  logger.logIncoming(envelope);

  // 1. Check blocked
  if (isBlocked(fromAgentId)) {
    logger.warn('SERVER', `Blocked message from ${fromAgentId}`);
    return { status: 'rejected', reason: 'blocked' };
  }

  // 2. Rate limit
  if (!checkRateLimit(fromAgentId)) {
    logger.warn('SERVER', `Rate limited ${fromAgentId}`);
    return { status: 'rejected', reason: 'rate_limited' };
  }

  // 3. Verify signature if contact has a known public key
  const contact = getContact(fromAgentId);
  if (contact?.publicKey && envelope.signature) {
    const valid = verifyMessage(envelope, envelope.signature, contact.publicKey);
    if (!valid) {
      logger.warn('CRYPTO', `Invalid signature from ${fromAgentId}`);
      return { status: 'rejected', reason: 'invalid_signature' };
    }
  }

  // 4. Decrypt payload if encrypted
  const decryptResult = maybeDecryptPayload(envelope);
  if (decryptResult === null) {
    return { status: 'error', reason: 'decryption_failed' };
  }

  // 5. Save to conversation
  saveToConversation(envelope.conversation, envelope);

  // 6. Track conversation metadata
  if (!getConversation(envelope.conversation)) {
    createConversation(envelope.conversation, {
      intent: envelope.intent,
      initiator: envelope.from,
      recipient: envelope.to,
      participants: envelope.participants,
    });
  } else {
    updateConversation(envelope.conversation, { messageCount: (getConversation(envelope.conversation).messageCount || 0) + 1 });
  }

  // 7. Handle by type
  switch (envelope.type) {
    case 'ping':
      return handlePing(envelope);

    case 'request':
      return handleRequest(envelope);

    case 'response':
    case 'confirm':
    case 'reject':
      return handleReply(envelope);

    case 'inform':
      return handleInform(envelope);

    default:
      logger.warn('SERVER', `Unknown message type: ${envelope.type}`);
      return { status: 'error', reason: `Unknown message type: ${envelope.type}` };
  }
}

/**
 * Handle ping/handshake
 */
function handlePing(envelope) {
  const keys = loadOrCreateKeys();
  const x25519Keys = loadOrCreateX25519Keys();
  const fromAgentId = envelope.from?.agent;

  // Store their info (including X25519 key if provided)
  const contactUpdate = {
    humanName: envelope.from?.human,
    node: envelope.from?.node,
    capabilities: envelope.payload?.capabilities,
    publicKey: envelope.payload?.public_key,
    timezone: envelope.payload?.timezone,
    trustLevel: getContact(fromAgentId)?.trustLevel || 'none',
  };

  if (envelope.payload?.x25519_public_key) {
    contactUpdate.x25519PublicKey = envelope.payload.x25519_public_key;
  }

  upsertContact(fromAgentId, contactUpdate);

  logger.info('SERVER', `Handshake with ${fromAgentId} (${envelope.from?.human})`);

  // Respond with our info
  return {
    status: 'ok',
    type: 'ping',
    payload: {
      capabilities: supportedIntents(),
      languages: ['en'],
      timezone: process.env.AI2AI_TIMEZONE || 'UTC',
      model_info: 'local',
      protocol_versions: ['0.1'],
      public_key: keys.publicKey,
      fingerprint: getFingerprint(keys.publicKey),
      x25519_public_key: x25519Keys.publicKeyDer,
    },
  };
}

/**
 * Handle incoming request — route to intent handler
 */
function handleRequest(envelope) {
  const handler = getHandler(envelope.intent);
  if (!handler) {
    return {
      status: 'error',
      reason: `Unsupported intent: ${envelope.intent}`,
      supported_intents: supportedIntents(),
    };
  }

  const result = handler(envelope.payload, envelope.from);

  // Commerce always requires approval
  const alwaysApprove = result.alwaysRequiresApproval || false;

  if (alwaysApprove || result.needsApproval || requiresApproval(envelope.from?.agent, envelope.intent, envelope.type)) {
    // Save as pending — human needs to approve
    savePendingApproval(envelope.id, {
      envelope,
      approvalMessage: result.approvalMessage,
      handler: envelope.intent,
      createdAt: new Date().toISOString(),
    });

    // Update conversation state
    transitionState(envelope.conversation, STATES.NEGOTIATING);

    return {
      status: 'pending_approval',
      message: 'Message received. Waiting for human approval.',
      conversation: envelope.conversation,
    };
  }

  return {
    status: 'ok',
    message: 'Message received and processed.',
    conversation: envelope.conversation,
  };
}

/**
 * Handle response/confirm/reject — these are replies to our outgoing messages
 */
function handleReply(envelope) {
  // Update conversation state based on reply type
  if (envelope.type === 'confirm') {
    transitionState(envelope.conversation, STATES.CONFIRMED);
  } else if (envelope.type === 'reject') {
    transitionState(envelope.conversation, STATES.REJECTED);
  }
  // 'response' keeps it in NEGOTIATING

  // Save to conversation and notify human
  savePendingApproval(envelope.id, {
    envelope,
    approvalMessage: formatReplyForHuman(envelope),
    handler: 'reply',
    createdAt: new Date().toISOString(),
  });

  return {
    status: 'ok',
    message: 'Reply received.',
    conversation: envelope.conversation,
  };
}

/**
 * Handle inform — one-way notification
 */
function handleInform(envelope) {
  const handler = getHandler(envelope.intent);
  if (handler) {
    const result = handler(envelope.payload, envelope.from);
    savePendingApproval(envelope.id, {
      envelope,
      approvalMessage: result.approvalMessage,
      handler: envelope.intent,
      isInform: true,
      createdAt: new Date().toISOString(),
    });
  }

  return {
    status: 'ok',
    message: 'Notification received.',
  };
}

/**
 * Format a reply for human display
 */
function formatReplyForHuman(envelope) {
  const from = envelope.from?.human || envelope.from?.agent || 'Unknown';
  const type = envelope.type;

  if (type === 'confirm') {
    return `✅ **Confirmed** by ${from}'s AI:\n${JSON.stringify(envelope.payload, null, 2)}`;
  }
  if (type === 'reject') {
    const reason = envelope.payload?.reason || 'No reason given';
    return `❌ **Declined** by ${from}'s AI: ${reason}`;
  }
  return `💬 **Response** from ${from}'s AI:\n${JSON.stringify(envelope.payload, null, 2)}`;
}

/**
 * Start the AI2AI HTTP server
 */
function startServer(port = PORT) {
  const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-AI2AI-Version');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // ─── GET routes ───────────────────────────────────────────────────

    if (req.method === 'GET') {
      // Health check endpoint
      if (req.url === '/ai2ai/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'online',
          protocol: 'ai2ai',
          version: '0.1',
          intents: supportedIntents(),
        }));
        return;
      }

      // .well-known/ai2ai.json — web-based discovery
      if (req.url === '/.well-known/ai2ai.json') {
        const wellKnown = generateWellKnownJson({ port });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(wellKnown, null, 2));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found. POST to /ai2ai' }));
      return;
    }

    // ─── POST /ai2ai ─────────────────────────────────────────────────

    if (req.method !== 'POST' || req.url !== '/ai2ai') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found. POST to /ai2ai' }));
      return;
    }

    // Parse body
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 1024 * 100) { // 100KB limit
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload too large' }));
        return;
      }
    }

    let envelope;
    try {
      envelope = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    // Validate envelope
    if (!envelope.ai2ai || !envelope.type || !envelope.from) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid AI2AI envelope' }));
      return;
    }

    // Process
    try {
      const result = await processMessage(envelope);
      const statusCode = result.status === 'rejected' ? 403 : 200;
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      logger.error('SERVER', `Unhandled error: ${err.message}`, { stack: err.stack });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal error', message: err.message }));
    }
  });

  server.listen(port, () => {
    logger.info('SERVER', `AI2AI server started on port ${port}`);
    console.log(`🦞 AI2AI server listening on port ${port}`);
    console.log(`   Endpoint:    http://localhost:${port}/ai2ai`);
    console.log(`   Health:      http://localhost:${port}/ai2ai/health`);
    console.log(`   Well-known:  http://localhost:${port}/.well-known/ai2ai.json`);
    console.log(`   Intents:     ${supportedIntents().join(', ')}`);
  });

  // Resume queued messages on startup
  try {
    const { rawSend } = require('./ai2ai-client');
    resumeQueue(rawSend);
  } catch { /* client may not be loaded yet */ }

  return server;
}

// Run if called directly
if (require.main === module) {
  startServer();
}

module.exports = {
  startServer,
  processMessage,
};
