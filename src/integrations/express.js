/**
 * AI2AI Express Middleware
 * 
 * Drop-in middleware for receiving AI2AI messages in Express apps.
 * 
 * Usage:
 *   const express = require('express');
 *   const { ai2aiMiddleware } = require('ai2ai-protocol/src/integrations/express');
 *   
 *   const app = express();
 *   app.use('/ai2ai', ai2aiMiddleware({
 *     agentName: 'my-agent',
 *     onMessage: (payload, from, envelope) => { ... },
 *   }));
 * 
 * @author Mikoshi Ltd <mikoshiuk@gmail.com>
 */

const crypto = require('crypto');
const { RateLimiter, NonceTracker, isMessageExpired } = require('../security');
const { Deduplicator } = require('../reliability');

/**
 * Create Express middleware for receiving AI2AI messages
 * 
 * @param {object} opts
 * @param {string} opts.agentName - This agent's name
 * @param {Function} opts.onMessage - Called for each message: (payload, from, envelope, res) => {}
 * @param {Function} [opts.onRequest] - Called for requests: (intent, payload, from, envelope, res) => {}
 * @param {number} [opts.rateLimit=20] - Max requests per minute per agent
 * @param {number} [opts.maxAge=86400000] - Max message age in ms
 * @param {string[]} [opts.blocklist] - Blocked agent IDs
 * @returns {Function} Express middleware
 */
function ai2aiMiddleware(opts = {}) {
  const agentName = opts.agentName || 'express-agent';
  const rateLimiter = new RateLimiter({ maxRequests: opts.rateLimit || 20 });
  const nonceTracker = new NonceTracker();
  const deduplicator = new Deduplicator();
  const blocklist = new Set(opts.blocklist || []);
  const maxAge = opts.maxAge || 86400000;

  return function ai2aiHandler(req, res, next) {
    // Health check
    if (req.method === 'GET' && (req.path === '/health' || req.path === '/')) {
      return res.json({ status: 'online', agent: agentName, protocol: '1.0' });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // Parse body (handle both parsed and raw)
    const envelope = req.body;
    if (!envelope || !envelope.ai2ai || !envelope.type || !envelope.from) {
      return res.status(400).json({ error: 'Invalid AI2AI envelope' });
    }

    const fromAgent = envelope.from?.agent;

    // Security checks
    if (blocklist.has(fromAgent)) {
      return res.status(403).json({ status: 'rejected', reason: 'blocked' });
    }

    if (!rateLimiter.allow(fromAgent)) {
      return res.status(429).json({ status: 'rejected', reason: 'rate_limited' });
    }

    if (isMessageExpired(envelope, maxAge)) {
      return res.status(400).json({ status: 'rejected', reason: 'message_expired' });
    }

    if (envelope.nonce && nonceTracker.isReplay(envelope.nonce)) {
      return res.status(400).json({ status: 'rejected', reason: 'replay_detected' });
    }

    if (deduplicator.isDuplicate(envelope.id)) {
      return res.json({ status: 'duplicate', id: envelope.id });
    }

    // Route to handlers
    if (envelope.type === 'request' && opts.onRequest) {
      opts.onRequest(envelope.intent, envelope.payload, envelope.from, envelope, res);
    } else if (opts.onMessage) {
      opts.onMessage(envelope.payload, envelope.from, envelope, res);
    }

    // Default response if handler didn't respond
    if (!res.headersSent) {
      res.json({ status: 'ok', id: envelope.id, agent: agentName });
    }
  };
}

module.exports = { ai2aiMiddleware };
