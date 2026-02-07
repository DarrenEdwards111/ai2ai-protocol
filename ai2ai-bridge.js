#!/usr/bin/env node
/**
 * AI2AI Bridge — CLI interface for agents to interact with their AI2AI server
 * 
 * This is the tool that OpenClaw agents call to send/receive AI2AI messages.
 * Each agent has its own skill directory with its own state.
 * 
 * Usage:
 *   node ai2ai-bridge.js --agent darren --action pending
 *   node ai2ai-bridge.js --agent darren --action send --to alex-assistant --message "Hey!"
 *   node ai2ai-bridge.js --agent darren --action ping --endpoint http://localhost:18811/ai2ai
 *   node ai2ai-bridge.js --agent darren --action status
 *   node ai2ai-bridge.js --agent darren --action contacts
 *   node ai2ai-bridge.js --agent darren --action approve --id <approval-id> --reply "Yes, Thursday works"
 *   node ai2ai-bridge.js --agent darren --action reject --id <approval-id> --reply "No thanks"
 *   node ai2ai-bridge.js --agent darren --action schedule --to alex-assistant --subject "Dinner" --times "2026-02-10T19:00:00Z,2026-02-11T19:00:00Z"
 *   node ai2ai-bridge.js --agent darren --action info --to alex-assistant --question "What time is the meeting?"
 */

const path = require('path');
const fs = require('fs');

// Parse CLI args
const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) {
    const key = argv[i].slice(2);
    const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
    args[key] = val;
    if (val !== true) i++;
  }
}

const AGENT_DIRS = {
  darren: '/home/darre/.openclaw/workspace/skills/ai2ai',
  alex: '/home/darre/.openclaw/workspace-alex/skills/ai2ai',
};

const AGENT_CONFIG = {
  darren: {
    port: 18810,
    agentName: 'darren-assistant',
    humanName: 'Darren',
    timezone: 'Europe/London',
  },
  alex: {
    port: 18811,
    agentName: 'alex-assistant',
    humanName: 'Alex',
    timezone: 'America/New_York',
  },
};

const agentKey = args.agent?.toLowerCase();
if (!agentKey || !AGENT_DIRS[agentKey]) {
  console.error('Usage: node ai2ai-bridge.js --agent <darren|alex> --action <action> [options]');
  console.error('\nActions: pending, send, ping, status, contacts, approve, reject, schedule, info, health');
  process.exit(1);
}

const skillDir = AGENT_DIRS[agentKey];
const config = AGENT_CONFIG[agentKey];

// Set environment for the skill modules
process.env.AI2AI_PORT = String(config.port);
process.env.AI2AI_AGENT_NAME = config.agentName;
process.env.AI2AI_HUMAN_NAME = config.humanName;
process.env.AI2AI_TIMEZONE = config.timezone;

// Change working directory to skill dir so __dirname-based paths work
// Actually, since modules use __dirname, we need to require from the right place
const modulePath = (mod) => path.join(skillDir, mod);

// Dynamic requires from the agent's skill directory
function req(mod) {
  return require(modulePath(mod));
}

async function main() {
  const action = args.action?.toLowerCase();
  
  if (!action) {
    console.error('Missing --action. Options: pending, send, ping, status, contacts, approve, reject, schedule, info, health');
    process.exit(1);
  }

  switch (action) {
    case 'health': {
      // Check if server is running
      try {
        const res = await fetch(`http://localhost:${config.port}/ai2ai/health`);
        const data = await res.json();
        console.log(JSON.stringify(data, null, 2));
      } catch (err) {
        console.log(JSON.stringify({ status: 'offline', error: err.message }));
      }
      break;
    }

    case 'pending': {
      const conversations = req('ai2ai-conversations');
      const pending = conversations.listPendingApprovals().filter(p => !p.resolved);
      
      if (pending.length === 0) {
        console.log('✅ No pending AI2AI messages.');
        break;
      }

      console.log(`📬 ${pending.length} pending AI2AI message(s):\n`);
      for (const p of pending) {
        const id = p.envelope?.id || 'unknown';
        const from = p.envelope?.from?.human || p.envelope?.from?.agent || 'unknown';
        const intent = p.envelope?.intent || p.handler || 'unknown';
        const created = p.createdAt || 'unknown';
        
        console.log(`━━━ Message ${id.substring(0, 8)}... ━━━`);
        console.log(`From: ${from} | Intent: ${intent} | Time: ${created}`);
        console.log(`\n${p.approvalMessage || 'No details'}\n`);
      }
      break;
    }

    case 'send':
    case 'message': {
      const to = args.to;
      const message = args.message;
      if (!to || !message) {
        console.error('Usage: --action send --to <agent-id> --message "text"');
        process.exit(1);
      }

      const trust = req('ai2ai-trust');
      const contact = trust.getContact(to);
      if (!contact?.endpoint) {
        console.error(`❌ No endpoint known for ${to}. Use ping first.`);
        process.exit(1);
      }

      const client = req('ai2ai-client');
      const result = await client.relayMessage(contact.endpoint, {
        message,
        urgency: args.urgency || 'low',
        replyRequested: args.noreply !== 'true',
        to: { agent: to, human: contact.humanName || to },
      });
      
      console.log(`💬 Message sent to ${contact.humanName || to}`);
      console.log(`Status: ${result.status}`);
      if (result.conversation) console.log(`Conversation: ${result.conversation}`);
      break;
    }

    case 'ping': {
      const endpoint = args.endpoint;
      if (!endpoint) {
        // Try to ping all known contacts
        const trust = req('ai2ai-trust');
        const contacts = trust.listContacts();
        for (const [id, contact] of Object.entries(contacts)) {
          if (contact.endpoint && !contact.blocked) {
            console.log(`Pinging ${id} at ${contact.endpoint}...`);
            try {
              const client = req('ai2ai-client');
              const result = await client.ping(contact.endpoint);
              console.log(`  ✅ ${id}: ${result.status} (${result.payload?.capabilities?.length || 0} capabilities)`);
            } catch (err) {
              console.log(`  ❌ ${id}: ${err.message}`);
            }
          }
        }
        break;
      }

      const client = req('ai2ai-client');
      const result = await client.ping(endpoint);
      console.log(`✅ Ping successful`);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'status': {
      const trust = req('ai2ai-trust');
      const conversations = req('ai2ai-conversations');
      const queue = req('ai2ai-queue');

      const contacts = trust.listContacts();
      const pending = conversations.listPendingApprovals().filter(p => !p.resolved);
      const queued = queue.listQueue().filter(q => q.status !== 'delivered');

      // Check if server is running
      let serverStatus = 'unknown';
      try {
        const res = await fetch(`http://localhost:${config.port}/ai2ai/health`);
        if (res.ok) serverStatus = 'online';
        else serverStatus = 'error';
      } catch {
        serverStatus = 'offline';
      }

      console.log(`🦞 AI2AI Status for ${config.humanName} (${config.agentName})`);
      console.log(`   Server:    ${serverStatus} (port ${config.port})`);
      console.log(`   Contacts:  ${Object.keys(contacts).length}`);
      console.log(`   Pending:   ${pending.length}`);
      console.log(`   Queued:    ${queued.length}`);
      break;
    }

    case 'contacts': {
      const trust = req('ai2ai-trust');
      const contacts = trust.listContacts();
      const entries = Object.entries(contacts);

      if (entries.length === 0) {
        console.log('📋 No AI2AI contacts.');
        break;
      }

      console.log(`📋 AI2AI Contacts (${entries.length}):\n`);
      for (const [id, c] of entries) {
        const blocked = c.blocked ? ' 🚫 BLOCKED' : '';
        const trust = c.trustLevel || 'none';
        console.log(`  • ${c.humanName || id} (${id}) — trust: ${trust}${blocked}`);
        if (c.endpoint) console.log(`    endpoint: ${c.endpoint}`);
        if (c.lastSeen) console.log(`    last seen: ${c.lastSeen}`);
      }
      break;
    }

    case 'approve': {
      const id = args.id;
      const reply = args.reply || 'Approved';
      if (!id) {
        console.error('Usage: --action approve --id <approval-id> --reply "response"');
        process.exit(1);
      }

      const integration = req('openclaw-integration');
      const result = await integration.handleHumanReply(id, reply);
      console.log(result.message);
      break;
    }

    case 'reject': {
      const id = args.id;
      const reply = args.reply || 'Declined';
      if (!id) {
        console.error('Usage: --action reject --id <approval-id> --reply "reason"');
        process.exit(1);
      }

      const integration = req('openclaw-integration');
      const result = await integration.handleHumanReply(id, 'decline');
      console.log(result.message);
      break;
    }

    case 'schedule': {
      const to = args.to;
      const subject = args.subject || 'Meeting';
      if (!to) {
        console.error('Usage: --action schedule --to <agent-id> --subject "Meeting" [--times "ISO,..."]');
        process.exit(1);
      }

      const trust = req('ai2ai-trust');
      const contact = trust.getContact(to);
      if (!contact?.endpoint) {
        console.error(`❌ No endpoint for ${to}`);
        process.exit(1);
      }

      const times = args.times 
        ? args.times.split(',').map(t => t.trim())
        : generateDefaultTimes();

      const client = req('ai2ai-client');
      const result = await client.requestMeeting(contact.endpoint, {
        subject,
        proposedTimes: times,
        durationMinutes: parseInt(args.duration) || 60,
        location: args.location || null,
        notes: args.notes || null,
        to: { agent: to, human: contact.humanName || to },
      });

      console.log(`📅 Meeting request sent: "${subject}"`);
      console.log(`Status: ${result.status}`);
      if (result.conversation) console.log(`Conversation: ${result.conversation}`);
      break;
    }

    case 'info': {
      const to = args.to;
      const question = args.question;
      if (!to || !question) {
        console.error('Usage: --action info --to <agent-id> --question "text"');
        process.exit(1);
      }

      const trust = req('ai2ai-trust');
      const contact = trust.getContact(to);
      if (!contact?.endpoint) {
        console.error(`❌ No endpoint for ${to}`);
        process.exit(1);
      }

      const client = req('ai2ai-client');
      const result = await client.requestInfo(contact.endpoint, {
        question,
        context: args.context || null,
        to: { agent: to, human: contact.humanName || to },
      });

      console.log(`❓ Question sent to ${contact.humanName || to}: "${question}"`);
      console.log(`Status: ${result.status}`);
      break;
    }

    default:
      console.error(`Unknown action: ${action}`);
      console.error('Options: pending, send, ping, status, contacts, approve, reject, schedule, info, health');
      process.exit(1);
  }
}

function generateDefaultTimes() {
  const times = [];
  const now = new Date();
  for (let i = 1; i <= 3; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    d.setHours(19, 0, 0, 0);
    times.push(d.toISOString());
  }
  return times;
}

main().catch(err => {
  console.error(`❌ Error: ${err.message}`);
  process.exit(1);
});
