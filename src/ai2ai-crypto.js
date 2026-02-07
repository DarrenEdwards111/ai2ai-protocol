/**
 * AI2AI Crypto — Ed25519 signing and verification
 * Handles key generation, message signing, and signature verification.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEYS_DIR = path.join(__dirname, '.keys');

/**
 * Generate a new Ed25519 key pair for this agent
 */
function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

/**
 * Load or create key pair from disk
 */
function loadOrCreateKeys() {
  if (!fs.existsSync(KEYS_DIR)) {
    fs.mkdirSync(KEYS_DIR, { recursive: true });
  }

  const pubPath = path.join(KEYS_DIR, 'agent.pub');
  const privPath = path.join(KEYS_DIR, 'agent.key');

  if (fs.existsSync(pubPath) && fs.existsSync(privPath)) {
    return {
      publicKey: fs.readFileSync(pubPath, 'utf-8'),
      privateKey: fs.readFileSync(privPath, 'utf-8'),
    };
  }

  const keys = generateKeyPair();
  fs.writeFileSync(pubPath, keys.publicKey, { mode: 0o644 });
  fs.writeFileSync(privPath, keys.privateKey, { mode: 0o600 });
  return keys;
}

/**
 * Get the public key fingerprint (for human verification)
 */
function getFingerprint(publicKeyPem) {
  const hash = crypto.createHash('sha256').update(publicKeyPem).digest('hex');
  // Format as groups of 4 for readability
  return hash.match(/.{1,4}/g).slice(0, 8).join(':');
}

/**
 * Sign a message envelope
 */
function signMessage(envelope, privateKeyPem) {
  const payload = JSON.stringify({
    id: envelope.id,
    timestamp: envelope.timestamp,
    from: envelope.from,
    to: envelope.to,
    conversation: envelope.conversation,
    type: envelope.type,
    intent: envelope.intent,
    payload: envelope.payload,
  });

  const privateKey = crypto.createPrivateKey(privateKeyPem);
  return crypto.sign(null, Buffer.from(payload), privateKey).toString('base64');
}

/**
 * Verify a message signature
 */
function verifyMessage(envelope, signature, publicKeyPem) {
  const payload = JSON.stringify({
    id: envelope.id,
    timestamp: envelope.timestamp,
    from: envelope.from,
    to: envelope.to,
    conversation: envelope.conversation,
    type: envelope.type,
    intent: envelope.intent,
    payload: envelope.payload,
  });

  try {
    const publicKey = crypto.createPublicKey(publicKeyPem);
    return crypto.verify(null, Buffer.from(payload), publicKey, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}

module.exports = {
  generateKeyPair,
  loadOrCreateKeys,
  getFingerprint,
  signMessage,
  verifyMessage,
};
