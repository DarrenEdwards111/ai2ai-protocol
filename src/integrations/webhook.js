/**
 * AI2AI Webhook Integration (generic HMAC mode)
 *
 * Forwards AI2AI envelopes, as a JSON summary signed with an optional HMAC-SHA256
 * `X-AI2AI-Signature` header, to a URL from local configuration.
 *
 * This is NOT the Grok Bot routine format. For Grok Bot (Bearer key, `{"testid"}`
 * body) use `./grokbot-webhook`.
 *
 * Attach `handler` to an AI2AI client's `message` event: that event fires only after
 * signature verification and any required local approval, so unverified, untrusted
 * or unapproved commerce messages are never forwarded automatically.
 *
 * 2.0 changes: non-2xx responses, redirects, network errors and timeouts reject with
 * a WebhookDeliveryError (no secrets in messages); `handler` reports failures to
 * `onError` instead of swallowing them; redirects are never followed; header values
 * derived from envelopes are sanitised; plain http is refused except for loopback
 * unless `allowInsecureHttp: true`. No automatic retries.
 *
 * @author Mikoshi Ltd <mikoshiuk@gmail.com>
 */
'use strict';
const http = require('http');
const https = require('https');
const crypto = require('crypto');

const LOOPBACK = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);

class WebhookDeliveryError extends Error {
  constructor(code, message, status) { super(message); this.name = 'WebhookDeliveryError'; this.code = code; if (status !== undefined) this.status = status; }
}

function headerSafe(v) { return typeof v === 'string' && /^[A-Za-z0-9._:@\-]{1,200}$/.test(v) ? v : 'invalid'; }

function parseUrl(raw, allowInsecureHttp) {
  let url;
  try { url = new URL(raw); } catch { throw new WebhookDeliveryError('invalid_url', 'Webhook URL is not a valid absolute URL'); }
  if (url.username || url.password) throw new WebhookDeliveryError('invalid_url', 'Webhook URL must not contain credentials');
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:' && (allowInsecureHttp || LOOPBACK.has(url.hostname))) return url;
  throw new WebhookDeliveryError('insecure_url', 'Webhook URL must use https (http allowed for loopback or with allowInsecureHttp)');
}

/**
 * @param {object} opts
 * @param {string} opts.url - Webhook URL (local configuration only)
 * @param {string} [opts.secret] - Shared secret for HMAC signature
 * @param {string[]} [opts.events] - Envelope types to forward (default: all)
 * @param {number} [opts.timeout=10000]
 * @param {boolean} [opts.allowInsecureHttp=false]
 * @param {(err: WebhookDeliveryError, envelope: object) => void} [opts.onError]
 */
function createWebhookForwarder(opts = {}) {
  if (opts.mode && opts.mode !== 'ai2ai-hmac') throw new Error(`Unsupported webhook mode "${opts.mode}"; for Grok Bot use src/integrations/grokbot-webhook`);
  const url = parseUrl(opts.url, opts.allowInsecureHttp === true);
  const secret = opts.secret;
  const allowedEvents = opts.events || null;
  const timeout = opts.timeout || 10000;
  const onError = typeof opts.onError === 'function' ? opts.onError
    : (err) => console.error(`[ai2ai webhook] delivery failed: ${err.code}: ${err.message}`);

  async function forward(envelope) {
    if (allowedEvents && !allowedEvents.includes(envelope.type)) return { status: 0, body: 'skipped' };
    const body = JSON.stringify({
      event: envelope.type, intent: envelope.intent, from: envelope.from, to: envelope.to,
      payload: envelope.payload, conversation: envelope.conversation, timestamp: envelope.timestamp, messageId: envelope.id,
    });
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'X-AI2AI-Event': headerSafe(envelope.type),
      'X-AI2AI-Agent': headerSafe(envelope.from && envelope.from.agent),
    };
    if (secret) headers['X-AI2AI-Signature'] = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');

    return new Promise((resolve, reject) => {
      const fail = (code, msg, status) => reject(new WebhookDeliveryError(code, msg, status));
      const client = url.protocol === 'https:' ? https : http;
      const req = client.request({
        method: 'POST', protocol: url.protocol, hostname: url.hostname.replace(/^\[|\]$/g, ''), port: url.port || undefined,
        path: url.pathname + url.search, headers, timeout,
      }, (res) => {
        let data = '';
        res.on('data', (c) => { if (data.length < 65536) data += c; });
        res.on('end', () => {
          const s = res.statusCode;
          if (s >= 200 && s < 300) return resolve({ status: s, body: data });
          if (s >= 300 && s < 400) return fail('redirect_refused', `Webhook at ${url.host} answered HTTP ${s} redirect; not followed`, s);
          return fail('http_error', `Webhook at ${url.host} answered HTTP ${s}`, s);
        });
      });
      req.on('error', (e) => fail('network_error', `Could not reach ${url.host}${e && e.code ? ' (' + e.code + ')' : ''}`));
      req.on('timeout', () => { req.destroy(); fail('timeout', `No response from ${url.host} within ${timeout} ms`); });
      req.end(body);
    });
  }

  function handler(payload, from, envelope) {
    return forward(envelope).catch((err) => { try { onError(err, envelope); } catch { /* listener errors must not crash agent */ } });
  }

  return { forward, handler };
}

function verifyWebhookSignature(body, signature, secret) {
  if (!signature || !secret) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

module.exports = { createWebhookForwarder, verifyWebhookSignature, WebhookDeliveryError };
