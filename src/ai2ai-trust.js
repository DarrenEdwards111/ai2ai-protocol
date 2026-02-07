/**
 * AI2AI Trust — Contact and trust level management
 * Manages known agents, trust levels, and human approval flow.
 */

const fs = require('fs');
const path = require('path');

const CONTACTS_PATH = path.join(__dirname, 'contacts.json');

const TRUST_LEVELS = {
  NONE: 'none',       // Unknown agent — human approves everything
  KNOWN: 'known',     // Previously interacted — human approves actions only
  TRUSTED: 'trusted', // Human approved auto-negotiation for routine tasks
};

// Actions that ALWAYS require human approval regardless of trust
const ALWAYS_APPROVE = [
  'commerce.request',
  'commerce.offer',
  'commerce.accept',
  'commerce.reject',
  'task.delegate',
];

/**
 * Load contacts from disk
 */
function loadContacts() {
  if (!fs.existsSync(CONTACTS_PATH)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(CONTACTS_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * Save contacts to disk
 */
function saveContacts(contacts) {
  fs.writeFileSync(CONTACTS_PATH, JSON.stringify(contacts, null, 2));
}

/**
 * Get or create a contact entry
 */
function getContact(agentId) {
  const contacts = loadContacts();
  return contacts[agentId] || null;
}

/**
 * Add or update a contact
 */
function upsertContact(agentId, info) {
  const contacts = loadContacts();
  contacts[agentId] = {
    ...contacts[agentId],
    ...info,
    lastSeen: new Date().toISOString(),
  };
  saveContacts(contacts);
  return contacts[agentId];
}

/**
 * Set trust level for a contact
 */
function setTrustLevel(agentId, level) {
  if (!Object.values(TRUST_LEVELS).includes(level)) {
    throw new Error(`Invalid trust level: ${level}`);
  }
  return upsertContact(agentId, { trustLevel: level });
}

/**
 * Check if an action requires human approval
 */
function requiresApproval(agentId, intent, type) {
  // Always approve certain intents
  if (ALWAYS_APPROVE.includes(intent)) return true;

  const contact = getContact(agentId);
  if (!contact) return true; // Unknown agent

  switch (contact.trustLevel) {
    case TRUST_LEVELS.TRUSTED:
      // Trusted agents: only approve high-risk actions
      return ALWAYS_APPROVE.includes(intent);

    case TRUST_LEVELS.KNOWN:
      // Known agents: approve actions, auto-approve info requests
      return type === 'request';

    case TRUST_LEVELS.NONE:
    default:
      // Unknown: approve everything
      return true;
  }
}

/**
 * Block an agent
 */
function blockAgent(agentId) {
  return upsertContact(agentId, { blocked: true });
}

/**
 * Check if an agent is blocked
 */
function isBlocked(agentId) {
  const contact = getContact(agentId);
  return contact?.blocked === true;
}

/**
 * List all contacts
 */
function listContacts() {
  return loadContacts();
}

module.exports = {
  TRUST_LEVELS,
  loadContacts,
  getContact,
  upsertContact,
  setTrustLevel,
  requiresApproval,
  blockAgent,
  isBlocked,
  listContacts,
};
