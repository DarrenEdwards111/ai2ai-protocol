/**
 * AI2AI Security — Hardened security layer
 * 
 * Provides:
 * - Key rotation with announcement
 * - Rate limiting (per-agent, per-endpoint)
 * - Message expiry (TTL enforcement)
 * - Agent blocklist
 * - Signature verification caching
 * - Nonce tracking (replay attack prevention)
 * 
 * Zero external dependencies — Node.js built-ins only.
 * 
 * @author Mikoshi Ltd <mikoshiuk@gmail.com>
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ─── Key Rotation ───────────────────────────────────────────────────────────

class KeyRotation {
  /**
   * @param {object} opts
   * @param {string} opts.keysDir - Directory containing keys
   * @param {Function} opts.generateKeyPair - Function to generate new keypair
   * @param {number} [opts.rotationIntervalMs=86400000*30] - Rotation interval (default 30 days)
   */
  constructor(opts) {
    this.keysDir = opts.keysDir;
    this.generateKeyPair = opts.generateKeyPair;
    this.rotationInterval = opts.rotationIntervalMs || 86400000 * 30;
    this.metaPath = path.join(this.keysDir, 'rotation-meta.json');
    this.previousKeys = [];
  }

  /**
   * Check if key rotation is needed
   * @returns {boolean}
   */
  needsRotation() {
    const meta = this._loadMeta();
    if (!meta.lastRotation) return false; // Never rotated, use initial keys
    return Date.now() - new Date(meta.lastRotation).getTime() > this.rotationInterval;
  }

  /**
   * Rotate keys — generates new keypair, archives old one
   * @returns {{ publicKey: string, privateKey: string, previousPublicKey: string }}
   */
  rotate() {
    const meta = this._loadMeta();
    
    // Archive current key
    const pubPath = path.join(this.keysDir, 'agent.pub');
    if (fs.existsSync(pubPath)) {
      const currentPub = fs.readFileSync(pubPath, 'utf-8');
      meta.previousKeys = meta.previousKeys || [];
      meta.previousKeys.push({
        publicKey: currentPub,
        retiredAt: new Date().toISOString(),
      });
      // Keep only last 3 keys
      if (meta.previousKeys.length > 3) {
        meta.previousKeys = meta.previousKeys.slice(-3);
      }
    }

    // Generate new keys
    const newKeys = this.generateKeyPair();
    fs.writeFileSync(pubPath, newKeys.publicKey, { mode: 0o644 });
    fs.writeFileSync(path.join(this.keysDir, 'agent.key'), newKeys.privateKey, { mode: 0o600 });

    meta.lastRotation = new Date().toISOString();
    this._saveMeta(meta);

    return {
      publicKey: newKeys.publicKey,
      privateKey: newKeys.privateKey,
      previousPublicKey: meta.previousKeys.length > 0
        ? meta.previousKeys[meta.previousKeys.length - 1].publicKey
        : null,
    };
  }

  /**
   * Create a key rotation announcement envelope payload
   * @param {string} newPublicKey
   * @param {string} oldPrivateKey - Sign with old key to prove ownership
   * @returns {object}
   */
  createAnnouncement(newPublicKey, oldPublicKey) {
    return {
      type: 'key_rotation',
      payload: {
        newPublicKey,
        previousPublicKey: oldPublicKey,
        rotatedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Get previous public keys (for verifying messages signed with old keys)
   * @returns {string[]}
   */
  getPreviousKeys() {
    const meta = this._loadMeta();
    return (meta.previousKeys || []).map(k => k.publicKey);
  }

  _loadMeta() {
    if (!fs.existsSync(this.metaPath)) return { previousKeys: [] };
    try { return JSON.parse(fs.readFileSync(this.metaPath, 'utf-8')); }
    catch { return { previousKeys: [] }; }
  }

  _saveMeta(meta) {
    fs.writeFileSync(this.metaPath, JSON.stringify(meta, null, 2));
  }
}

// ─── Rate Limiter ───────────────────────────────────────────────────────────

class RateLimiter {
  /**
   * @param {object} opts
   * @param {number} [opts.maxRequests=20] - Max requests per window
   * @param {number} [opts.windowMs=60000] - Window size in ms
   */
  constructor(opts = {}) {
    this.maxRequests = opts.maxRequests ?? 20;
    this.windowMs = opts.windowMs ?? 60000;
    this.windows = new Map(); // key → timestamp[]
  }

  /**
   * Check if a request is allowed
   * @param {string} key - Rate limit key (e.g., agentId or endpoint)
   * @returns {boolean} true if allowed
   */
  allow(key) {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    let timestamps = this.windows.get(key) || [];
    timestamps = timestamps.filter(t => t > cutoff);

    if (timestamps.length >= this.maxRequests) {
      this.windows.set(key, timestamps);
      return false;
    }

    timestamps.push(now);
    this.windows.set(key, timestamps);
    return true;
  }

  /**
   * Get remaining requests for a key
   * @param {string} key
   * @returns {number}
   */
  remaining(key) {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const timestamps = (this.windows.get(key) || []).filter(t => t > cutoff);
    return Math.max(0, this.maxRequests - timestamps.length);
  }

  /**
   * Reset a specific key
   */
  reset(key) { this.windows.delete(key); }

  /**
   * Clear all rate limit state
   */
  clear() { this.windows.clear(); }
}

// ─── Message Expiry ─────────────────────────────────────────────────────────

/**
 * Check if a message has expired
 * @param {object} envelope - Message envelope with timestamp
 * @param {number} [maxAgeMs=86400000] - Max age in ms (default 24 hours)
 * @returns {boolean} true if expired
 */
function isMessageExpired(envelope, maxAgeMs = 86400000) {
  if (!envelope.timestamp) return false;
  const messageTime = new Date(envelope.timestamp).getTime();
  if (isNaN(messageTime)) return false;
  return Date.now() - messageTime > maxAgeMs;
}

/**
 * Add TTL to an envelope
 * @param {object} envelope
 * @param {number} ttlMs - Time-to-live in ms
 * @returns {object} envelope with expiresAt field
 */
function addMessageTTL(envelope, ttlMs) {
  envelope.expiresAt = new Date(Date.now() + ttlMs).toISOString();
  return envelope;
}

/**
 * Check if a message TTL has been exceeded
 * @param {object} envelope
 * @returns {boolean}
 */
function isMessageTTLExpired(envelope) {
  if (!envelope.expiresAt) return false;
  return new Date() > new Date(envelope.expiresAt);
}

// ─── Agent Blocklist ────────────────────────────────────────────────────────

class Blocklist {
  /**
   * @param {string} [filePath] - Path to persist blocklist
   */
  constructor(filePath) {
    this.filePath = filePath;
    this.blocked = new Set();
    this._load();
  }

  /**
   * Block an agent
   * @param {string} agentId
   */
  block(agentId) {
    this.blocked.add(agentId);
    this._save();
  }

  /**
   * Unblock an agent
   * @param {string} agentId
   */
  unblock(agentId) {
    this.blocked.delete(agentId);
    this._save();
  }

  /**
   * Check if an agent is blocked
   * @param {string} agentId
   * @returns {boolean}
   */
  isBlocked(agentId) {
    return this.blocked.has(agentId);
  }

  /**
   * Get all blocked agents
   * @returns {string[]}
   */
  list() { return Array.from(this.blocked); }

  _load() {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      this.blocked = new Set(data);
    } catch { /* ignore */ }
  }

  _save() {
    if (!this.filePath) return;
    fs.writeFileSync(this.filePath, JSON.stringify(Array.from(this.blocked), null, 2));
  }
}

// ─── Signature Verification Cache ───────────────────────────────────────────

class VerificationCache {
  /**
   * @param {object} opts
   * @param {number} [opts.maxSize=1000] - Max cached entries
   * @param {number} [opts.ttl=300000] - Cache TTL in ms (default 5 min)
   */
  constructor(opts = {}) {
    this.maxSize = opts.maxSize ?? 1000;
    this.ttl = opts.ttl ?? 300000;
    this.cache = new Map(); // hash → { valid, timestamp }
  }

  /**
   * Get cached verification result
   * @param {string} signature
   * @param {string} publicKey
   * @returns {boolean|null} null if not cached
   */
  get(signature, publicKey) {
    const key = this._key(signature, publicKey);
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }
    return entry.valid;
  }

  /**
   * Cache a verification result
   * @param {string} signature
   * @param {string} publicKey
   * @param {boolean} valid
   */
  set(signature, publicKey, valid) {
    if (this.cache.size >= this.maxSize) {
      // Remove oldest entry
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(this._key(signature, publicKey), { valid, timestamp: Date.now() });
  }

  _key(sig, pub) {
    return crypto.createHash('sha256').update(sig + pub).digest('hex').substring(0, 32);
  }

  clear() { this.cache.clear(); }
  get size() { return this.cache.size; }
}

// ─── Nonce Tracking (Replay Prevention) ─────────────────────────────────────

class NonceTracker {
  /**
   * @param {object} opts
   * @param {number} [opts.maxAge=3600000] - Max nonce age (default 1 hour)
   * @param {number} [opts.maxSize=10000] - Max tracked nonces
   */
  constructor(opts = {}) {
    this.maxAge = opts.maxAge ?? 3600000;
    this.maxSize = opts.maxSize ?? 10000;
    this.nonces = new Map(); // nonce → timestamp
  }

  /**
   * Generate a unique nonce
   * @returns {string}
   */
  generate() {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Check if a nonce has been used. If not, mark it as used.
   * @param {string} nonce
   * @returns {boolean} true if nonce was already used (replay attack)
   */
  isReplay(nonce) {
    this._cleanup();
    if (this.nonces.has(nonce)) return true;
    this.nonces.set(nonce, Date.now());
    return false;
  }

  _cleanup() {
    if (this.nonces.size <= this.maxSize) return;
    const cutoff = Date.now() - this.maxAge;
    for (const [nonce, ts] of this.nonces) {
      if (ts < cutoff) this.nonces.delete(nonce);
    }
  }

  clear() { this.nonces.clear(); }
  get size() { return this.nonces.size; }
}

module.exports = {
  KeyRotation,
  RateLimiter,
  isMessageExpired,
  addMessageTTL,
  isMessageTTLExpired,
  Blocklist,
  VerificationCache,
  NonceTracker,
};
