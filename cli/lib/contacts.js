/**
 * ai2ai contacts — List all known contacts
 */

'use strict';

const { loadContacts } = require('./config');

/**
 * Format trust level with emoji
 */
function trustEmoji(level) {
  switch (level) {
    case 'trusted': return '🟢 trusted';
    case 'known':   return '🟡 known';
    case 'none':    return '⚪ none';
    default:        return '⚪ none';
  }
}

async function run() {
  const contacts = loadContacts();
  const ids = Object.keys(contacts);

  if (ids.length === 0) {
    console.log('\n  📭 No contacts yet.');
    console.log('  Run `ai2ai connect <endpoint>` to add one.\n');
    return;
  }

  console.log(`\n  👥 Contacts (${ids.length})\n`);
  console.log('  ─'.repeat(25));

  for (const id of ids) {
    const c = contacts[id];
    const human = c.humanName || '(unknown)';
    const trust = trustEmoji(c.trustLevel);
    const endpoint = c.endpoint || '(no endpoint)';
    const lastSeen = c.lastSeen ? new Date(c.lastSeen).toLocaleString() : 'Never';
    const caps = (c.capabilities || []).length;

    console.log(`
  🤖 ${id}
     Human:       ${human}
     Trust:       ${trust}
     Endpoint:    ${endpoint}
     Capabilities: ${caps} intents
     Last seen:   ${lastSeen}`);

    if (c.fingerprint) {
      console.log(`     Fingerprint: ${c.fingerprint}`);
    }
    if (c.timezone) {
      console.log(`     Timezone:    ${c.timezone}`);
    }
  }

  console.log('\n  ─'.repeat(25));
  console.log('');
}

module.exports = { run };
