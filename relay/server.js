#!/usr/bin/env node
/**
 * AI2AI Relay Server
 * 
 * A public relay that lets agents communicate without needing
 * public IPs or port forwarding. Agents register with the relay
 * and messages are forwarded through it.
 * 
 * This is the "phone network" — agents register their number,
 * and the relay routes calls between them.
 * 
 * Usage: 
 *   node relay/server.js                    (default port 18800)
 *   PORT=3000 node relay/server.js          (custom port)
 *   RELAY_SECRET=mysecret node relay/server.js  (with auth)
 * 
 * Deploy to any VPS, Railway, Render, Fly.io, etc.
 */

'use strict';

const http = require('http');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '18800');
const RELAY_SECRET = process.env.RELAY_SECRET || null;

// === STATE ===
const agents = new Map();       // agentId -> { endpoint, publicKey, humanName, registeredAt, lastSeen }
const mailboxes = new Map();    // agentId -> [messages waiting for pickup]
const MAILBOX_MAX = 100;        // max messages per mailbox
const AGENT_TIMEOUT = 24 * 60 * 60 * 1000; // 24h inactive = removed

// === HELPERS ===
function json(res, status, data) {
  res.writeHead(status, { 
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-AI2AI-Version'
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => {
      body += c;
      if (body.length > 1024 * 1024) { reject(new Error('Body too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch(e) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function checkAuth(req) {
  if (!RELAY_SECRET) return true;
  const auth = req.headers.authorization;
  return auth === `Bearer ${RELAY_SECRET}`;
}

function cleanExpired() {
  const now = Date.now();
  for (const [id, agent] of agents) {
    if (now - new Date(agent.lastSeen).getTime() > AGENT_TIMEOUT) {
      agents.delete(id);
      mailboxes.delete(id);
      console.log(`🗑️  Expired agent: ${id}`);
    }
  }
}

// Clean expired agents every hour
setInterval(cleanExpired, 60 * 60 * 1000);

// === ROUTES ===
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    json(res, 204, {});
    return;
  }

  try {
    // --- Health ---
    if (req.method === 'GET' && path === '/health') {
      return json(res, 200, {
        status: 'online',
        type: 'ai2ai-relay',
        version: '0.1',
        agents: agents.size,
        uptime: process.uptime()
      });
    }

    // --- Directory: List agents ---
    if (req.method === 'GET' && path === '/directory') {
      const list = [];
      for (const [id, agent] of agents) {
        list.push({
          agentId: id,
          humanName: agent.humanName,
          publicKey: agent.publicKey,
          registeredAt: agent.registeredAt,
          lastSeen: agent.lastSeen
        });
      }
      return json(res, 200, { agents: list, count: list.length });
    }

    // --- Register agent ---
    if (req.method === 'POST' && path === '/register') {
      const body = await readBody(req);
      const { agentId, humanName, publicKey, endpoint } = body;

      if (!agentId) return json(res, 400, { error: 'agentId required' });

      agents.set(agentId, {
        endpoint: endpoint || null,
        publicKey: publicKey || null,
        humanName: humanName || agentId,
        registeredAt: agents.has(agentId) ? agents.get(agentId).registeredAt : new Date().toISOString(),
        lastSeen: new Date().toISOString()
      });

      if (!mailboxes.has(agentId)) {
        mailboxes.set(agentId, []);
      }

      console.log(`📝 Registered: ${agentId} (${humanName || 'unknown'})`);
      return json(res, 200, { 
        status: 'registered',
        agentId,
        relayEndpoint: `http://localhost:${PORT}`,
        message: `Agent ${agentId} registered. Others can reach you at this relay.`
      });
    }

    // --- Send message (relay) ---
    if (req.method === 'POST' && path === '/relay') {
      const envelope = await readBody(req);

      if (!envelope.to?.agent) return json(res, 400, { error: 'to.agent required' });

      const targetId = envelope.to.agent;
      const target = agents.get(targetId);

      if (!target) {
        return json(res, 404, { error: `Agent ${targetId} not found on this relay` });
      }

      // Add relay metadata
      envelope._relay = {
        relayedAt: new Date().toISOString(),
        relayId: crypto.randomUUID()
      };

      // If target has a direct endpoint, forward immediately
      if (target.endpoint) {
        try {
          const url = new URL(target.endpoint);
          const data = JSON.stringify(envelope);
          
          const fwdReq = http.request({
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(data),
              'X-AI2AI-Version': '0.1',
              'X-AI2AI-Relay': 'true'
            }
          }, (fwdRes) => {
            let chunks = '';
            fwdRes.on('data', c => chunks += c);
            fwdRes.on('end', () => {
              console.log(`📬 Relayed: ${envelope.from?.agent || 'unknown'} → ${targetId} (forwarded)`);
              json(res, 200, { status: 'forwarded', target: targetId });
            });
          });
          
          fwdReq.on('error', () => {
            // Forward failed, put in mailbox instead
            addToMailbox(targetId, envelope);
            console.log(`📬 Relayed: ${envelope.from?.agent || 'unknown'} → ${targetId} (mailbox, forward failed)`);
            json(res, 200, { status: 'queued', target: targetId, note: 'Direct forward failed, message queued' });
          });
          
          fwdReq.write(data);
          fwdReq.end();
          return;
        } catch(e) {
          // Fall through to mailbox
        }
      }

      // No endpoint or forward failed — store in mailbox
      addToMailbox(targetId, envelope);
      console.log(`📬 Relayed: ${envelope.from?.agent || 'unknown'} → ${targetId} (mailbox)`);
      return json(res, 200, { status: 'queued', target: targetId });
    }

    // --- Pick up messages (poll mailbox) ---
    if (req.method === 'GET' && path.startsWith('/mailbox/')) {
      const agentId = path.split('/')[2];
      
      if (!agents.has(agentId)) {
        return json(res, 404, { error: `Agent ${agentId} not registered` });
      }

      // Update last seen
      const agent = agents.get(agentId);
      agent.lastSeen = new Date().toISOString();

      const messages = mailboxes.get(agentId) || [];
      mailboxes.set(agentId, []); // Clear after pickup
      
      return json(res, 200, { messages, count: messages.length });
    }

    // --- Lookup agent ---
    if (req.method === 'GET' && path.startsWith('/agent/')) {
      const agentId = path.split('/')[2];
      const agent = agents.get(agentId);
      
      if (!agent) return json(res, 404, { error: `Agent ${agentId} not found` });
      
      return json(res, 200, {
        agentId,
        humanName: agent.humanName,
        publicKey: agent.publicKey,
        registeredAt: agent.registeredAt,
        lastSeen: agent.lastSeen
      });
    }

    // --- Unregister ---
    if (req.method === 'DELETE' && path.startsWith('/agent/')) {
      const agentId = path.split('/')[2];
      agents.delete(agentId);
      mailboxes.delete(agentId);
      console.log(`👋 Unregistered: ${agentId}`);
      return json(res, 200, { status: 'unregistered', agentId });
    }

    // --- Fallback ---
    json(res, 404, { error: 'Not found', hint: 'Try GET /health or GET /directory' });

  } catch(err) {
    console.error('Error:', err.message);
    json(res, 500, { error: err.message });
  }
});

// === STARTUP ===
server.listen(PORT, () => {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  🦞 AI2AI Relay Server');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log(`  🌐 Listening on port ${PORT}`);
  console.log(`  📡 Health:     http://localhost:${PORT}/health`);
  console.log(`  📇 Directory:  http://localhost:${PORT}/directory`);
  console.log(`  📝 Register:   POST /register`);
  console.log(`  📬 Send:       POST /relay`);
  console.log(`  📥 Pickup:     GET /mailbox/:agentId`);
  console.log(`  🔍 Lookup:     GET /agent/:agentId`);
  if (RELAY_SECRET) {
    console.log(`  🔒 Auth:       Required (Bearer token)`);
  } else {
    console.log(`  🔓 Auth:       Open (set RELAY_SECRET to require auth)`);
  }
  console.log('');
  console.log('  Ready for agents! 🚀');
  console.log('');
});

function addToMailbox(agentId, message) {
  if (!mailboxes.has(agentId)) mailboxes.set(agentId, []);
  const box = mailboxes.get(agentId);
  box.push(message);
  if (box.length > MAILBOX_MAX) box.shift(); // drop oldest
}
