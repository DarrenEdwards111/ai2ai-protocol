/**
 * Grok Bot routine webhook adapter (opt-in).
 *
 * Sends the minimal delivery-test body `{"testid": "..."}` to a Grok Bot routine
 * webhook with `Authorization: Bearer <key>`.
 *
 * Meaning of success: HTTP 2xx only means Grok Bot accepted the call and started a
 * routine run. It does NOT mean the run finished, that the message was understood,
 * or that any reply exists. There is no reply channel in this adapter.
 *
 * Safety properties:
 * - The key is read at send time from `token` (string or function) or `tokenEnv`
 *   (name of an environment variable). It is never stored on the returned object,
 *   logged, or included in error messages.
 * - https is required. Plain http is allowed only for loopback hosts when
 *   `allowInsecureLoopback: true` (intended for local mock tests).
 * - Redirects are never followed (the Authorization header can't leak to another host).
 * - No automatic retries; the same testid is refused a second time in one process,
 *   because the current test routine is single-use.
 * - The target URL comes only from local configuration, never from an incoming message.
 */
'use strict';
const http = require('http');
const https = require('https');

const TESTID = /^[A-Za-z0-9_-]{1,100}$/;
const TOKEN = /^[\x21-\x7E]{1,4096}$/; // visible ASCII, no spaces/CR/LF
const LOOPBACK = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);
const RUN_ACCEPTED = 'Grok Bot accepted the call and started a routine run. This does not confirm the run finished or that any reply exists.';

class GrokBotWebhookError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'GrokBotWebhookError';
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

function isValidTestId(v) { return typeof v === 'string' && TESTID.test(v); }

function parseTarget(raw, allowInsecureLoopback) {
  let url;
  try { url = new URL(raw); } catch { throw new GrokBotWebhookError('invalid_url', 'Webhook URL is not a valid absolute URL'); }
  if (url.username || url.password) throw new GrokBotWebhookError('invalid_url', 'Webhook URL must not contain credentials');
  if (url.hash) throw new GrokBotWebhookError('invalid_url', 'Webhook URL must not contain a fragment');
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:' && allowInsecureLoopback && LOOPBACK.has(url.hostname)) return url;
  throw new GrokBotWebhookError('insecure_url', 'Webhook URL must use https (http only for loopback with allowInsecureLoopback)');
}

function createGrokBotWebhookClient(opts = {}) {
  const target = parseTarget(opts.url, opts.allowInsecureLoopback === true);
  const timeout = Number.isInteger(opts.timeout) && opts.timeout > 0 ? opts.timeout : 10000;
  const tokenSource = opts.token;
  const tokenEnv = opts.tokenEnv;
  if (tokenSource === undefined && !tokenEnv) throw new GrokBotWebhookError('missing_token_config', 'Provide token (string/function) or tokenEnv');
  if (tokenEnv !== undefined && (typeof tokenEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(tokenEnv))) throw new GrokBotWebhookError('missing_token_config', 'tokenEnv must be an environment variable name');
  const sent = new Set();
  const host = target.host;

  function resolveToken() {
    let t;
    try { t = typeof tokenSource === 'function' ? tokenSource() : (tokenSource !== undefined ? tokenSource : process.env[tokenEnv]); }
    catch { throw new GrokBotWebhookError('missing_token', 'Webhook key could not be read'); }
    if (typeof t !== 'string' || !t.length) throw new GrokBotWebhookError('missing_token', 'Webhook key is not configured');
    if (!TOKEN.test(t)) throw new GrokBotWebhookError('invalid_token', 'Webhook key contains unsupported characters');
    return t;
  }

  function redact(msg, token) { return token ? String(msg).split(token).join('[REDACTED]') : String(msg); }

  async function sendDeliveryTest(testid) {
    if (!isValidTestId(testid)) throw new GrokBotWebhookError('invalid_testid', 'testid must be 1-100 ASCII letters, digits, underscore or hyphen');
    if (sent.has(testid)) throw new GrokBotWebhookError('duplicate_testid', 'This testid was already sent; not resending (single-use routine)');
    const token = resolveToken();
    const body = JSON.stringify({ testid });
    sent.add(testid); // reserve before sending: a timeout may still have started a run
    const client = target.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      const fail = (code, message, status) => reject(new GrokBotWebhookError(code, redact(message, token), status));
      let req;
      try {
        req = client.request({
          protocol: target.protocol,
          hostname: target.hostname.replace(/^\[|\]$/g, ''),
          port: target.port || undefined,
          path: target.pathname + target.search,
          method: 'POST',
          timeout,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            Accept: 'application/json',
            Authorization: 'Bearer ' + token,
          },
        }, (res) => {
          const status = res.statusCode;
          res.resume(); // discard body; never echo it
          res.on('end', () => {
            if (status >= 200 && status < 300) return resolve({ accepted: true, status, testid, meaning: RUN_ACCEPTED });
            if (status >= 300 && status < 400) return fail('redirect_refused', `Webhook at ${host} answered HTTP ${status} redirect; not followed`, status);
            if (status === 401 || status === 403) return fail('unauthorized', `Webhook at ${host} rejected the key (HTTP ${status})`, status);
            return fail('http_error', `Webhook at ${host} answered HTTP ${status}; no run started`, status);
          });
          res.on('error', () => fail('network_error', `Response from ${host} failed`));
        });
      } catch (e) { return fail('request_error', 'Request could not be built'); }
      req.on('timeout', () => { req.destroy(); fail('timeout', `No response from ${host} within ${timeout} ms; a run may or may not have started, not retrying`); });
      req.on('error', (e) => fail('network_error', `Could not reach ${host}${e && e.code ? ' (' + e.code + ')' : ''}`));
      req.end(body);
    });
  }

  return Object.freeze({ sendDeliveryTest, target: target.origin + target.pathname });
}

module.exports = { createGrokBotWebhookClient, GrokBotWebhookError, isValidTestId, RUN_ACCEPTED };
