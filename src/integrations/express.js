/**
 * AI2AI Express Middleware (2.0, hardened)
 *
 * Delegates every POST to the AI2AI client's hardened receive path
 * (`agent.receiveEnvelope`): wire 1.1 validation, Ed25519 verification against
 * locally configured contact keys, durable replay/duplicate protection, expiry,
 * rate limiting and local approval gating. Application code subscribes to the
 * agent's `message` / `request` events, which fire only after verification and,
 * where required, an explicit `agent.resolveApproval(id, true)`.
 *
 * Breaking change from 1.x: `onMessage` / `onRequest` callbacks are removed because
 * they ran before any signature check.
 *
 * Usage:
 *   const agent = new AI2AI({ name: 'my-agent', dataDir });
 *   agent.addContact('peer', { publicKey, trustLevel: 'trusted' });
 *   agent.on('request', (intent, payload, from) => { ... });
 *   app.use('/ai2ai', express.json({ limit: '100kb' }), ai2aiMiddleware({ agent }));
 */
'use strict';
const wire = require('../wire');

const MAX_BODY = 102400;

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8'));
    if (typeof req.body === 'string') return JSON.parse(req.body);
    return req.body;
  }
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > MAX_BODY) { const e = new Error('too_large'); e.tooLarge = true; throw e; } }
  return JSON.parse(raw);
}

function ai2aiMiddleware(opts = {}) {
  if (opts.onMessage || opts.onRequest) {
    throw new Error('ai2aiMiddleware: onMessage/onRequest were removed in 2.0 because they bypassed verification; subscribe to agent "message"/"request" events instead');
  }
  const agent = opts.agent;
  if (!agent || typeof agent.receiveEnvelope !== 'function') {
    throw new Error('ai2aiMiddleware requires opts.agent (an AI2AI client instance)');
  }

  return async function ai2aiHandler(req, res, next) {
    try {
      if (req.method === 'GET' && (req.path === '/health' || req.path === '/')) {
        return res.status(200).json({ status: 'online', agent: agent.name, protocol: 'ai2ai', version: wire.VERSION });
      }
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      let envelope;
      try { envelope = await readBody(req); }
      catch (e) { return e.tooLarge ? res.status(413).json({ error: 'Payload too large' }) : res.status(400).json({ error: 'Invalid JSON' }); }
      const { code, body } = await agent.receiveEnvelope(envelope);
      return res.status(code).json(body);
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { ai2aiMiddleware };
