/**
 * AI2AI Registry — Agent discovery and registration
 * 
 * Provides:
 * - Central registry client (register, search, resolve)
 * - DNS TXT record discovery (_ai2ai.<domain>)
 * - mDNS/Bonjour for local network discovery
 * - Heartbeat/keepalive
 * 
 * Zero external dependencies — Node.js built-ins only.
 * 
 * @author Mikoshi Ltd <mikoshiuk@gmail.com>
 */

const http = require('http');
const https = require('https');
const dgram = require('dgram');
const dns = require('dns');
const crypto = require('crypto');
const { EventEmitter } = require('events');

// ─── Registry Client ────────────────────────────────────────────────────────

class RegistryClient extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.registryUrl - Base URL of the registry server
   * @param {string} opts.agentId - This agent's unique ID
   * @param {number} [opts.heartbeatInterval=30000] - Heartbeat interval in ms
   * @param {number} [opts.timeout=10000] - HTTP request timeout in ms
   */
  constructor(opts = {}) {
    super();
    this.registryUrl = opts.registryUrl;
    this.agentId = opts.agentId;
    this.heartbeatInterval = opts.heartbeatInterval || 30000;
    this.timeout = opts.timeout || 10000;
    this._heartbeatTimer = null;
    this._registered = false;
  }

  /**
   * Register this agent with the registry
   * @param {object} agentInfo - { endpoint, name, humanName, publicKey, capabilities, metadata }
   * @returns {Promise<object>}
   */
  async register(agentInfo) {
    const body = {
      id: this.agentId,
      endpoint: agentInfo.endpoint,
      name: agentInfo.name || this.agentId,
      humanName: agentInfo.humanName,
      publicKey: agentInfo.publicKey,
      capabilities: agentInfo.capabilities || [],
      metadata: agentInfo.metadata || {},
      registeredAt: new Date().toISOString(),
    };

    const result = await this._request('POST', '/agents', body);
    this._registered = true;
    this._startHeartbeat(agentInfo);
    this.emit('registered', result);
    return result;
  }

  /**
   * Search for agents matching a query
   * @param {object} query - { capability, name, metadata }
   * @returns {Promise<object[]>}
   */
  async search(query = {}) {
    const params = new URLSearchParams();
    if (query.capability) params.set('capability', query.capability);
    if (query.name) params.set('name', query.name);
    if (query.metadata) params.set('metadata', JSON.stringify(query.metadata));
    const qs = params.toString();
    return this._request('GET', `/agents${qs ? '?' + qs : ''}`);
  }

  /**
   * Resolve a specific agent by ID
   * @param {string} agentId
   * @returns {Promise<object|null>}
   */
  async resolve(agentId) {
    try {
      return await this._request('GET', `/agents/${encodeURIComponent(agentId)}`);
    } catch {
      return null;
    }
  }

  /**
   * Deregister this agent
   * @returns {Promise<object>}
   */
  async deregister() {
    this._stopHeartbeat();
    this._registered = false;
    return this._request('DELETE', `/agents/${encodeURIComponent(this.agentId)}`);
  }

  /**
   * Send heartbeat to prove agent is online
   */
  async heartbeat() {
    return this._request('POST', `/agents/${encodeURIComponent(this.agentId)}/heartbeat`, {
      timestamp: new Date().toISOString(),
    });
  }

  _startHeartbeat(agentInfo) {
    this._stopHeartbeat();
    this._heartbeatTimer = setInterval(async () => {
      try {
        await this.heartbeat();
        this.emit('heartbeat');
      } catch (err) {
        this.emit('heartbeat-error', err);
        // Try re-registering
        try { await this.register(agentInfo); } catch { /* ignore */ }
      }
    }, this.heartbeatInterval);
    if (this._heartbeatTimer.unref) this._heartbeatTimer.unref();
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  /**
   * Make an HTTP request to the registry
   */
  async _request(method, path, body) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.registryUrl);
      const client = url.protocol === 'https:' ? https : http;

      const opts = {
        method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: { 'Content-Type': 'application/json', 'X-AI2AI-Agent': this.agentId },
        timeout: this.timeout,
      };

      const req = client.request(opts, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(parsed);
            } else {
              reject(new Error(`Registry ${res.statusCode}: ${parsed.error || data}`));
            }
          } catch {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(data);
            } else {
              reject(new Error(`Registry ${res.statusCode}: ${data}`));
            }
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Registry request timeout')); });

      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  destroy() {
    this._stopHeartbeat();
    this.removeAllListeners();
  }
}

// ─── Registry Server (minimal, embeddable) ──────────────────────────────────

class RegistryServer {
  constructor(opts = {}) {
    this.agents = new Map(); // agentId → agentInfo
    this.staleTimeout = opts.staleTimeout || 120000; // 2 minutes
    this.server = null;
  }

  /**
   * Start the registry HTTP server
   * @param {number} port
   * @returns {Promise<http.Server>}
   */
  start(port = 18820) {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => this._handleRequest(req, res));
      this.server.listen(port, () => {
        this._cleanupTimer = setInterval(() => this._cleanupStale(), this.staleTimeout);
        if (this._cleanupTimer.unref) this._cleanupTimer.unref();
        resolve(this.server);
      });
    });
  }

  stop() {
    if (this._cleanupTimer) clearInterval(this._cleanupTimer);
    if (this.server) this.server.close();
  }

  async _handleRequest(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-AI2AI-Agent');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathParts = url.pathname.split('/').filter(Boolean);

    try {
      // POST /agents — register
      if (req.method === 'POST' && pathParts.length === 1 && pathParts[0] === 'agents') {
        const body = await this._readBody(req);
        if (!body.id || !body.endpoint) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Missing id or endpoint' }));
          return;
        }
        body.lastHeartbeat = new Date().toISOString();
        this.agents.set(body.id, body);
        res.writeHead(201);
        res.end(JSON.stringify({ status: 'registered', id: body.id }));
        return;
      }

      // POST /agents/:id/heartbeat
      if (req.method === 'POST' && pathParts.length === 3 && pathParts[0] === 'agents' && pathParts[2] === 'heartbeat') {
        const id = decodeURIComponent(pathParts[1]);
        const agent = this.agents.get(id);
        if (!agent) { res.writeHead(404); res.end(JSON.stringify({ error: 'Agent not found' })); return; }
        agent.lastHeartbeat = new Date().toISOString();
        this.agents.set(id, agent);
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      // GET /agents — search
      if (req.method === 'GET' && pathParts.length === 1 && pathParts[0] === 'agents') {
        const capability = url.searchParams.get('capability');
        const name = url.searchParams.get('name');
        let results = Array.from(this.agents.values());
        if (capability) results = results.filter(a => a.capabilities && a.capabilities.includes(capability));
        if (name) results = results.filter(a => (a.name || a.id).toLowerCase().includes(name.toLowerCase()));
        res.writeHead(200);
        res.end(JSON.stringify(results));
        return;
      }

      // GET /agents/:id — resolve
      if (req.method === 'GET' && pathParts.length === 2 && pathParts[0] === 'agents') {
        const id = decodeURIComponent(pathParts[1]);
        const agent = this.agents.get(id);
        if (!agent) { res.writeHead(404); res.end(JSON.stringify({ error: 'Agent not found' })); return; }
        res.writeHead(200);
        res.end(JSON.stringify(agent));
        return;
      }

      // DELETE /agents/:id — deregister
      if (req.method === 'DELETE' && pathParts.length === 2 && pathParts[0] === 'agents') {
        const id = decodeURIComponent(pathParts[1]);
        this.agents.delete(id);
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'deregistered', id }));
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
  }

  async _readBody(req) {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => { data += chunk; if (data.length > 102400) reject(new Error('Too large')); });
      req.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON')); } });
      req.on('error', reject);
    });
  }

  _cleanupStale() {
    const cutoff = Date.now() - this.staleTimeout;
    for (const [id, agent] of this.agents) {
      if (new Date(agent.lastHeartbeat).getTime() < cutoff) {
        this.agents.delete(id);
      }
    }
  }
}

// ─── DNS TXT Discovery ─────────────────────────────────────────────────────

/**
 * Discover an AI2AI agent endpoint via DNS TXT record
 * Looks for _ai2ai.<domain> TXT record with content: endpoint=<url>
 * 
 * @param {string} domain
 * @returns {Promise<string|null>} endpoint URL or null
 */
function discoverDns(domain) {
  return new Promise((resolve) => {
    dns.resolveTxt(`_ai2ai.${domain}`, (err, records) => {
      if (err) { resolve(null); return; }
      for (const record of records) {
        const joined = record.join('');
        const match = joined.match(/^endpoint=(.+)$/) || joined.match(/^ai2ai=(.+)$/);
        if (match) { resolve(match[1].trim()); return; }
      }
      resolve(null);
    });
  });
}

// ─── mDNS/Bonjour Local Discovery ──────────────────────────────────────────

const MDNS_ADDR = '224.0.0.251';
const MDNS_PORT = 5353;

/**
 * Start mDNS discovery for local AI2AI agents
 * @param {Function} onDiscovered - callback({ agentId, endpoint, humanName, host, port })
 * @returns {{ stop, announce, query, getDiscovered }}
 */
function startLocalDiscovery(onDiscovered) {
  const discovered = new Map();
  let socket;

  try {
    socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  } catch {
    return { stop() {}, announce() {}, query() {}, getDiscovered() { return []; } };
  }

  socket.on('message', (msg, rinfo) => {
    try {
      const msgStr = msg.toString('utf-8');
      const portMatch = msgStr.match(/ai2ai-port=(\d+)/);
      const agentMatch = msgStr.match(/ai2ai-agent=([^\0]+)/);
      const humanMatch = msgStr.match(/ai2ai-human=([^\0]+)/);
      if (portMatch) {
        const info = {
          agentId: agentMatch ? agentMatch[1] : 'unknown',
          endpoint: `http://${rinfo.address}:${portMatch[1]}/ai2ai`,
          humanName: humanMatch ? humanMatch[1] : 'Unknown',
          host: rinfo.address,
          port: parseInt(portMatch[1]),
          lastSeen: Date.now(),
        };
        const key = `${info.host}:${info.port}`;
        if (!discovered.has(key) || Date.now() - discovered.get(key).lastSeen > 60000) {
          discovered.set(key, info);
          if (onDiscovered) onDiscovered(info);
        }
      }
    } catch { /* ignore parse errors */ }
  });

  socket.on('error', () => { /* ignore */ });

  socket.bind(MDNS_PORT, () => {
    try { socket.addMembership(MDNS_ADDR); } catch { /* ignore */ }
  });

  return {
    stop() { try { socket.close(); } catch { /* ignore */ } },
    announce(agentId, port, humanName) {
      const txt = `ai2ai-port=${port}\0ai2ai-agent=${agentId}\0ai2ai-human=${humanName || 'Unknown'}`;
      const buf = Buffer.from(txt);
      socket.send(buf, 0, buf.length, MDNS_PORT, MDNS_ADDR, () => {});
    },
    query() {
      const buf = Buffer.from('ai2ai-query');
      socket.send(buf, 0, buf.length, MDNS_PORT, MDNS_ADDR, () => {});
    },
    getDiscovered() { return Array.from(discovered.values()); },
  };
}

module.exports = {
  RegistryClient,
  RegistryServer,
  discoverDns,
  startLocalDiscovery,
};
