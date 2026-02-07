/**
 * AI2AI Config — Configuration and path management
 * All config stored in ~/.ai2ai/
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const AI2AI_DIR = path.join(os.homedir(), '.ai2ai');
const CONFIG_PATH = path.join(AI2AI_DIR, 'config.json');
const CONTACTS_PATH = path.join(AI2AI_DIR, 'contacts.json');
const KEYS_DIR = path.join(AI2AI_DIR, 'keys');
const PENDING_DIR = path.join(AI2AI_DIR, 'pending');
const CONVERSATIONS_DIR = path.join(AI2AI_DIR, 'conversations');
const LOGS_DIR = path.join(AI2AI_DIR, 'logs');

/**
 * Ensure all required directories exist
 */
function ensureDirs() {
  for (const dir of [AI2AI_DIR, KEYS_DIR, PENDING_DIR, CONVERSATIONS_DIR, LOGS_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * Load config from disk
 */
function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Save config to disk
 */
function saveConfig(config) {
  ensureDirs();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

/**
 * Load config or exit with a helpful message
 */
function requireConfig() {
  const config = loadConfig();
  if (!config) {
    console.error('\n❌ No AI2AI configuration found.');
    console.error('   Run `ai2ai init` to set up your agent.\n');
    process.exit(1);
  }
  return config;
}

/**
 * Load contacts from disk
 */
function loadContacts() {
  if (!fs.existsSync(CONTACTS_PATH)) return {};
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
  ensureDirs();
  fs.writeFileSync(CONTACTS_PATH, JSON.stringify(contacts, null, 2));
}

/**
 * Find a contact by name or agent ID (fuzzy match)
 */
function findContact(query) {
  const contacts = loadContacts();
  const q = query.toLowerCase();

  // Exact match on agent ID
  if (contacts[q]) return { id: q, ...contacts[q] };

  // Search by human name or agent ID prefix
  for (const [id, contact] of Object.entries(contacts)) {
    if (id.toLowerCase().includes(q)) return { id, ...contact };
    if (contact.humanName && contact.humanName.toLowerCase().includes(q)) {
      return { id, ...contact };
    }
  }

  return null;
}

module.exports = {
  AI2AI_DIR,
  CONFIG_PATH,
  CONTACTS_PATH,
  KEYS_DIR,
  PENDING_DIR,
  CONVERSATIONS_DIR,
  LOGS_DIR,
  ensureDirs,
  loadConfig,
  saveConfig,
  requireConfig,
  loadContacts,
  saveContacts,
  findContact,
};
