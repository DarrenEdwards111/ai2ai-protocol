/**
 * AI2AI OpenClaw Integration
 * 
 * Skill adapter that receives AI2AI messages as system events
 * within the OpenClaw agent framework.
 * 
 * @author Mikoshi Ltd <mikoshiuk@gmail.com>
 */

const { AI2AI } = require('../client');

/**
 * Create an OpenClaw skill adapter for AI2AI
 * 
 * @param {object} opts
 * @param {string} opts.agentName - Agent ID
 * @param {string} opts.humanName - Human operator name
 * @param {number} [opts.port=18800] - Server port
 * @param {string} [opts.registry] - Registry URL
 * @param {Function} opts.onMessage - Called when a message arrives: (message, from, envelope) => {}
 * @param {Function} [opts.onRequest] - Called when a request arrives: (intent, payload, from, envelope) => {}
 * @param {Function} [opts.notify] - Called to notify human: (text) => {}
 * @returns {{ agent: AI2AI, start: Function, stop: Function, send: Function }}
 */
function createOpenClawAdapter(opts = {}) {
  const agent = new AI2AI({
    name: opts.agentName || process.env.AI2AI_AGENT_NAME || 'openclaw-agent',
    humanName: opts.humanName || process.env.AI2AI_HUMAN_NAME || 'Human',
    port: opts.port || parseInt(process.env.AI2AI_PORT) || 18800,
    registry: opts.registry,
  });

  // Wire up events
  agent.on('message', (payload, from, envelope) => {
    if (opts.onMessage) opts.onMessage(payload, from, envelope);
    if (opts.notify) {
      const text = typeof payload.message === 'string' ? payload.message : JSON.stringify(payload);
      opts.notify(`📨 AI2AI from ${from.human || from.agent}: ${text}`);
    }
  });

  agent.on('request', (intent, payload, from, envelope) => {
    if (opts.onRequest) opts.onRequest(intent, payload, from, envelope);
    if (opts.notify) {
      opts.notify(`📋 AI2AI request from ${from.human || from.agent}: ${intent}`);
    }
  });

  return {
    agent,
    async start() {
      await agent.start();
      if (opts.registry) await agent.register();
      return agent;
    },
    async stop() { return agent.stop(); },
    async send(targetId, message) { return agent.send(targetId, message); },
    async request(targetId, intent, payload) { return agent.request(targetId, intent, payload); },
  };
}

module.exports = { createOpenClawAdapter };
