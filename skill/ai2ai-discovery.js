/**
 * AI2AI Discovery — Find other agents on the network
 *
 * Three discovery mechanisms:
 * 1. mDNS/Bonjour — local network multicast (no dependencies)
 * 2. DNS TXT record — lookup ai2ai=<endpoint> in TXT records
 * 3. .well-known/ai2ai.json — web-based discovery convention
 */

const dgram = require('dgram');
const dns = require('dns');
const http = require('http');
const https = require('https');
const logger = require('./ai2ai-logger');

// mDNS constants
const MDNS_ADDR = '224.0.0.251';
const MDNS_PORT = 5353;
const SERVICE_NAME = '_ai2ai._tcp.local';

// Active mDNS listener state
let mdnsSocket = null;
const discoveredAgents = new Map(); // agentId → { endpoint, humanName, lastSeen }

// ─── mDNS/Bonjour ──────────────────────────────────────────────────────────

/**
 * Encode a DNS name into wire format
 */
function encodeDnsName(name) {
  const parts = name.split('.');
  const buffers = parts.map(p => {
    const label = Buffer.from(p, 'utf-8');
    return Buffer.concat([Buffer.from([label.length]), label]);
  });
  return Buffer.concat([...buffers, Buffer.from([0])]);
}

/**
 * Decode a DNS name from wire format
 */
function decodeDnsName(buf, offset) {
  const labels = [];
  let pos = offset;
  let jumped = false;
  let jumpedTo = -1;

  while (pos < buf.length) {
    const len = buf[pos];
    if (len === 0) { pos++; break; }

    // Pointer (compression)
    if ((len & 0xC0) === 0xC0) {
      if (!jumped) jumpedTo = pos + 2;
      jumped = true;
      pos = ((len & 0x3F) << 8) | buf[pos + 1];
      continue;
    }

    labels.push(buf.subarray(pos + 1, pos + 1 + len).toString('utf-8'));
    pos += 1 + len;
  }

  return { name: labels.join('.'), nextOffset: jumped ? jumpedTo : pos };
}

/**
 * Build a simple mDNS query for our service
 */
function buildMdnsQuery() {
  const nameBytes = encodeDnsName(SERVICE_NAME);
  // Header: ID=0, flags=0, QDCOUNT=1, all others 0
  const header = Buffer.alloc(12);
  header.writeUInt16BE(1, 4); // QDCOUNT = 1

  // Question: name + QTYPE(PTR=12) + QCLASS(IN=1)
  const question = Buffer.alloc(nameBytes.length + 4);
  nameBytes.copy(question);
  question.writeUInt16BE(12, nameBytes.length);     // PTR
  question.writeUInt16BE(1, nameBytes.length + 2);   // IN

  return Buffer.concat([header, question]);
}

/**
 * Build an mDNS announcement for our agent
 */
function buildMdnsAnnouncement(agentName, port, humanName) {
  const nameBytes = encodeDnsName(SERVICE_NAME);
  const instanceName = `${agentName}.${SERVICE_NAME}`;
  const instanceBytes = encodeDnsName(instanceName);

  // Header: ID=0, flags=0x8400 (authoritative response), ANCOUNT=1
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0x8400, 2); // Flags
  header.writeUInt16BE(1, 6);      // ANCOUNT = 1

  // Answer: PTR record pointing to our instance
  const answer = Buffer.alloc(nameBytes.length + 10 + instanceBytes.length);
  nameBytes.copy(answer);
  let off = nameBytes.length;
  answer.writeUInt16BE(12, off);       // PTR
  answer.writeUInt16BE(1, off + 2);    // IN
  answer.writeUInt32BE(120, off + 4);  // TTL = 120s
  answer.writeUInt16BE(instanceBytes.length, off + 8); // RDLENGTH
  instanceBytes.copy(answer, off + 10);

  // TXT record with metadata
  const txtData = `ai2ai-port=${port}\0ai2ai-human=${humanName}`;
  const txtBuf = Buffer.from(txtData, 'utf-8');
  const txtLen = Buffer.alloc(1);
  txtLen[0] = txtBuf.length;

  return Buffer.concat([header, answer]);
}

/**
 * Parse mDNS response for AI2AI service announcements
 */
function parseMdnsResponse(msg, rinfo) {
  try {
    if (msg.length < 12) return null;

    const flags = msg.readUInt16BE(2);
    const isResponse = (flags & 0x8000) !== 0;
    if (!isResponse) return null;

    const ancount = msg.readUInt16BE(6);
    if (ancount === 0) return null;

    // Simple extraction: look for TXT containing ai2ai-port
    const msgStr = msg.toString('utf-8', 12);
    const portMatch = msgStr.match(/ai2ai-port=(\d+)/);
    const humanMatch = msgStr.match(/ai2ai-human=([^\0]+)/);

    if (portMatch) {
      return {
        host: rinfo.address,
        port: parseInt(portMatch[1]),
        humanName: humanMatch ? humanMatch[1] : 'Unknown',
        endpoint: `http://${rinfo.address}:${portMatch[1]}/ai2ai`,
      };
    }
  } catch { /* ignore parse errors */ }
  return null;
}

/**
 * Start mDNS listener for AI2AI service discovery
 * @param {Function} onDiscovered - callback(agentInfo) when a new agent is found
 * @returns {object} - { stop(), announce() }
 */
function startMdnsDiscovery(onDiscovered) {
  if (mdnsSocket) {
    logger.warn('MDNS', 'mDNS discovery already running');
    return null;
  }

  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  socket.on('message', (msg, rinfo) => {
    const agent = parseMdnsResponse(msg, rinfo);
    if (agent) {
      const key = `${agent.host}:${agent.port}`;
      const existing = discoveredAgents.get(key);
      if (!existing || Date.now() - existing.lastSeen > 60000) {
        agent.lastSeen = Date.now();
        discoveredAgents.set(key, agent);
        logger.info('MDNS', `Discovered agent at ${agent.endpoint}`, agent);
        if (onDiscovered) onDiscovered(agent);
      }
    }
  });

  socket.on('error', (err) => {
    logger.error('MDNS', `mDNS socket error: ${err.message}`);
  });

  socket.bind(MDNS_PORT, () => {
    try {
      socket.addMembership(MDNS_ADDR);
      logger.info('MDNS', 'mDNS discovery started, listening on 224.0.0.251:5353');
    } catch (err) {
      logger.warn('MDNS', `Could not join multicast group: ${err.message}`);
    }
  });

  mdnsSocket = socket;

  return {
    stop() {
      socket.close();
      mdnsSocket = null;
      logger.info('MDNS', 'mDNS discovery stopped');
    },
    announce(agentName, port, humanName) {
      const buf = buildMdnsAnnouncement(agentName, port, humanName);
      socket.send(buf, 0, buf.length, MDNS_PORT, MDNS_ADDR, (err) => {
        if (err) logger.error('MDNS', `Announce failed: ${err.message}`);
        else logger.info('MDNS', `Announced ${agentName} on port ${port}`);
      });
    },
    query() {
      const buf = buildMdnsQuery();
      socket.send(buf, 0, buf.length, MDNS_PORT, MDNS_ADDR, (err) => {
        if (err) logger.error('MDNS', `Query failed: ${err.message}`);
        else logger.debug('MDNS', 'Sent mDNS query for _ai2ai._tcp.local');
      });
    },
    getDiscovered() {
      return Array.from(discoveredAgents.values());
    },
  };
}

// ─── DNS TXT Record ─────────────────────────────────────────────────────────

/**
 * Look up AI2AI endpoint via DNS TXT record
 * Looks for a TXT record with content: ai2ai=<endpoint>
 *
 * @param {string} domain - Domain to look up
 * @returns {Promise<string|null>} - Endpoint URL or null
 */
function lookupDnsTxt(domain) {
  return new Promise((resolve) => {
    dns.resolveTxt(domain, (err, records) => {
      if (err) {
        logger.debug('DNS', `TXT lookup failed for ${domain}: ${err.message}`);
        resolve(null);
        return;
      }

      for (const record of records) {
        const joined = record.join('');
        const match = joined.match(/^ai2ai=(.+)$/);
        if (match) {
          const endpoint = match[1].trim();
          logger.info('DNS', `Found AI2AI endpoint for ${domain}: ${endpoint}`);
          resolve(endpoint);
          return;
        }
      }

      logger.debug('DNS', `No ai2ai TXT record found for ${domain}`);
      resolve(null);
    });
  });
}

/**
 * Look up AI2AI endpoint via SRV record
 * Looks for _ai2ai._tcp.<domain>
 *
 * @param {string} domain - Domain to look up
 * @returns {Promise<{host: string, port: number}|null>}
 */
function lookupDnsSrv(domain) {
  return new Promise((resolve) => {
    dns.resolveSrv(`_ai2ai._tcp.${domain}`, (err, records) => {
      if (err) {
        logger.debug('DNS', `SRV lookup failed for ${domain}: ${err.message}`);
        resolve(null);
        return;
      }

      if (records.length > 0) {
        const { name, port } = records[0];
        const result = { host: name, port };
        logger.info('DNS', `Found AI2AI SRV for ${domain}: ${name}:${port}`);
        resolve(result);
        return;
      }

      resolve(null);
    });
  });
}

// ─── .well-known Discovery ──────────────────────────────────────────────────

/**
 * Fetch /.well-known/ai2ai.json from a domain
 *
 * Expected format:
 * {
 *   "ai2ai": "0.1",
 *   "endpoint": "https://example.com:18800/ai2ai",
 *   "agent": "example-assistant",
 *   "human": "Alex",
 *   "publicKey": "...",
 *   "capabilities": ["schedule.meeting", "message.relay"]
 * }
 *
 * @param {string} domain - Domain to check
 * @returns {Promise<object|null>}
 */
function fetchWellKnown(domain) {
  return new Promise((resolve) => {
    const url = `https://${domain}/.well-known/ai2ai.json`;
    const client = url.startsWith('https') ? https : http;

    const req = client.get(url, { timeout: 10000 }, (res) => {
      if (res.statusCode !== 200) {
        logger.debug('WELLKNOWN', `${url} returned ${res.statusCode}`);
        resolve(null);
        return;
      }

      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          logger.info('WELLKNOWN', `Found AI2AI config at ${url}`, data);
          resolve(data);
        } catch {
          logger.warn('WELLKNOWN', `Invalid JSON at ${url}`);
          resolve(null);
        }
      });
    });

    req.on('error', (err) => {
      logger.debug('WELLKNOWN', `Failed to fetch ${url}: ${err.message}`);
      resolve(null);
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

/**
 * Generate the .well-known/ai2ai.json content for this agent
 */
function generateWellKnownJson(config) {
  const { loadOrCreateKeys, getFingerprint } = require('./ai2ai-crypto');
  const { supportedIntents } = require('./ai2ai-handlers');
  const keys = loadOrCreateKeys();

  return {
    ai2ai: '0.1',
    endpoint: config.endpoint || `http://localhost:${config.port || 18800}/ai2ai`,
    agent: config.agentName || process.env.AI2AI_AGENT_NAME || 'my-assistant',
    human: config.humanName || process.env.AI2AI_HUMAN_NAME || 'Human',
    publicKey: keys.publicKey,
    fingerprint: getFingerprint(keys.publicKey),
    capabilities: supportedIntents(),
    timezone: config.timezone || process.env.AI2AI_TIMEZONE || 'UTC',
  };
}

// ─── Unified Discovery ──────────────────────────────────────────────────────

/**
 * Try all discovery methods for a given domain
 * Returns the first successful result.
 *
 * @param {string} domain - Domain to discover
 * @returns {Promise<{method: string, endpoint: string, data: object|null}|null>}
 */
async function discover(domain) {
  logger.info('DISCOVERY', `Starting discovery for ${domain}`);

  // Try DNS TXT first (fastest)
  const txtEndpoint = await lookupDnsTxt(domain);
  if (txtEndpoint) {
    return { method: 'dns-txt', endpoint: txtEndpoint, data: null };
  }

  // Try DNS SRV
  const srv = await lookupDnsSrv(domain);
  if (srv) {
    const endpoint = `http://${srv.host}:${srv.port}/ai2ai`;
    return { method: 'dns-srv', endpoint, data: srv };
  }

  // Try .well-known
  const wellKnown = await fetchWellKnown(domain);
  if (wellKnown && wellKnown.endpoint) {
    return { method: 'well-known', endpoint: wellKnown.endpoint, data: wellKnown };
  }

  logger.info('DISCOVERY', `No AI2AI endpoint found for ${domain}`);
  return null;
}

module.exports = {
  startMdnsDiscovery,
  lookupDnsTxt,
  lookupDnsSrv,
  fetchWellKnown,
  generateWellKnownJson,
  discover,
};
