/**
 * AI2AI Protocol — Message creation and HTTP transport
 * Handles envelope creation, signing, and sending.
 */

'use strict';

const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { requireConfig } = require('./config');
const { loadOrCreateKeys, signMessage, getFingerprint } = require('./crypto');

/**
 * Create a new AI2AI message envelope
 */
function createEnvelope({ to, type, intent, payload, conversationId }) {
  const config = requireConfig();
  const keys = loadOrCreateKeys();

  const envelope = {
    ai2ai: '0.1',
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    from: {
      agent: config.agentName,
      node: `${config.agentName}-node`,
      human: config.humanName,
    },
    to: to || { agent: 'unknown', node: 'unknown', human: 'unknown' },
    conversation: conversationId || crypto.randomUUID(),
    type,
    intent: intent || null,
    payload: payload || {},
    requires_human_approval: true,
  };

  envelope.signature = signMessage(envelope, keys.privateKey);
  return envelope;
}

/**
 * Create a ping envelope for handshaking
 */
function createPingEnvelope() {
  const config = requireConfig();
  const keys = loadOrCreateKeys();

  return createEnvelope({
    to: { agent: 'unknown', node: 'unknown', human: 'unknown' },
    type: 'ping',
    payload: {
      capabilities: [
        'schedule.meeting', 'schedule.call', 'message.relay',
        'info.request', 'info.share', 'social.introduction',
      ],
      languages: ['en'],
      timezone: config.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      model_info: 'local',
      protocol_versions: ['0.1'],
      public_key: keys.publicKey,
      fingerprint: getFingerprint(keys.publicKey),
    },
  });
}

/**
 * Send an HTTP request to an AI2AI endpoint
 * Returns a promise that resolves with the parsed JSON response.
 */
function sendRequest(endpoint, envelope) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint);
    const transport = url.protocol === 'https:' ? https : http;

    const body = JSON.stringify(envelope);

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-AI2AI-Version': '0.1',
      },
      timeout: 30000,
    };

    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(parsed.error || parsed.reason || `HTTP ${res.statusCode}`));
          } else {
            resolve(parsed);
          }
        } catch {
          reject(new Error(`Invalid response from server (HTTP ${res.statusCode})`));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Connection failed: ${err.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Connection timed out (30s)'));
    });

    req.write(body);
    req.end();
  });
}

/**
 * Fetch a URL via GET (for health checks etc.)
 */
function fetchGet(endpoint) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint);
    const transport = url.protocol === 'https:' ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'GET',
      timeout: 10000,
    };

    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', (err) => reject(new Error(`Connection failed: ${err.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error('Timed out')); });
    req.end();
  });
}

module.exports = {
  createEnvelope,
  createPingEnvelope,
  sendRequest,
  fetchGet,
};
