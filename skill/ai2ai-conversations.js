/**
 * AI2AI Conversation Management
 *
 * State machine: proposed → negotiating → confirmed | rejected | expired
 *
 * Features:
 * - Conversation expiry (configurable, default 7 days)
 * - Pending approval cleanup (24hr timeout → auto-reject)
 * - Multi-agent group conversations
 * - Conversation state tracking
 */

const fs = require('fs');
const path = require('path');
const logger = require('./ai2ai-logger');

const CONVERSATIONS_DIR = path.join(__dirname, 'conversations');
const PENDING_DIR = path.join(__dirname, 'pending');

// Ensure directories
[CONVERSATIONS_DIR, PENDING_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// Conversation states
const STATES = {
  PROPOSED:    'proposed',    // Initial request sent/received
  NEGOTIATING: 'negotiating', // Back-and-forth in progress
  CONFIRMED:   'confirmed',   // Both parties agreed
  REJECTED:    'rejected',    // One party declined
  EXPIRED:     'expired',     // Timed out without resolution
};

// Valid state transitions
const TRANSITIONS = {
  proposed:    ['negotiating', 'confirmed', 'rejected', 'expired'],
  negotiating: ['confirmed', 'rejected', 'expired'],
  confirmed:   [],
  rejected:    [],
  expired:     [],
};

// Default config
const DEFAULT_CONFIG = {
  conversationExpiryDays: 7,
  approvalTimeoutHours: 24,
};

/**
 * Conversation metadata file path
 */
function metaPath(conversationId) {
  return path.join(CONVERSATIONS_DIR, `${conversationId}.meta.json`);
}

/**
 * Get or create conversation metadata
 */
function getConversation(conversationId) {
  const mp = metaPath(conversationId);
  if (fs.existsSync(mp)) {
    try {
      return JSON.parse(fs.readFileSync(mp, 'utf-8'));
    } catch { /* fall through */ }
  }
  return null;
}

/**
 * Create a new conversation
 */
function createConversation(conversationId, { intent, initiator, recipient, participants }) {
  const meta = {
    id: conversationId,
    state: STATES.PROPOSED,
    intent,
    initiator, // { agent, human }
    recipient, // { agent, human } — for 1:1
    participants: participants || [initiator, recipient].filter(Boolean), // for group
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + DEFAULT_CONFIG.conversationExpiryDays * 86400000).toISOString(),
    messageCount: 0,
  };

  fs.writeFileSync(metaPath(conversationId), JSON.stringify(meta, null, 2));
  logger.info('CONV', `Created conversation ${conversationId}`, {
    intent, state: 'proposed', participants: meta.participants,
  });
  return meta;
}

/**
 * Update conversation state with validation
 */
function transitionState(conversationId, newState) {
  const meta = getConversation(conversationId);
  if (!meta) {
    logger.warn('CONV', `Cannot transition unknown conversation ${conversationId}`);
    return null;
  }

  const allowed = TRANSITIONS[meta.state];
  if (!allowed || !allowed.includes(newState)) {
    logger.warn('CONV', `Invalid transition: ${meta.state} → ${newState} for ${conversationId}`);
    return null;
  }

  const oldState = meta.state;
  meta.state = newState;
  meta.updatedAt = new Date().toISOString();

  fs.writeFileSync(metaPath(conversationId), JSON.stringify(meta, null, 2));
  logger.info('CONV', `Conversation ${conversationId}: ${oldState} → ${newState}`);
  return meta;
}

/**
 * Update conversation metadata (increment message count, etc.)
 */
function updateConversation(conversationId, updates) {
  const meta = getConversation(conversationId);
  if (!meta) return null;

  Object.assign(meta, updates, { updatedAt: new Date().toISOString() });
  fs.writeFileSync(metaPath(conversationId), JSON.stringify(meta, null, 2));
  return meta;
}

/**
 * Add a participant to a group conversation
 */
function addParticipant(conversationId, participant) {
  const meta = getConversation(conversationId);
  if (!meta) return null;

  if (!meta.participants) meta.participants = [];

  const exists = meta.participants.find(p => p.agent === participant.agent);
  if (!exists) {
    meta.participants.push(participant);
    meta.updatedAt = new Date().toISOString();
    fs.writeFileSync(metaPath(conversationId), JSON.stringify(meta, null, 2));
    logger.info('CONV', `Added participant ${participant.agent} to ${conversationId}`);
  }
  return meta;
}

/**
 * List all conversations, optionally filtered by state
 */
function listConversations(stateFilter = null) {
  if (!fs.existsSync(CONVERSATIONS_DIR)) return [];

  return fs.readdirSync(CONVERSATIONS_DIR)
    .filter(f => f.endsWith('.meta.json'))
    .map(f => {
      try {
        return JSON.parse(fs.readFileSync(path.join(CONVERSATIONS_DIR, f), 'utf-8'));
      } catch { return null; }
    })
    .filter(Boolean)
    .filter(c => !stateFilter || c.state === stateFilter);
}

/**
 * Expire old conversations
 * Returns number of conversations expired
 */
function expireConversations() {
  const now = new Date();
  let expired = 0;

  for (const conv of listConversations()) {
    if (conv.state === STATES.CONFIRMED || conv.state === STATES.REJECTED || conv.state === STATES.EXPIRED) {
      continue; // Terminal states
    }

    const expiresAt = conv.expiresAt ? new Date(conv.expiresAt) : null;
    if (expiresAt && now > expiresAt) {
      transitionState(conv.id, STATES.EXPIRED);
      expired++;
    }
  }

  if (expired > 0) {
    logger.info('CONV', `Expired ${expired} conversations`);
  }
  return expired;
}

// ─── Pending Approval Management ────────────────────────────────────────────

/**
 * Get a pending approval
 */
function getPendingApproval(approvalId) {
  const pendingPath = path.join(PENDING_DIR, `${approvalId}.json`);
  if (!fs.existsSync(pendingPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(pendingPath, 'utf-8'));
  } catch { return null; }
}

/**
 * List all pending approvals
 */
function listPendingApprovals() {
  if (!fs.existsSync(PENDING_DIR)) return [];

  return fs.readdirSync(PENDING_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(PENDING_DIR, f), 'utf-8'));
        data._filename = f;
        return data;
      } catch { return null; }
    })
    .filter(Boolean);
}

/**
 * Resolve a pending approval (approve or reject)
 */
function resolvePendingApproval(approvalId, approved, humanReply = null) {
  const pendingPath = path.join(PENDING_DIR, `${approvalId}.json`);
  if (!fs.existsSync(pendingPath)) return null;

  const pending = JSON.parse(fs.readFileSync(pendingPath, 'utf-8'));
  pending.resolved = true;
  pending.approved = approved;
  pending.humanReply = humanReply;
  pending.resolvedAt = new Date().toISOString();

  // Move to resolved (overwrite in place, or move to archive)
  fs.writeFileSync(pendingPath, JSON.stringify(pending, null, 2));

  logger.info('APPROVAL', `Approval ${approvalId}: ${approved ? 'APPROVED' : 'REJECTED'}`, {
    humanReply: humanReply?.substring(0, 100),
  });

  return pending;
}

/**
 * Remove a resolved pending approval
 */
function removePendingApproval(approvalId) {
  const pendingPath = path.join(PENDING_DIR, `${approvalId}.json`);
  if (fs.existsSync(pendingPath)) {
    fs.unlinkSync(pendingPath);
  }
}

/**
 * Clean up old pending approvals (auto-reject after timeout)
 * @param {number} timeoutHours - Hours before auto-reject (default 24)
 * @returns {{ expired: number, rejected: object[] }}
 */
function cleanupPendingApprovals(timeoutHours = DEFAULT_CONFIG.approvalTimeoutHours) {
  const cutoff = Date.now() - timeoutHours * 3600000;
  const results = { expired: 0, rejected: [] };

  for (const pending of listPendingApprovals()) {
    if (pending.resolved) {
      // Clean up old resolved approvals (>7 days)
      const resolvedAt = new Date(pending.resolvedAt || pending.createdAt).getTime();
      if (resolvedAt < Date.now() - 7 * 86400000) {
        removePendingApproval(pending.envelope?.id || pending._filename?.replace('.json', ''));
      }
      continue;
    }

    const createdAt = new Date(pending.createdAt).getTime();
    if (createdAt < cutoff) {
      // Auto-reject expired approval
      const id = pending.envelope?.id || pending._filename?.replace('.json', '');
      resolvePendingApproval(id, false, 'Auto-rejected: approval timed out');
      results.expired++;
      results.rejected.push(pending);

      logger.warn('APPROVAL', `Auto-rejected stale approval ${id} (created ${pending.createdAt})`);
    }
  }

  if (results.expired > 0) {
    logger.info('APPROVAL', `Auto-rejected ${results.expired} stale approvals`);
  }
  return results;
}

/**
 * Run all maintenance tasks
 */
function runMaintenance() {
  const conversationsExpired = expireConversations();
  const approvalResult = cleanupPendingApprovals();

  return {
    conversationsExpired,
    approvalsExpired: approvalResult.expired,
  };
}

module.exports = {
  STATES,
  TRANSITIONS,
  getConversation,
  createConversation,
  transitionState,
  updateConversation,
  addParticipant,
  listConversations,
  expireConversations,
  getPendingApproval,
  listPendingApprovals,
  resolvePendingApproval,
  removePendingApproval,
  cleanupPendingApprovals,
  runMaintenance,
  CONVERSATIONS_DIR,
  PENDING_DIR,
};
