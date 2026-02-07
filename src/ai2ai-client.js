/**
 * AI2AI Client — Send outgoing messages to other agents
 * Supports encryption, queuing, multi-recipient, and logging.
 */

const crypto = require('crypto');
const { loadOrCreateKeys, signMessage } = require('./ai2ai-crypto');
const { upsertContact, isBlocked, getContact } = require('./ai2ai-trust');
const { encryptPayloadX25519, loadOrCreateX25519Keys, isEncrypted } = require('./ai2ai-encryption');
const { queueAndSend } = require('./ai2ai-queue');
const { createConversation, transitionState, STATES } = require('./ai2ai-conversations');
const logger = require('./ai2ai-logger');

// Default config (override via environment or config file)
const CONFIG = {
  agentName: process.env.AI2AI_AGENT_NAME || 'my-assistant',
  humanName: process.env.AI2AI_HUMAN_NAME || 'Human',
  timezone: process.env.AI2AI_TIMEZONE || 'UTC',
  enableEncryption: process.env.AI2AI_ENCRYPTION !== 'false', // default on
  enableQueue: process.env.AI2AI_QUEUE !== 'false', // default on
};

/**
 * Create a new AI2AI message envelope
 * Supports multiple recipients via `to` array.
 */
function createEnvelope({ to, type, intent, payload, conversationId, requiresHumanApproval, participants }) {
  const keys = loadOrCreateKeys();

  // Normalize `to` — support single object or array
  const toField = Array.isArray(to) ? to : to;

  const envelope = {
    ai2ai: '0.1',
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    from: {
      agent: CONFIG.agentName,
      node: `${CONFIG.agentName}-node`,
      human: CONFIG.humanName,
    },
    to: toField,
    conversation: conversationId || crypto.randomUUID(),
    type,
    intent: intent || null,
    payload: payload || {},
    requires_human_approval: requiresHumanApproval !== false,
  };

  // Add participants for group conversations
  if (participants) {
    envelope.participants = participants;
  }

  // Sign the message
  envelope.signature = signMessage(envelope, keys.privateKey);

  return envelope;
}

/**
 * Optionally encrypt the payload field of an envelope
 * Returns the envelope (mutated with encrypted payload, or unchanged)
 */
function maybeEncryptEnvelope(envelope) {
  if (!CONFIG.enableEncryption) return envelope;

  // Get recipient's X25519 public key from contacts
  const recipientAgent = Array.isArray(envelope.to) ? envelope.to[0]?.agent : envelope.to?.agent;
  if (!recipientAgent) return envelope;

  const contact = getContact(recipientAgent);
  if (!contact?.x25519PublicKey) return envelope; // No encryption key → send signed-only

  const encrypted = encryptPayloadX25519(envelope.payload, contact.x25519PublicKey);
  if (encrypted) {
    envelope.payload = encrypted;
    envelope._payloadEncrypted = true;
  }

  return envelope;
}

/**
 * Raw send function (used by queue system too)
 */
async function rawSend(endpoint, envelope) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-AI2AI-Version': '0.1',
    },
    body: JSON.stringify(envelope),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Send a message to another agent's endpoint
 * With optional queuing for offline agents.
 */
async function sendMessage(endpoint, envelope, options = {}) {
  const recipientAgent = Array.isArray(envelope.to) ? envelope.to[0]?.agent : envelope.to?.agent;

  // Check if agent is blocked
  if (recipientAgent && isBlocked(recipientAgent)) {
    throw new Error(`Agent ${recipientAgent} is blocked`);
  }

  // Optionally encrypt
  maybeEncryptEnvelope(envelope);

  // Log outgoing
  logger.logOutgoing(envelope);

  try {
    const data = await rawSend(endpoint, envelope);

    // Update contact with last interaction
    if (recipientAgent) {
      upsertContact(recipientAgent, {
        endpoint,
        humanName: Array.isArray(envelope.to) ? envelope.to[0]?.human : envelope.to?.human,
        lastInteraction: new Date().toISOString(),
      });
    }

    return data;
  } catch (err) {
    // If queue is enabled, queue the message for retry
    if (CONFIG.enableQueue && options.queue !== false) {
      logger.warn('CLIENT', `Direct send failed, queuing: ${err.message}`, { endpoint });

      const result = await queueAndSend(endpoint, envelope, rawSend, {
        onFailure: options.onDeliveryFailure || ((entry) => {
          logger.error('CLIENT', `All retries failed for message to ${recipientAgent}`, {
            queueId: entry.id,
          });
        }),
      });

      return { status: 'queued', queueId: result.queueId, message: 'Agent offline, message queued for retry' };
    }

    throw new Error(`Failed to reach ${endpoint}: ${err.message}`);
  }
}

/**
 * Send to multiple recipients (group conversations)
 */
async function sendToMultiple(endpoints, envelope, options = {}) {
  const results = {};
  for (const { agent, endpoint } of endpoints) {
    try {
      // Create per-recipient envelope (same conversation, different `to`)
      const recipientEnvelope = { ...envelope, to: { agent, human: agent, node: 'unknown' } };
      recipientEnvelope.signature = signMessage(recipientEnvelope, loadOrCreateKeys().privateKey);
      results[agent] = await sendMessage(endpoint, recipientEnvelope, options);
    } catch (err) {
      results[agent] = { status: 'error', error: err.message };
    }
  }
  return results;
}

/**
 * Send a ping/handshake to discover another agent
 */
async function ping(endpoint) {
  const keys = loadOrCreateKeys();
  const { getFingerprint } = require('./ai2ai-crypto');
  const { supportedIntents } = require('./ai2ai-handlers');
  const x25519Keys = loadOrCreateX25519Keys();

  const envelope = createEnvelope({
    to: { agent: 'unknown', node: 'unknown', human: 'unknown' },
    type: 'ping',
    payload: {
      capabilities: supportedIntents(),
      languages: ['en'],
      timezone: CONFIG.timezone,
      availability_hours: '09:00-22:00',
      model_info: 'local',
      protocol_versions: ['0.1'],
      public_key: keys.publicKey,
      fingerprint: getFingerprint(keys.publicKey),
      x25519_public_key: x25519Keys.publicKeyDer,
    },
  });

  return sendMessage(endpoint, envelope, { queue: false }); // Don't queue pings
}

/**
 * Request a meeting with another agent
 */
async function requestMeeting(endpoint, { subject, proposedTimes, durationMinutes, location, notes, flexibility, to }) {
  const conversationId = crypto.randomUUID();

  const envelope = createEnvelope({
    to: to || { agent: 'unknown' },
    type: 'request',
    intent: 'schedule.meeting',
    conversationId,
    payload: {
      subject,
      proposed_times: proposedTimes,
      duration_minutes: durationMinutes || 60,
      location_preference: location || null,
      notes: notes || null,
      flexibility: flexibility || 'medium',
    },
  });

  // Track conversation
  createConversation(conversationId, {
    intent: 'schedule.meeting',
    initiator: envelope.from,
    recipient: envelope.to,
  });

  return sendMessage(endpoint, envelope);
}

/**
 * Relay a message to another agent's human
 */
async function relayMessage(endpoint, { message, urgency, replyRequested, to }) {
  const envelope = createEnvelope({
    to: to || { agent: 'unknown' },
    type: 'request',
    intent: 'message.relay',
    payload: {
      message,
      urgency: urgency || 'low',
      reply_requested: replyRequested !== false,
    },
  });

  return sendMessage(endpoint, envelope);
}

/**
 * Request information from another agent
 */
async function requestInfo(endpoint, { question, context, to }) {
  const envelope = createEnvelope({
    to: to || { agent: 'unknown' },
    type: 'request',
    intent: 'info.request',
    payload: {
      question,
      context: context || null,
    },
  });

  return sendMessage(endpoint, envelope);
}

/**
 * Request a commerce quote
 */
async function requestQuote(endpoint, { item, description, quantity, budget, currency, notes, to }) {
  const conversationId = crypto.randomUUID();

  const envelope = createEnvelope({
    to: to || { agent: 'unknown' },
    type: 'request',
    intent: 'commerce.request',
    conversationId,
    requiresHumanApproval: true,
    payload: {
      item,
      description: description || null,
      quantity: quantity || null,
      budget: budget || null,
      currency: currency || 'USD',
      notes: notes || null,
    },
  });

  createConversation(conversationId, {
    intent: 'commerce.request',
    initiator: envelope.from,
    recipient: envelope.to,
  });

  return sendMessage(endpoint, envelope);
}

/**
 * Initiate a group scheduling conversation
 */
async function requestGroupMeeting(endpoints, { subject, proposedTimes, durationMinutes, location, notes, participants }) {
  const conversationId = crypto.randomUUID();

  const participantList = participants || endpoints.map(e => ({
    agent: e.agent,
    human: e.human || e.agent,
  }));

  // Add self
  participantList.unshift({ agent: CONFIG.agentName, human: CONFIG.humanName });

  const envelope = createEnvelope({
    to: participantList.slice(1), // All recipients
    type: 'request',
    intent: 'schedule.group',
    conversationId,
    participants: participantList,
    payload: {
      subject,
      proposed_times: proposedTimes,
      duration_minutes: durationMinutes || 60,
      location_preference: location || null,
      notes: notes || null,
      participants: participantList,
    },
  });

  createConversation(conversationId, {
    intent: 'schedule.group',
    initiator: envelope.from,
    participants: participantList,
  });

  return sendToMultiple(endpoints, envelope);
}

module.exports = {
  CONFIG,
  createEnvelope,
  sendMessage,
  sendToMultiple,
  rawSend,
  maybeEncryptEnvelope,
  ping,
  requestMeeting,
  relayMessage,
  requestInfo,
  requestQuote,
  requestGroupMeeting,
};
