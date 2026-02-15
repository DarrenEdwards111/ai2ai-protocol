/**
 * AI2AI Webhook Integration
 * 
 * Forward AI2AI messages as webhooks to any URL.
 * 
 * @author Mikoshi Ltd <mikoshiuk@gmail.com>
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');

/**
 * Create a webhook forwarder for AI2AI messages
 * 
 * @param {object} opts
 * @param {string} opts.url - Webhook URL to forward to
 * @param {string} [opts.secret] - Shared secret for HMAC signature
 * @param {string[]} [opts.events] - Event types to forward (default: all)
 * @param {number} [opts.timeout=10000] - Request timeout ms
 * @returns {{ forward: Function, handler: Function }}
 */
function createWebhookForwarder(opts = {}) {
  const webhookUrl = opts.url;
  const secret = opts.secret;
  const allowedEvents = opts.events || null;
  const timeout = opts.timeout || 10000;

  /**
   * Forward an AI2AI envelope to the webhook URL
   * @param {object} envelope - AI2AI message envelope
   * @returns {Promise<{ status: number, body: string }>}
   */
  async function forward(envelope) {
    if (allowedEvents && !allowedEvents.includes(envelope.type)) {
      return { status: 0, body: 'skipped' };
    }

    const body = JSON.stringify({
      event: envelope.type,
      intent: envelope.intent,
      from: envelope.from,
      to: envelope.to,
      payload: envelope.payload,
      conversation: envelope.conversation,
      timestamp: envelope.timestamp,
      messageId: envelope.id,
    });

    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'X-AI2AI-Event': envelope.type,
      'X-AI2AI-Agent': envelope.from?.agent || 'unknown',
    };

    if (secret) {
      const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
      headers['X-AI2AI-Signature'] = `sha256=${sig}`;
    }

    return new Promise((resolve, reject) => {
      const url = new URL(webhookUrl);
      const client = url.protocol === 'https:' ? https : http;

      const req = client.request({
        method: 'POST',
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers,
        timeout,
      }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Webhook timeout')); });
      req.write(body);
      req.end();
    });
  }

  /**
   * Create an event handler for use with AI2AI agent.on('message', handler)
   * @returns {Function}
   */
  function handler(payload, from, envelope) {
    forward(envelope).catch(() => { /* silently fail */ });
  }

  return { forward, handler };
}

/**
 * Verify a webhook signature
 * @param {string} body - Raw request body
 * @param {string} signature - X-AI2AI-Signature header value
 * @param {string} secret - Shared secret
 * @returns {boolean}
 */
function verifyWebhookSignature(body, signature, secret) {
  if (!signature || !secret) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

module.exports = { createWebhookForwarder, verifyWebhookSignature };
