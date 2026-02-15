/**
 * AI2AI Reliability Layer
 * 
 * Provides:
 * - Retry with exponential backoff
 * - Circuit breaker
 * - Message deduplication (idempotency keys)
 * - Delivery receipts
 * - Dead letter queue
 * - Persistent queue (disk-backed)
 * 
 * Zero external dependencies — Node.js built-ins only.
 * 
 * @author Mikoshi Ltd <mikoshiuk@gmail.com>
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

// ─── Retry with Exponential Backoff ─────────────────────────────────────────

/**
 * Retry a function with exponential backoff
 * @param {Function} fn - async function to retry
 * @param {object} opts
 * @param {number} [opts.maxRetries=3] - Max retries
 * @param {number} [opts.baseDelay=1000] - Base delay in ms
 * @param {number} [opts.maxDelay=30000] - Max delay in ms
 * @param {number} [opts.factor=2] - Backoff factor
 * @param {boolean} [opts.jitter=true] - Add random jitter
 * @returns {Promise<any>}
 */
async function retryWithBackoff(fn, opts = {}) {
  const maxRetries = opts.maxRetries ?? 3;
  const baseDelay = opts.baseDelay ?? 1000;
  const maxDelay = opts.maxDelay ?? 30000;
  const factor = opts.factor ?? 2;
  const jitter = opts.jitter !== false;

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt === maxRetries) break;
      let delay = Math.min(baseDelay * Math.pow(factor, attempt), maxDelay);
      if (jitter) delay = delay * (0.5 + Math.random() * 0.5);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}

// ─── Circuit Breaker ────────────────────────────────────────────────────────

const CIRCUIT_STATES = { CLOSED: 'closed', OPEN: 'open', HALF_OPEN: 'half-open' };

class CircuitBreaker extends EventEmitter {
  /**
   * @param {object} opts
   * @param {number} [opts.failureThreshold=5] - Failures before opening
   * @param {number} [opts.resetTimeout=60000] - Time before half-open (ms)
   * @param {number} [opts.halfOpenMax=1] - Max requests in half-open state
   */
  constructor(opts = {}) {
    super();
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.resetTimeout = opts.resetTimeout ?? 60000;
    this.halfOpenMax = opts.halfOpenMax ?? 1;
    this.state = CIRCUIT_STATES.CLOSED;
    this.failures = 0;
    this.halfOpenAttempts = 0;
    this.lastFailureTime = 0;
    this.successCount = 0;
  }

  /**
   * Execute a function through the circuit breaker
   * @param {Function} fn - async function to execute
   * @returns {Promise<any>}
   */
  async execute(fn) {
    if (this.state === CIRCUIT_STATES.OPEN) {
      if (Date.now() - this.lastFailureTime >= this.resetTimeout) {
        this.state = CIRCUIT_STATES.HALF_OPEN;
        this.halfOpenAttempts = 0;
        this.emit('half-open');
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    if (this.state === CIRCUIT_STATES.HALF_OPEN) {
      if (this.halfOpenAttempts >= this.halfOpenMax) {
        throw new Error('Circuit breaker is half-open, max attempts reached');
      }
      this.halfOpenAttempts++;
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure();
      throw err;
    }
  }

  _onSuccess() {
    this.failures = 0;
    this.successCount++;
    if (this.state !== CIRCUIT_STATES.CLOSED) {
      this.state = CIRCUIT_STATES.CLOSED;
      this.emit('closed');
    }
  }

  _onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.failureThreshold && this.state === CIRCUIT_STATES.CLOSED) {
      this.state = CIRCUIT_STATES.OPEN;
      this.emit('open');
    } else if (this.state === CIRCUIT_STATES.HALF_OPEN) {
      this.state = CIRCUIT_STATES.OPEN;
      this.emit('open');
    }
  }

  reset() {
    this.state = CIRCUIT_STATES.CLOSED;
    this.failures = 0;
    this.halfOpenAttempts = 0;
    this.emit('reset');
  }

  getState() {
    // Auto-transition from open to half-open if timeout passed
    if (this.state === CIRCUIT_STATES.OPEN && Date.now() - this.lastFailureTime >= this.resetTimeout) {
      return CIRCUIT_STATES.HALF_OPEN;
    }
    return this.state;
  }
}

// ─── Message Deduplication ──────────────────────────────────────────────────

class Deduplicator {
  /**
   * @param {object} opts
   * @param {number} [opts.ttl=3600000] - TTL for seen IDs (default 1 hour)
   * @param {number} [opts.maxSize=10000] - Max tracked IDs
   */
  constructor(opts = {}) {
    this.ttl = opts.ttl ?? 3600000;
    this.maxSize = opts.maxSize ?? 10000;
    this.seen = new Map(); // id → timestamp
  }

  /**
   * Check if a message ID has been seen. If not, mark it as seen.
   * @param {string} messageId
   * @returns {boolean} true if duplicate
   */
  isDuplicate(messageId) {
    this._cleanup();
    if (this.seen.has(messageId)) return true;
    this.seen.set(messageId, Date.now());
    return false;
  }

  /**
   * Generate an idempotency key for a message
   * @param {object} envelope
   * @returns {string}
   */
  static generateKey(envelope) {
    const data = `${envelope.from?.agent}:${envelope.to?.agent}:${envelope.type}:${envelope.intent}:${JSON.stringify(envelope.payload)}`;
    return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
  }

  _cleanup() {
    if (this.seen.size <= this.maxSize) return;
    const cutoff = Date.now() - this.ttl;
    for (const [id, ts] of this.seen) {
      if (ts < cutoff) this.seen.delete(id);
    }
  }

  clear() { this.seen.clear(); }
  get size() { return this.seen.size; }
}

// ─── Delivery Receipts ──────────────────────────────────────────────────────

const RECEIPT_STATUS = { SENT: 'sent', DELIVERED: 'delivered', READ: 'read', FAILED: 'failed' };

class DeliveryTracker extends EventEmitter {
  constructor() {
    super();
    this.receipts = new Map(); // messageId → { status, timestamps }
  }

  /**
   * Track a sent message
   * @param {string} messageId
   */
  trackSent(messageId) {
    this.receipts.set(messageId, {
      status: RECEIPT_STATUS.SENT,
      sentAt: new Date().toISOString(),
      deliveredAt: null,
      readAt: null,
    });
    this.emit('sent', messageId);
  }

  /**
   * Mark a message as delivered
   * @param {string} messageId
   */
  markDelivered(messageId) {
    const receipt = this.receipts.get(messageId);
    if (receipt) {
      receipt.status = RECEIPT_STATUS.DELIVERED;
      receipt.deliveredAt = new Date().toISOString();
      this.emit('delivered', messageId);
    }
  }

  /**
   * Mark a message as read
   * @param {string} messageId
   */
  markRead(messageId) {
    const receipt = this.receipts.get(messageId);
    if (receipt) {
      receipt.status = RECEIPT_STATUS.READ;
      receipt.readAt = new Date().toISOString();
      this.emit('read', messageId);
    }
  }

  /**
   * Mark a message as failed
   * @param {string} messageId
   * @param {string} error
   */
  markFailed(messageId, error) {
    const receipt = this.receipts.get(messageId) || {};
    receipt.status = RECEIPT_STATUS.FAILED;
    receipt.error = error;
    receipt.failedAt = new Date().toISOString();
    this.receipts.set(messageId, receipt);
    this.emit('failed', messageId, error);
  }

  /**
   * Create a receipt envelope to send back
   * @param {string} messageId
   * @param {string} status - sent/delivered/read
   * @returns {object}
   */
  static createReceiptPayload(messageId, status) {
    return {
      type: 'receipt',
      payload: {
        messageId,
        status,
        timestamp: new Date().toISOString(),
      },
    };
  }

  getReceipt(messageId) { return this.receipts.get(messageId) || null; }
  clear() { this.receipts.clear(); }
}

// ─── Dead Letter Queue ──────────────────────────────────────────────────────

class DeadLetterQueue {
  /**
   * @param {string} dir - Directory path for persistence
   */
  constructor(dir) {
    this.dir = dir || path.join(process.cwd(), '.ai2ai-dlq');
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
  }

  /**
   * Add a failed message to the DLQ
   * @param {object} envelope - The failed message
   * @param {string} error - Error description
   * @param {number} attempts - Number of delivery attempts
   */
  add(envelope, error, attempts) {
    const entry = {
      id: envelope.id || crypto.randomUUID(),
      envelope,
      error,
      attempts,
      failedAt: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(this.dir, `${entry.id}.json`),
      JSON.stringify(entry, null, 2)
    );
    return entry;
  }

  /**
   * List all DLQ entries
   * @returns {object[]}
   */
  list() {
    if (!fs.existsSync(this.dir)) return [];
    return fs.readdirSync(this.dir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf-8')); }
        catch { return null; }
      })
      .filter(Boolean);
  }

  /**
   * Remove an entry from the DLQ
   * @param {string} id
   */
  remove(id) {
    const p = path.join(this.dir, `${id}.json`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  /**
   * Retry all DLQ entries
   * @param {Function} sendFn - async function(endpoint, envelope)
   * @returns {Promise<{retried: number, succeeded: number}>}
   */
  async retryAll(sendFn) {
    const entries = this.list();
    let succeeded = 0;
    for (const entry of entries) {
      try {
        await sendFn(entry.envelope);
        this.remove(entry.id);
        succeeded++;
      } catch { /* still failed */ }
    }
    return { retried: entries.length, succeeded };
  }

  get size() { return this.list().length; }
}

// ─── Persistent Queue ───────────────────────────────────────────────────────

class PersistentQueue {
  /**
   * @param {string} dir - Directory for queue persistence
   */
  constructor(dir) {
    this.dir = dir || path.join(process.cwd(), '.ai2ai-queue');
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
  }

  /**
   * Enqueue a message
   * @param {object} envelope
   * @param {string} endpoint
   * @param {object} [opts] - { ttl, priority }
   * @returns {string} entry ID
   */
  enqueue(envelope, endpoint, opts = {}) {
    const id = envelope.id || crypto.randomUUID();
    const entry = {
      id,
      envelope,
      endpoint,
      priority: opts.priority || 0,
      ttl: opts.ttl || null,
      createdAt: new Date().toISOString(),
      expiresAt: opts.ttl ? new Date(Date.now() + opts.ttl).toISOString() : null,
      attempts: 0,
      lastAttempt: null,
      status: 'pending',
    };
    fs.writeFileSync(path.join(this.dir, `${id}.json`), JSON.stringify(entry, null, 2));
    return id;
  }

  /**
   * Get next pending entry
   * @returns {object|null}
   */
  dequeue() {
    const entries = this._loadAll().filter(e => e.status === 'pending');
    // Expire old entries
    const now = new Date();
    for (const e of entries) {
      if (e.expiresAt && new Date(e.expiresAt) < now) {
        e.status = 'expired';
        this._save(e);
      }
    }
    const valid = entries.filter(e => e.status === 'pending');
    valid.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    return valid[0] || null;
  }

  /**
   * Mark an entry as complete
   */
  complete(id) {
    const p = path.join(this.dir, `${id}.json`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  /**
   * Mark an entry as failed
   */
  fail(id, error) {
    const entry = this.load(id);
    if (entry) {
      entry.attempts++;
      entry.lastAttempt = new Date().toISOString();
      entry.lastError = error;
      this._save(entry);
    }
  }

  load(id) {
    const p = path.join(this.dir, `${id}.json`);
    if (!fs.existsSync(p)) return null;
    try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
  }

  list() { return this._loadAll(); }
  get size() { return this._loadAll().length; }

  _loadAll() {
    if (!fs.existsSync(this.dir)) return [];
    return fs.readdirSync(this.dir)
      .filter(f => f.endsWith('.json'))
      .map(f => { try { return JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf-8')); } catch { return null; } })
      .filter(Boolean);
  }

  _save(entry) {
    fs.writeFileSync(path.join(this.dir, `${entry.id}.json`), JSON.stringify(entry, null, 2));
  }
}

module.exports = {
  retryWithBackoff,
  CircuitBreaker,
  CIRCUIT_STATES,
  Deduplicator,
  DeliveryTracker,
  RECEIPT_STATUS,
  DeadLetterQueue,
  PersistentQueue,
};
