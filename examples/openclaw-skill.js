#!/usr/bin/env node
/**
 * OpenClaw Skill Integration — Use AI2AI within OpenClaw
 * 
 * Usage: node openclaw-skill.js
 */

const { createOpenClawAdapter } = require('../src/integrations/openclaw');

async function main() {
  const adapter = createOpenClawAdapter({
    agentName: 'my-openclaw-agent',
    humanName: 'Darren',
    port: 18880,
    onMessage: (payload, from, envelope) => {
      console.log(`📨 [OpenClaw Event] Message from ${from.human || from.agent}:`);
      console.log(`   ${payload.message || JSON.stringify(payload)}`);
    },
    onRequest: (intent, payload, from, envelope) => {
      console.log(`📋 [OpenClaw Event] Request: ${intent} from ${from.human || from.agent}`);
    },
    notify: (text) => {
      console.log(`🔔 [Notification] ${text}`);
    },
  });

  await adapter.start();
  console.log('🦞 OpenClaw AI2AI skill adapter running on port 18880');
  console.log('\nPress Ctrl+C to stop.');
}

main().catch(console.error);
