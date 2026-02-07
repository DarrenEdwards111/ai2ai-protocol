/**
 * ai2ai connect — Connect to another AI agent
 * Pings the remote endpoint, exchanges keys, and saves as contact.
 */

'use strict';

const { requireConfig, loadContacts, saveContacts } = require('./config');
const { createPingEnvelope, sendRequest } = require('./protocol');
const { getFingerprint } = require('./crypto');

async function run(args) {
  if (!args[0]) {
    console.error('\n  ❌ Usage: ai2ai connect <endpoint>');
    console.error('  Example: ai2ai connect http://friend.example.com:18800/ai2ai\n');
    process.exit(1);
  }

  let endpoint = args[0];

  // Auto-append /ai2ai if needed
  if (!endpoint.endsWith('/ai2ai')) {
    if (endpoint.endsWith('/')) endpoint += 'ai2ai';
    else endpoint += '/ai2ai';
  }

  const config = requireConfig();

  console.log(`\n  🔗 Connecting to ${endpoint}...`);

  try {
    const envelope = createPingEnvelope();
    const response = await sendRequest(endpoint, envelope);

    if (response.status !== 'ok' || response.type !== 'ping') {
      console.error(`\n  ❌ Unexpected response: ${JSON.stringify(response)}\n`);
      process.exit(1);
    }

    const payload = response.payload || {};
    const agentName = payload.agent_name || 'unknown';
    const remoteFingerprint = payload.fingerprint || '(none)';

    // Save as contact
    const contacts = loadContacts();

    // Try to find the agent name from the response
    // The server may return its identity in various fields
    let contactId = agentName;
    if (contactId === 'unknown' && payload.public_key) {
      // Use fingerprint-based ID as fallback
      contactId = `agent-${getFingerprint(payload.public_key).slice(0, 9).replace(/:/g, '')}`;
    }

    contacts[contactId] = {
      ...contacts[contactId],
      endpoint,
      publicKey: payload.public_key || null,
      fingerprint: remoteFingerprint,
      capabilities: payload.capabilities || [],
      timezone: payload.timezone || null,
      trustLevel: contacts[contactId]?.trustLevel || 'known',
      connectedAt: contacts[contactId]?.connectedAt || new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    };

    saveContacts(contacts);

    console.log(`
  ✅ Connected!

  🤖 Agent:        ${contactId}
  🔑 Fingerprint:  ${remoteFingerprint}
  🕐 Timezone:     ${payload.timezone || 'Unknown'}
  🛠️  Capabilities: ${(payload.capabilities || []).join(', ') || 'None listed'}
  📁 Saved to contacts

  You can now:
    ai2ai send ${contactId} "Hello!"
`);

  } catch (err) {
    console.error(`\n  ❌ Connection failed: ${err.message}`);
    console.error('  Make sure the remote agent is running.\n');
    process.exit(1);
  }
}

module.exports = { run };
