#!/usr/bin/env node
/**
 * AI2AI Multi-Agent Startup
 * 
 * Starts AI2AI servers for both Darren and Alex, each with its own
 * identity, keys, contacts, and data directories.
 * 
 * Darren: port 18810
 * Alex:   port 18811
 * 
 * Usage:
 *   node ai2ai-start.js          # Start both servers
 *   node ai2ai-start.js darren   # Start only Darren's server
 *   node ai2ai-start.js alex     # Start only Alex's server
 */

const { fork } = require('child_process');
const path = require('path');
const fs = require('fs');

const DARREN_SKILL = path.join(__dirname, '..', 'skills', 'ai2ai');
const ALEX_SKILL = path.join(__dirname, '..', '..', '.openclaw', 'workspace-alex', 'skills', 'ai2ai');

// Resolve to absolute paths
const DARREN_DIR = path.resolve(DARREN_SKILL);
const ALEX_DIR = path.resolve(ALEX_SKILL);

// Fallback: use workspace paths directly
const darrenSkill = fs.existsSync(DARREN_DIR) ? DARREN_DIR 
  : path.resolve('/home/darre/.openclaw/workspace/skills/ai2ai');
const alexSkill = fs.existsSync(ALEX_DIR) ? ALEX_DIR 
  : path.resolve('/home/darre/.openclaw/workspace-alex/skills/ai2ai');

const agents = {
  darren: {
    name: 'Darren',
    port: 18810,
    skillDir: darrenSkill,
    env: {
      AI2AI_PORT: '18810',
      AI2AI_AGENT_NAME: 'darren-assistant',
      AI2AI_HUMAN_NAME: 'Darren',
      AI2AI_TIMEZONE: 'Europe/London',
    },
  },
  alex: {
    name: 'Alex',
    port: 18811,
    skillDir: alexSkill,
    env: {
      AI2AI_PORT: '18811',
      AI2AI_AGENT_NAME: 'alex-assistant',
      AI2AI_HUMAN_NAME: 'Alex',
      AI2AI_TIMEZONE: 'America/New_York',
    },
  },
};

// Determine which agents to start
const arg = process.argv[2]?.toLowerCase();
const toStart = arg ? [arg] : ['darren', 'alex'];

const children = [];

for (const agentKey of toStart) {
  const agent = agents[agentKey];
  if (!agent) {
    console.error(`Unknown agent: ${agentKey}. Use 'darren' or 'alex'.`);
    process.exit(1);
  }

  // Ensure required directories exist
  for (const subdir of ['.keys', 'pending', 'conversations', 'logs', 'outbox']) {
    const dir = path.join(agent.skillDir, subdir);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  console.log(`🚀 Starting ${agent.name}'s AI2AI server on port ${agent.port}...`);
  console.log(`   Skill dir: ${agent.skillDir}`);

  const child = fork(
    path.join(agent.skillDir, 'ai2ai-server.js'),
    [],
    {
      cwd: agent.skillDir,
      env: { ...process.env, ...agent.env },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    }
  );

  child.stdout.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    for (const line of lines) {
      console.log(`[${agent.name}] ${line}`);
    }
  });

  child.stderr.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    for (const line of lines) {
      console.error(`[${agent.name} ERR] ${line}`);
    }
  });

  child.on('exit', (code) => {
    console.log(`[${agent.name}] Server exited with code ${code}`);
  });

  children.push({ agent, child });
}

// Setup contacts after a brief delay (so keys are generated)
setTimeout(() => {
  setupContacts();
}, 1000);

/**
 * Pre-configure contacts so both agents know each other
 */
function setupContacts() {
  console.log('\n📇 Setting up mutual contacts...');

  for (const agentKey of toStart) {
    const agent = agents[agentKey];
    const contactsPath = path.join(agent.skillDir, 'contacts.json');
    
    let contacts = {};
    if (fs.existsSync(contactsPath)) {
      try { contacts = JSON.parse(fs.readFileSync(contactsPath, 'utf-8')); } 
      catch { contacts = {}; }
    }

    if (agentKey === 'darren') {
      // Darren knows Alex
      contacts['alex-assistant'] = {
        ...contacts['alex-assistant'],
        humanName: 'Alex',
        endpoint: 'http://localhost:18811/ai2ai',
        trustLevel: contacts['alex-assistant']?.trustLevel || 'known',
        capabilities: [
          'schedule.meeting', 'schedule.call', 'schedule.group',
          'message.relay', 'info.request', 'info.share',
          'social.introduction', 'commerce.request', 'commerce.offer',
        ],
        lastSeen: new Date().toISOString(),
      };
    } else if (agentKey === 'alex') {
      // Alex knows Darren
      contacts['darren-assistant'] = {
        ...contacts['darren-assistant'],
        humanName: 'Darren',
        endpoint: 'http://localhost:18810/ai2ai',
        trustLevel: contacts['darren-assistant']?.trustLevel || 'known',
        capabilities: [
          'schedule.meeting', 'schedule.call', 'schedule.group',
          'message.relay', 'info.request', 'info.share',
          'social.introduction', 'commerce.request', 'commerce.offer',
        ],
        lastSeen: new Date().toISOString(),
      };
    }

    fs.writeFileSync(contactsPath, JSON.stringify(contacts, null, 2));
    console.log(`   ✅ ${agent.name}'s contacts updated`);
  }

  // Exchange public keys if both are running
  if (toStart.includes('darren') && toStart.includes('alex')) {
    exchangeKeys();
  }

  console.log('\n✅ AI2AI servers ready!\n');
  console.log('Endpoints:');
  for (const agentKey of toStart) {
    const agent = agents[agentKey];
    console.log(`  ${agent.name}: http://localhost:${agent.port}/ai2ai`);
  }
  console.log('\nPress Ctrl+C to stop all servers.\n');
}

/**
 * Exchange public keys between agents by reading from their .keys/ dirs
 */
function exchangeKeys() {
  try {
    // Read Darren's public keys
    const darrenPubPath = path.join(darrenSkill, '.keys', 'agent.pub');
    const darrenX25519Path = path.join(darrenSkill, '.keys', 'x25519.pub.der');
    
    // Read Alex's public keys  
    const alexPubPath = path.join(alexSkill, '.keys', 'agent.pub');
    const alexX25519Path = path.join(alexSkill, '.keys', 'x25519.pub.der');

    // Wait a bit for keys to be generated
    const maxWait = 5000;
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      if (fs.existsSync(darrenPubPath) && fs.existsSync(alexPubPath)) break;
      // Busy wait (short)
      const end = Date.now() + 100;
      while (Date.now() < end) { /* wait */ }
    }

    if (fs.existsSync(darrenPubPath) && fs.existsSync(alexPubPath)) {
      const darrenPub = fs.readFileSync(darrenPubPath, 'utf-8');
      const alexPub = fs.readFileSync(alexPubPath, 'utf-8');
      
      // Update Alex's contacts with Darren's public key
      const alexContactsPath = path.join(alexSkill, 'contacts.json');
      const alexContacts = JSON.parse(fs.readFileSync(alexContactsPath, 'utf-8'));
      alexContacts['darren-assistant'].publicKey = darrenPub;
      if (fs.existsSync(darrenX25519Path)) {
        alexContacts['darren-assistant'].x25519PublicKey = fs.readFileSync(darrenX25519Path).toString('base64');
      }
      fs.writeFileSync(alexContactsPath, JSON.stringify(alexContacts, null, 2));

      // Update Darren's contacts with Alex's public key
      const darrenContactsPath = path.join(darrenSkill, 'contacts.json');
      const darrenContacts = JSON.parse(fs.readFileSync(darrenContactsPath, 'utf-8'));
      darrenContacts['alex-assistant'].publicKey = alexPub;
      if (fs.existsSync(alexX25519Path)) {
        darrenContacts['alex-assistant'].x25519PublicKey = fs.readFileSync(alexX25519Path).toString('base64');
      }
      fs.writeFileSync(darrenContactsPath, JSON.stringify(darrenContacts, null, 2));

      console.log('   🔑 Public keys exchanged between agents');
    } else {
      console.log('   ⚠️  Could not exchange keys (keys not yet generated)');
      console.log('   Run a ping between agents to exchange keys manually.');
    }
  } catch (err) {
    console.log(`   ⚠️  Key exchange error: ${err.message}`);
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down AI2AI servers...');
  for (const { agent, child } of children) {
    console.log(`   Stopping ${agent.name}'s server...`);
    child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(0), 1000);
});

process.on('SIGTERM', () => {
  for (const { child } of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(0), 1000);
});
