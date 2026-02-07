/**
 * ai2ai init — Interactive setup wizard
 * Creates identity, generates keys, saves config to ~/.ai2ai/
 */

'use strict';

const readline = require('readline');
const { saveConfig, loadConfig, ensureDirs, AI2AI_DIR } = require('./config');
const { generateKeyPair, saveKeys, getFingerprint } = require('./crypto');

/**
 * Prompt the user for input
 */
function ask(rl, question, defaultValue) {
  const suffix = defaultValue ? ` (${defaultValue})` : '';
  return new Promise(resolve => {
    rl.question(`  ${question}${suffix}: `, answer => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

/**
 * Prompt for yes/no
 */
function askYesNo(rl, question, defaultYes = false) {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  return new Promise(resolve => {
    rl.question(`  ${question} [${hint}]: `, answer => {
      const a = answer.trim().toLowerCase();
      if (!a) return resolve(defaultYes);
      resolve(a === 'y' || a === 'yes');
    });
  });
}

async function run() {
  const existing = loadConfig();

  console.log(`
╔══════════════════════════════════════════╗
║     🦞 AI2AI — Agent Setup Wizard       ║
╚══════════════════════════════════════════╝
`);

  if (existing) {
    console.log(`  ⚠️  Existing config found at ${AI2AI_DIR}`);
    console.log(`     Agent: ${existing.agentName} (${existing.humanName})\n`);
  }

  console.log('  Let\'s set up your AI agent identity.\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    // 1. Human name
    const defaultName = existing?.humanName || '';
    const humanName = await ask(rl, '👤 Your name', defaultName);
    if (!humanName) {
      console.log('\n  ❌ Name is required.\n');
      return;
    }

    // 2. Agent name
    const defaultAgent = existing?.agentName || `${humanName.toLowerCase().replace(/\s+/g, '-')}-assistant`;
    const agentName = await ask(rl, '🤖 Agent name', defaultAgent);

    // 3. Port
    const defaultPort = existing?.port || 18800;
    const portStr = await ask(rl, '🌐 Server port', String(defaultPort));
    const port = parseInt(portStr) || defaultPort;

    // 4. Timezone
    const defaultTz = existing?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const timezone = await ask(rl, '🕐 Timezone', defaultTz);

    // 5. Telegram integration
    let telegramToken = existing?.telegramToken || '';
    const wantTelegram = await askYesNo(rl, '📱 Enable Telegram integration?', !!telegramToken);
    if (wantTelegram) {
      telegramToken = await ask(rl, '🔑 Telegram bot token', telegramToken ? '(keep existing)' : '');
      if (telegramToken === '(keep existing)') telegramToken = existing?.telegramToken || '';
    } else {
      telegramToken = '';
    }

    // 6. Generate keys
    console.log('\n  🔑 Generating Ed25519 keypair...');
    let keys;
    if (existing && await askYesNo(rl, '   Keep existing keys?', true)) {
      const { loadKeys } = require('./crypto');
      keys = loadKeys();
      if (!keys) {
        console.log('   ⚠️  No existing keys found, generating new ones...');
        keys = generateKeyPair();
      }
    } else {
      keys = generateKeyPair();
    }

    rl.close();

    // Save everything
    ensureDirs();
    saveKeys(keys);

    const config = {
      agentName,
      humanName,
      port,
      timezone,
      telegramToken: telegramToken || undefined,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveConfig(config);

    const fingerprint = getFingerprint(keys.publicKey);

    console.log(`
╔══════════════════════════════════════════╗
║          ✅ Setup Complete!              ║
╚══════════════════════════════════════════╝

  👤 Human:        ${humanName}
  🤖 Agent:        ${agentName}
  🌐 Port:         ${port}
  🕐 Timezone:     ${timezone}
  🔑 Fingerprint:  ${fingerprint}
  📁 Config:       ${AI2AI_DIR}
${telegramToken ? '  📱 Telegram:     Enabled\n' : ''}
  Next steps:
    ai2ai start                   Start your server
    ai2ai connect <endpoint>      Connect to a friend
    ai2ai status                  Check your setup
`);

  } catch (err) {
    rl.close();
    throw err;
  }
}

module.exports = { run };
