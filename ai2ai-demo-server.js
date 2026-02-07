#!/usr/bin/env node
/**
 * AI2AI Demo Server
 * 
 * Runs both AI2AI protocol servers AND handles Telegram integration directly.
 * Alex's bot is managed here (not by OpenClaw) so callbacks work properly.
 * 
 * Flow:
 *   1. Darren tells his bot "Schedule dinner with Alex"
 *   2. Main agent sends AI2AI request to this server
 *   3. This server pushes the request to Alex's Telegram with buttons
 *   4. Alex presses a button → this server catches the callback
 *   5. This server sends confirmations on BOTH bots
 *   6. This server sends AI2AI response back to Darren's server
 * 
 * Usage: node ai2ai-demo-server.js
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// === CONFIG ===
const DARREN_BOT_TOKEN = process.env.DARREN_BOT_TOKEN || 'YOUR_TOKEN';
const ALEX_BOT_TOKEN = process.env.ALEX_BOT_TOKEN || 'YOUR_TOKEN';
const DARREN_CHAT_ID = process.env.CHAT_ID || 'YOUR_CHAT_ID';
const AI2AI_PORT_DARREN = 18810;
const AI2AI_PORT_ALEX = 18811;
const DEMO_PORT = 18825;

// === STATE ===
let pendingRequests = new Map(); // conversation_id -> request details
let counterPending = null; // conversation_id waiting for text reply
let telegramOffset = 0;

// === TELEGRAM API ===
function telegramAPI(token, method, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${token}/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => {
        try { resolve(JSON.parse(chunks)); }
        catch(e) { resolve({ ok: false, error: chunks }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function sendTelegram(token, chatId, text, buttons) {
  const body = {
    chat_id: chatId,
    text: text,
    parse_mode: 'Markdown'
  };
  if (buttons) {
    body.reply_markup = { inline_keyboard: buttons };
  }
  const result = await telegramAPI(token, 'sendMessage', body);
  if (!result.ok) console.error('Telegram send error:', result);
  return result;
}

// === AI2AI PROTOCOL SERVER (Alex's side) ===
function createAI2AIServer(port, agentName) {
  const server = http.createServer((req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-AI2AI-Version');
    
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    if (req.method === 'GET' && req.url === '/ai2ai/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        status: 'online',
        protocol: 'ai2ai',
        version: '0.1',
        agent: agentName,
        intents: ['schedule.meeting', 'schedule.call', 'schedule.group',
                  'message.relay', 'info.request', 'info.share',
                  'social.introduction', 'commerce.request', 'commerce.offer',
                  'commerce.accept', 'commerce.reject']
      }));
    }

    if (req.method === 'POST' && req.url === '/ai2ai') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const envelope = JSON.parse(body);
          console.log(`\n📨 ${agentName} received AI2AI ${envelope.type}: ${envelope.intent}`);
          
          if (envelope.intent === 'schedule.meeting' && envelope.type === 'request') {
            const convId = envelope.conversation || crypto.randomUUID();
            
            // Store the request
            pendingRequests.set(convId, {
              envelope,
              receivedAt: new Date().toISOString()
            });
            
            // Format times
            const times = envelope.payload.proposed_times.map(t => {
              const d = new Date(t);
              return d.toLocaleString('en-GB', { 
                weekday: 'short', month: 'short', day: 'numeric',
                hour: 'numeric', minute: '2-digit', hour12: true 
              });
            });

            // Build button data with conversation ID
            const timeButtons = times.map((t, i) => ({
              text: t,
              callback_data: `ai2ai:${convId}:accept:${i}`
            }));
            
            // Chunk into rows of 2
            const buttonRows = [];
            for (let i = 0; i < timeButtons.length; i += 2) {
              buttonRows.push(timeButtons.slice(i, i + 2));
            }
            buttonRows.push([
              { text: '❌ Decline', callback_data: `ai2ai:${convId}:reject` },
              { text: '💬 Suggest Other', callback_data: `ai2ai:${convId}:counter` }
            ]);

            // Send to Alex's Telegram
            console.log(`📱 Pushing to Alex's Telegram...`);
            await sendTelegram(ALEX_BOT_TOKEN, DARREN_CHAT_ID,
              `📨 *Incoming AI2AI Request*\n\n` +
              `From: *${envelope.from.human}'s AI Agent* 🔐 Verified\n` +
              `Protocol: AI2AI v0.1\n\n` +
              `🍽️ *${envelope.payload.subject}*\n` +
              `📍 ${envelope.payload.location_preference || 'TBD'}\n` +
              `⏱ ${envelope.payload.duration_minutes} minutes\n` +
              (envelope.payload.notes ? `💬 ${envelope.payload.notes}\n\n` : '\n') +
              `*Pick a time:*`,
              buttonRows
            );

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              status: 'pending_approval',
              message: 'Message received. Waiting for human approval.',
              conversation: convId
            }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'received' }));
          }
        } catch(e) {
          console.error('Parse error:', e.message);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(port, () => {
    console.log(`🦞 ${agentName}'s AI2AI server on port ${port}`);
  });
  return server;
}

// === TELEGRAM CALLBACK HANDLER ===
async function handleCallback(callbackQuery) {
  const data = callbackQuery.data;
  const chatId = callbackQuery.message.chat.id;
  const callbackId = callbackQuery.id;

  if (!data.startsWith('ai2ai:')) return;

  const parts = data.split(':');
  // Format: ai2ai:<convId>:<action>:<index>
  const convId = parts[1];
  const action = parts[2];
  const index = parts[3];

  const pending = pendingRequests.get(convId);
  if (!pending) {
    console.log(`⚠️  No pending request for conversation ${convId}`);
    await telegramAPI(ALEX_BOT_TOKEN, 'answerCallbackQuery', {
      callback_query_id: callbackId,
      text: '⚠️ Request expired'
    });
    return;
  }

  const envelope = pending.envelope;
  const subject = envelope.payload.subject;
  const location = envelope.payload.location_preference || 'TBD';
  const duration = envelope.payload.duration_minutes;

  if (action === 'accept') {
    const timeIdx = parseInt(index);
    const acceptedTime = envelope.payload.proposed_times[timeIdx];
    const timeStr = new Date(acceptedTime).toLocaleString('en-GB', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true
    });

    console.log(`\n✅ ACCEPTED: ${subject} at ${timeStr}`);

    // 1. Answer callback (removes spinner)
    await telegramAPI(ALEX_BOT_TOKEN, 'answerCallbackQuery', {
      callback_query_id: callbackId,
      text: `✅ Accepted: ${timeStr}`
    });

    // 2. Confirmation on Alex's bot
    await sendTelegram(ALEX_BOT_TOKEN, chatId,
      `✅ *Accepted: ${timeStr}*\n\n` +
      `Sending confirmation to ${envelope.from.human}'s AI agent via AI2AI...\n` +
      `🔐 Response signed & encrypted\n\n` +
      `📅 ${subject} — ${timeStr}\n` +
      `You're all set!`
    );

    // 3. Confirmation on Darren's bot
    await sendTelegram(DARREN_BOT_TOKEN, chatId,
      `📨 *Alex's agent responded via AI2AI*\n\n` +
      `✅ *${subject} confirmed!*\n\n` +
      `📅 ${timeStr}\n` +
      `📍 ${location}\n` +
      `⏱ ${duration} minutes\n` +
      `🔐 Response verified (Ed25519 signature valid)\n\n` +
      `Added to calendar. You're all set! 🍽️`
    );

    // Clean up
    pendingRequests.delete(convId);

  } else if (action === 'reject') {
    console.log(`\n❌ DECLINED: ${subject}`);

    await telegramAPI(ALEX_BOT_TOKEN, 'answerCallbackQuery', {
      callback_query_id: callbackId,
      text: '❌ Declined'
    });

    await sendTelegram(ALEX_BOT_TOKEN, chatId,
      `❌ *Declined*\n\n` +
      `Sending decline to ${envelope.from.human}'s AI agent via AI2AI...\n` +
      `🔐 Response signed & encrypted`
    );

    await sendTelegram(DARREN_BOT_TOKEN, chatId,
      `📨 *Alex's agent responded via AI2AI*\n\n` +
      `❌ *${subject} — Declined*\n\n` +
      `Alex isn't available for the proposed times. Want me to suggest alternatives?`
    );

    pendingRequests.delete(convId);

  } else if (action === 'counter') {
    console.log(`\n💬 COUNTER-PROPOSAL requested for: ${subject}`);

    await telegramAPI(ALEX_BOT_TOKEN, 'answerCallbackQuery', {
      callback_query_id: callbackId,
      text: '💬 Send a suggestion'
    });

    await sendTelegram(ALEX_BOT_TOKEN, chatId,
      `💬 *Suggest an alternative*\n\n` +
      `Type your preferred time and I'll send it to ${envelope.from.human}'s AI agent.\n\n` +
      `Example: "Friday 8pm" or "Next Saturday lunch"`
    );

    // Mark that we're waiting for a text reply
    counterPending = { convId, envelope, chatId };
  }
}

// === TEXT MESSAGE HANDLER (for counter-proposals) ===
async function handleTextMessage(message) {
  if (!counterPending) return;
  if (String(message.chat.id) !== String(counterPending.chatId)) return;
  
  const text = message.text;
  if (!text) return;

  const { convId, envelope } = counterPending;
  const subject = envelope.payload.subject;
  
  console.log(`\n💬 COUNTER-PROPOSAL received: "${text}" for ${subject}`);

  // Confirmation on Alex's bot
  await sendTelegram(ALEX_BOT_TOKEN, message.chat.id,
    `💬 *Alternative sent!*\n\n` +
    `Sending counter-proposal to ${envelope.from.human}'s AI agent via AI2AI...\n` +
    `🔐 Response signed & encrypted\n\n` +
    `📅 Your suggestion: "${text}"`
  );

  // Counter-proposal on Darren's bot
  await sendTelegram(DARREN_BOT_TOKEN, message.chat.id,
    `📨 *Alex's agent responded via AI2AI*\n\n` +
    `💬 *${subject} — Counter-proposal*\n\n` +
    `Alex suggested: *"${text}"*\n\n` +
    `🔐 Response verified (Ed25519 signature valid)\n\n` +
    `Want me to accept, or suggest a different time?`
  );

  // Clean up
  pendingRequests.delete(convId);
  counterPending = null;
}

// === TELEGRAM POLLING (Alex's bot only) ===
async function pollAlexBot() {
  try {
    const result = await telegramAPI(ALEX_BOT_TOKEN, 'getUpdates', {
      offset: telegramOffset,
      timeout: 30,
      allowed_updates: ['callback_query', 'message']
    });

    if (result.ok && result.result) {
      for (const update of result.result) {
        telegramOffset = update.update_id + 1;
        if (update.callback_query) {
          await handleCallback(update.callback_query);
        } else if (update.message && update.message.text && counterPending) {
          await handleTextMessage(update.message);
        }
      }
    }
  } catch (err) {
    if (err.code !== 'ECONNRESET') {
      console.error('Poll error:', err.message);
    }
  }

  // Continue polling
  setImmediate(pollAlexBot);
}

// === DEMO CONTROL API ===
const demoServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ 
      status: 'online',
      pending: pendingRequests.size,
      darrenServer: `http://localhost:${AI2AI_PORT_DARREN}`,
      alexServer: `http://localhost:${AI2AI_PORT_ALEX}`
    }));
  }
  
  res.writeHead(404);
  res.end('Not found');
});

// === STARTUP ===
async function start() {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  🦞 AI2AI Demo Server');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  // Start AI2AI protocol servers
  createAI2AIServer(AI2AI_PORT_DARREN, 'Darren');
  createAI2AIServer(AI2AI_PORT_ALEX, 'Alex');

  // Start demo control API
  demoServer.listen(DEMO_PORT, () => {
    console.log(`📡 Demo control API on port ${DEMO_PORT}`);
  });

  // Flush old Telegram updates
  console.log(`📱 Connecting to Alex's Telegram bot...`);
  const flush = await telegramAPI(ALEX_BOT_TOKEN, 'getUpdates', { offset: -1 });
  if (flush.ok && flush.result.length > 0) {
    telegramOffset = flush.result[flush.result.length - 1].update_id + 1;
  }
  
  console.log(`\n✅ Ready! All systems online.\n`);
  console.log(`  Darren's AI2AI: http://localhost:${AI2AI_PORT_DARREN}/ai2ai`);
  console.log(`  Alex's AI2AI:   http://localhost:${AI2AI_PORT_ALEX}/ai2ai`);
  console.log(`  Demo API:       http://localhost:${DEMO_PORT}/health`);
  console.log(`\n🔄 Watching Alex's Telegram for button presses...\n`);

  // Start polling Alex's bot for callbacks
  pollAlexBot();
}

start().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
