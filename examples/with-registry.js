#!/usr/bin/env node
/**
 * Agent Discovery via Registry — Demo of registry-based agent discovery
 * 
 * Usage: node with-registry.js
 */

const { AI2AI } = require('../src/client');
const { RegistryServer } = require('../src/registry');

async function main() {
  // Start a local registry
  const registry = new RegistryServer();
  await registry.start(18820);
  console.log('📋 Registry server started on port 18820\n');

  const REGISTRY_URL = 'http://localhost:18820';

  // Agent 1 registers
  const agent1 = new AI2AI({
    name: 'search-agent',
    humanName: 'Agent One',
    port: 18860,
    registry: REGISTRY_URL,
    dataDir: '/tmp/ai2ai-reg1',
  });
  await agent1.start();
  await agent1.register();
  console.log('✅ Agent 1 registered as "search-agent"');

  // Agent 2 discovers Agent 1
  const agent2 = new AI2AI({
    name: 'finder-agent',
    humanName: 'Agent Two',
    port: 18861,
    registry: REGISTRY_URL,
    dataDir: '/tmp/ai2ai-reg2',
  });
  await agent2.start();

  const results = await agent2.discover({ name: 'search' });
  console.log(`\n🔍 Found ${results.length} agent(s):`);
  for (const a of results) {
    console.log(`   • ${a.name} (${a.humanName}) at ${a.endpoint}`);
  }

  // Clean up
  await agent1.stop();
  await agent2.stop();
  registry.stop();
  console.log('\n✅ Done!');
}

main().catch(console.error);
