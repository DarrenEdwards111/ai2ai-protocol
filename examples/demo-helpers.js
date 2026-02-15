/**
 * Shared helpers for AI2AI demo scripts.
 * Creates lightweight agents using the AI2AI client library.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { AI2AI } = require('../src/client');

function createAgent(name, port) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `ai2ai-demo-${name}-`));
  const agent = new AI2AI({
    name,
    port,
    humanName: `${name}-human`,
    timeout: 5000,
    messageTTL: 60000,
    dataDir,
  });
  // Disable retries for fast local demos
  agent._deliver = async function(targetId, envelope) {
    let endpoint = this.contacts.get(targetId)?.endpoint;
    if (!endpoint) throw new Error(`Cannot resolve endpoint for ${targetId}`);
    this.deliveryTracker.trackSent(envelope.id);
    const result = await this._rawSend(endpoint, envelope);
    this.deliveryTracker.markDelivered(envelope.id);
    return result;
  };
  return agent;
}

function log(prefix, msg) {
  console.log(`  [${prefix}] ${msg}`);
}

async function cleanup(...agents) {
  for (const a of agents) {
    try { await a.stop(); } catch {}
  }
}

function assert(condition, msg) {
  if (!condition) {
    console.error(`\n❌ ASSERTION FAILED: ${msg}`);
    process.exit(1);
  }
}

module.exports = { createAgent, log, cleanup, assert };
