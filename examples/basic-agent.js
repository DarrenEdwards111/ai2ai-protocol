#!/usr/bin/env node
/**
 * Basic AI2AI Agent — Minimal working example
 * 
 * Start a single agent that listens for messages.
 * 
 * Usage: node basic-agent.js
 */

const { AI2AI } = require('../src/client');

async function main() {
  const agent = new AI2AI({
    name: 'basic-agent',
    humanName: 'Demo User',
    port: 18800,
    dataDir: '/tmp/ai2ai-basic',
  });

  agent.on('message', (payload, from) => {
    console.log(`📨 Message from ${from.human || from.agent}:`, payload.message || payload);
  });

  agent.on('request', (intent, payload, from) => {
    console.log(`📋 Request from ${from.human || from.agent}: ${intent}`, payload);
  });

  await agent.start();
  console.log(`🦞 Agent "${agent.name}" listening on port ${agent.port}`);
  console.log(`   Endpoint: http://localhost:${agent.port}/ai2ai`);
  console.log('\nPress Ctrl+C to stop.');
}

main().catch(console.error);
