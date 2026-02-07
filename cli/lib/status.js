/**
 * ai2ai status — Show server status, identity, and diagnostics
 */

'use strict';

const { loadConfig, loadContacts, PENDING_DIR, AI2AI_DIR } = require('./config');
const { loadKeys, getFingerprint } = require('./crypto');
const { fetchGet } = require('./protocol');
const fs = require('fs');

async function run() {
  const config = loadConfig();
  const keys = loadKeys();

  console.log(`
╔══════════════════════════════════════════╗
║         🦞 AI2AI Status                 ║
╚══════════════════════════════════════════╝
`);

  // Config
  if (!config) {
    console.log('  ⚠️  Not configured. Run `ai2ai init` to set up.\n');
    return;
  }

  const fingerprint = keys ? getFingerprint(keys.publicKey) : '(no keys)';
  const contacts = loadContacts();
  const contactCount = Object.keys(contacts).length;

  // Count pending
  let pendingCount = 0;
  try {
    if (fs.existsSync(PENDING_DIR)) {
      pendingCount = fs.readdirSync(PENDING_DIR).filter(f => f.endsWith('.json')).length;
    }
  } catch { /* ignore */ }

  console.log(`  👤 Human:        ${config.humanName}`);
  console.log(`  🤖 Agent:        ${config.agentName}`);
  console.log(`  🌐 Port:         ${config.port}`);
  console.log(`  🕐 Timezone:     ${config.timezone || 'Not set'}`);
  console.log(`  🔑 Fingerprint:  ${fingerprint}`);
  console.log(`  👥 Contacts:     ${contactCount}`);
  console.log(`  📬 Pending:      ${pendingCount}`);
  console.log(`  📁 Config dir:   ${AI2AI_DIR}`);

  if (config.telegramToken) {
    console.log(`  📱 Telegram:     Configured`);
  }

  // Check if server is running
  console.log(`\n  🏥 Server health check...`);
  try {
    const result = await fetchGet(`http://localhost:${config.port}/ai2ai/health`);
    if (result.data?.status === 'online') {
      console.log(`  ✅ Server is running on port ${config.port}`);
    } else {
      console.log(`  ⚠️  Server responded but status is: ${result.data?.status || 'unknown'}`);
    }
  } catch {
    console.log(`  ❌ Server is not running on port ${config.port}`);
    console.log(`     Start it with: ai2ai start`);
  }

  console.log('');
}

module.exports = { run };
