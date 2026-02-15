/**
 * AI2AI Production Client Library
 * 
 * Clean, simple API for agent-to-agent communication.
 * 
 * Usage:
 *   const { AI2AI } = require('ai2ai-protocol');
 *   const agent = new AI2AI({ name: 'my-agent', keyPath: './.keys' });
 *   await agent.start(18800);
 *   await agent.register('http://registry:18820');
 *   agent.on('message', (msg, from) => console.log(from, msg));
 *   await agent.send('other-agent', 'Hello!');
 *   const result = await agent.request('other-agent', 'schedule.meeting', { subject: 'Lunch' });
 * 
 * Zero external dependencies — Node.js built-ins only.
 * 
 * @author Mikoshi Ltd <mikoshiuk@gmail.com>
 */

const { EventEmitter } = require('events');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { retryWithBackoff, CircuitBreaker, Deduplicator, DeliveryTracker, DeadLetterQueue, PersistentQueue } = require('./reliability');
const { RateLimiter, NonceTracker, isMessageExpired, isMessageTTLExpired, Blocklist } = require('./security');
const { RegistryClient } = require('./registry');

class AI2AI extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.name - Agent ID/name
   * @param {string} [opts.keyPath] - Path to key directory
   * @param {string} [opts.humanName] - Human operator name
   * @param {string} [opts.registry] - Registry URL
   * @param {number} [opts.port=18800] - Server port
   * @param {number} [opts.timeout=30000] - Default request timeout
   * @param {number} [opts.messageTTL=86400000] - Default message TTL (24h)
   * @param {string} [opts.dataDir] - Data directory for queues/DLQ
   */
  constructor(opts = {}) {
    super();
    this.name = opts.name || 'ai2ai-agent';
    this.humanName = opts.humanName || 'Human';
    this.port = opts.port || 18800;
    this.timeout = opts.timeout || 30000;
    this.messageTTL = opts.messageTTL || 86400000;
    this.dataDir = opts.dataDir || path.join(process.cwd(), '.ai2ai-data');

    // Key management
    this.keyPath = opts.keyPath || path.join(this.dataDir, '.keys');
    if (!fs.existsSync(this.keyPath)) fs.mkdirSync(this.keyPath, { recursive: true });
    this._keys = this._loadOrCreateKeys();

    // Reliability
    this.deduplicator = new Deduplicator();
    this.deliveryTracker = new DeliveryTracker();
    this.dlq = new DeadLetterQueue(path.join(this.dataDir, 'dlq'));
    this.queue = new PersistentQueue(path.join(this.dataDir, 'queue'));
    this.circuits = new Map(); // endpoint → CircuitBreaker

    // Security
    this.rateLimiter = new RateLimiter({ maxRequests: opts.rateLimit || 20 });
    this.nonceTracker = new NonceTracker();
    this.blocklist = new Blocklist(path.join(this.dataDir, 'blocklist.json'));

    // Registry
    this.registryClient = opts.registry ? new RegistryClient({
      registryUrl: opts.registry,
      agentId: this.name,
    }) : null;

    // Contacts: agentId → { endpoint, publicKey, ... }
    this.contacts = new Map();

    // Server
    this.server = null;
    this._started = false;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Start the agent (HTTP server)
   * @param {number} [port]
   * @returns {Promise<void>}
   */
  async start(port) {
    if (port) this.port = port;
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => this._handleRequest(req, res));
      this.server.listen(this.port, () => {
        this._started = true;
        this.emit('started', { port: this.port });
        resolve();
      });
    });
  }

  /**
   * Stop the agent
   */
  async stop() {
    if (this.registryClient) {
      try { await this.registryClient.deregister(); } catch { /* ignore */ }
      this.registryClient.destroy();
    }
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          this._started = false;
          this.emit('stopped');
          resolve();
        });
      });
    }
  }

  // ─── Registration ───────────────────────────────────────────────────────

  /**
   * Register with a registry server
   * @param {string} [registryUrl] - Override registry URL
   * @returns {Promise<object>}
   */
  async register(registryUrl) {
    if (registryUrl) {
      this.registryClient = new RegistryClient({ registryUrl, agentId: this.name });
    }
    if (!this.registryClient) throw new Error('No registry URL configured');

    return this.registryClient.register({
      endpoint: `http://localhost:${this.port}/ai2ai`,
      name: this.name,
      humanName: this.humanName,
      publicKey: this._keys.publicKey,
      capabilities: ['message.relay', 'info.request', 'schedule.meeting'],
    });
  }

  // ─── Messaging ──────────────────────────────────────────────────────────

  /**
   * Send a message to another agent
   * @param {string} targetId - Target agent ID
   * @param {string|object} message - Message content
   * @param {object} [opts] - { ttl, priority }
   * @returns {Promise<object>}
   */
  async send(targetId, message, opts = {}) {
    const envelope = this._createEnvelope(targetId, 'message', 'message.relay', {
      message: typeof message === 'string' ? message : message,
      urgency: opts.urgency || 'normal',
    }, opts);

    return this._deliver(targetId, envelope);
  }

  /**
   * Send a request to another agent
   * @param {string} targetId - Target agent ID
   * @param {string} intent - Intent type
   * @param {object} payload - Request payload
   * @param {object} [opts] - { ttl, timeout }
   * @returns {Promise<object>}
   */
  async request(targetId, intent, payload, opts = {}) {
    const envelope = this._createEnvelope(targetId, 'request', intent, payload, opts);
    return this._deliver(targetId, envelope);
  }

  /**
   * Discover agents matching a query
   * @param {object} query - { capability, name }
   * @returns {Promise<object[]>}
   */
  async discover(query = {}) {
    if (!this.registryClient) throw new Error('No registry configured');
    return this.registryClient.search(query);
  }

  // ─── Contact Management ─────────────────────────────────────────────────

  /**
   * Add or update a contact
   * @param {string} agentId
   * @param {object} info - { endpoint, publicKey, humanName }
   */
  addContact(agentId, info) {
    this.contacts.set(agentId, { ...this.contacts.get(agentId), ...info, updatedAt: new Date().toISOString() });
  }

  /**
   * Get a contact
   * @param {string} agentId
   * @returns {object|null}
   */
  getContact(agentId) {
    return this.contacts.get(agentId) || null;
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  _createEnvelope(targetId, type, intent, payload, opts = {}) {
    const envelope = {
      ai2ai: '1.0',
      id: crypto.randomUUID(),
      nonce: this.nonceTracker.generate(),
      timestamp: new Date().toISOString(),
      from: { agent: this.name, human: this.humanName },
      to: { agent: targetId },
      conversation: opts.conversationId || crypto.randomUUID(),
      type,
      intent,
      payload: payload || {},
      requires_human_approval: opts.requiresApproval !== false,
    };

    if (opts.ttl || this.messageTTL) {
      envelope.expiresAt = new Date(Date.now() + (opts.ttl || this.messageTTL)).toISOString();
    }

    // Sign
    envelope.signature = this._sign(envelope);
    return envelope;
  }

  async _deliver(targetId, envelope) {
    // Resolve endpoint
    let endpoint = this.contacts.get(targetId)?.endpoint;
    if (!endpoint && this.registryClient) {
      const resolved = await this.registryClient.resolve(targetId);
      if (resolved?.endpoint) {
        endpoint = resolved.endpoint;
        this.addContact(targetId, { endpoint: resolved.endpoint, publicKey: resolved.publicKey });
      }
    }
    if (!endpoint) throw new Error(`Cannot resolve endpoint for ${targetId}`);

    // Check blocklist
    if (this.blocklist.isBlocked(targetId)) throw new Error(`Agent ${targetId} is blocked`);

    // Circuit breaker
    let circuit = this.circuits.get(endpoint);
    if (!circuit) {
      circuit = new CircuitBreaker({ failureThreshold: 5, resetTimeout: 60000 });
      this.circuits.set(endpoint, circuit);
    }

    // Track delivery
    this.deliveryTracker.trackSent(envelope.id);

    try {
      const result = await circuit.execute(() =>
        retryWithBackoff(() => this._rawSend(endpoint, envelope), {
          maxRetries: 3, baseDelay: 1000, factor: 2,
        })
      );
      this.deliveryTracker.markDelivered(envelope.id);
      return result;
    } catch (err) {
      this.deliveryTracker.markFailed(envelope.id, err.message);
      // Queue for later
      this.queue.enqueue(envelope, endpoint, { ttl: this.messageTTL });
      return { status: 'queued', id: envelope.id, error: err.message };
    }
  }

  async _rawSend(endpoint, envelope) {
    return new Promise((resolve, reject) => {
      const url = new URL(endpoint);
      const body = JSON.stringify(envelope);
      const opts = {
        method: 'POST',
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'X-AI2AI-Version': '1.0',
        },
        timeout: this.timeout,
      };

      const req = http.request(opts, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(data)); } catch { resolve(data); }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      req.write(body);
      req.end();
    });
  }

  async _handleRequest(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-AI2AI-Version');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (req.method === 'GET' && req.url === '/ai2ai/health') {
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'online', agent: this.name, protocol: '1.0' }));
      return;
    }

    if (req.method !== 'POST' || !req.url.startsWith('/ai2ai')) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 102400) { res.writeHead(413); res.end('{}'); return; } }

    let envelope;
    try { envelope = JSON.parse(body); } catch { res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid JSON' })); return; }

    if (!envelope.ai2ai || !envelope.type || !envelope.from) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Invalid AI2AI envelope' }));
      return;
    }

    const fromAgent = envelope.from?.agent;

    // Security checks
    if (this.blocklist.isBlocked(fromAgent)) {
      res.writeHead(403);
      res.end(JSON.stringify({ status: 'rejected', reason: 'blocked' }));
      return;
    }

    if (!this.rateLimiter.allow(fromAgent)) {
      res.writeHead(429);
      res.end(JSON.stringify({ status: 'rejected', reason: 'rate_limited' }));
      return;
    }

    if (isMessageExpired(envelope, this.messageTTL)) {
      res.writeHead(400);
      res.end(JSON.stringify({ status: 'rejected', reason: 'message_expired' }));
      return;
    }

    if (envelope.nonce && this.nonceTracker.isReplay(envelope.nonce)) {
      res.writeHead(400);
      res.end(JSON.stringify({ status: 'rejected', reason: 'replay_detected' }));
      return;
    }

    // Deduplication
    if (this.deduplicator.isDuplicate(envelope.id)) {
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'duplicate', id: envelope.id }));
      return;
    }

    // Emit events
    if (envelope.type === 'message' || envelope.type === 'request') {
      this.emit('message', envelope.payload, envelope.from, envelope);
    }
    if (envelope.type === 'request') {
      this.emit('request', envelope.intent, envelope.payload, envelope.from, envelope);
    }
    if (envelope.type === 'receipt') {
      const { messageId, status } = envelope.payload || {};
      if (messageId && status === 'delivered') this.deliveryTracker.markDelivered(messageId);
      if (messageId && status === 'read') this.deliveryTracker.markRead(messageId);
      this.emit('receipt', envelope.payload, envelope.from);
    }

    // Send delivery receipt back
    if (envelope.type !== 'receipt') {
      this.emit('receipt:send', envelope.id, envelope.from);
    }

    res.writeHead(200);
    res.end(JSON.stringify({
      status: 'ok',
      id: envelope.id,
      agent: this.name,
    }));
  }

  _loadOrCreateKeys() {
    const pubPath = path.join(this.keyPath, 'agent.pub');
    const privPath = path.join(this.keyPath, 'agent.key');

    if (fs.existsSync(pubPath) && fs.existsSync(privPath)) {
      return {
        publicKey: fs.readFileSync(pubPath, 'utf-8'),
        privateKey: fs.readFileSync(privPath, 'utf-8'),
      };
    }

    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    fs.writeFileSync(pubPath, publicKey, { mode: 0o644 });
    fs.writeFileSync(privPath, privateKey, { mode: 0o600 });
    return { publicKey, privateKey };
  }

  _sign(envelope) {
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
    const privateKey = crypto.createPrivateKey(this._keys.privateKey);
    return crypto.sign(null, Buffer.from(payload), privateKey).toString('base64');
  }
}

module.exports = { AI2AI };
