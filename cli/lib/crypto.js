/**
 * AI2AI Crypto — Ed25519 signing, verification, and key management
 * Zero external dependencies — uses only Node.js built-in crypto module.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { KEYS_DIR, ensureDirs } = require('./config');

/**
 * Generate a new Ed25519 key pair
 */
function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

/**
 * Load keys from ~/.ai2ai/keys/
 */
function loadKeys() {
  const pubPath = path.join(KEYS_DIR, 'agent.pub');
  const privPath = path.join(KEYS_DIR, 'agent.key');

  if (!fs.existsSync(pubPath) || !fs.existsSync(privPath)) {
    return null;
  }

  return {
    publicKey: fs.readFileSync(pubPath, 'utf-8'),
    privateKey: fs.readFileSync(privPath, 'utf-8'),
  };
}

/**
 * Save keys to ~/.ai2ai/keys/
 */
function saveKeys(keys) {
  ensureDirs();
  const pubPath = path.join(KEYS_DIR, 'agent.pub');
  const privPath = path.join(KEYS_DIR, 'agent.key');

  fs.writeFileSync(pubPath, keys.publicKey, { mode: 0o644 });
  fs.writeFileSync(privPath, keys.privateKey, { mode: 0o600 });
}

/**
 * Load or create keys
 */
function loadOrCreateKeys() {
  let keys = loadKeys();
  if (!keys) {
    keys = generateKeyPair();
    saveKeys(keys);
  }
  return keys;
}

/**
 * Get a human-readable fingerprint of a public key
 */
function getFingerprint(publicKeyPem) {
  const hash = crypto.createHash('sha256').update(publicKeyPem).digest('hex');
  return hash.match(/.{1,4}/g).slice(0, 8).join(':');
}

/**
 * Sign a message envelope
 * Signs the canonical fields to produce a deterministic signature.
 */
function signMessage(envelope, privateKeyPem) { return require('./wire').sign(envelope, privateKeyPem); }
function verifyMessage(envelope, signature, publicKeyPem) { return require('./wire').verify(envelope, signature, publicKeyPem); }

module.exports = {
  generateKeyPair,
  loadKeys,
  saveKeys,
  loadOrCreateKeys,
  getFingerprint,
  signMessage,
  verifyMessage,
};
