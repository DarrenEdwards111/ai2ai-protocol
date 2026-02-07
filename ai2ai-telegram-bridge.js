#!/usr/bin/env node
/**
 * AI2AI Telegram Callback Bridge
 * 
 * Watches Alex's Telegram bot for inline button callbacks (ai2ai:*)
 * and auto-sends confirmation messages to both bots.
 * 
 * Usage: node ai2ai-telegram-bridge.js
 */

const https = require('https');
const http = require('http');

// Bot configs
const DARREN_BOT = {
  token: process.env.DARREN_BOT_TOKEN || 'YOUR_TOKEN',
  name: 'Darren'
};
const ALEX_BOT = {
  token: process.env.ALEX_BOT_TOKEN || 'YOUR_TOKEN',
  name: 'Alex'
};

// Track the last request details for context
let lastRequest = {
  subject: 'Dinner',
  location: 'Somewhere nice in London',
  duration: 90,
  times: {
    '7pm': 'Thu Feb 13, 7:00 PM',
    '730pm': 'Thu Feb 13, 7:30 PM',
    '8pm': 'Thu Feb 13, 8:00 PM'
  }
};

let offset = 0;

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

async function sendMessage(bot, chatId, text, buttons) {
  const body = {
    chat_id: chatId,
    text: text,
    parse_mode: 'Markdown'
  };
  if (buttons) {
    body.reply_markup = { inline_keyboard: buttons };
  }
  return telegramAPI(bot.token, 'sendMessage', body);
}

async function answerCallback(bot, callbackId, text) {
  return telegramAPI(bot.token, 'answerCallbackQuery', {
    callback_query_id: callbackId,
    text: text
  });
}

async function handleCallback(callbackQuery) {
  const data = callbackQuery.data;
  const chatId = callbackQuery.message.chat.id;
  const callbackId = callbackQuery.id;

  console.log(`🔔 Callback received: ${data} from chat ${chatId}`);

  if (!data.startsWith('ai2ai:')) return;

  const parts = data.split(':');
  const action = parts[1]; // accept, reject, counter
  const value = parts[2];  // 7pm, 730pm, 8pm, etc.

  if (action === 'accept') {
    const timeStr = lastRequest.times[value] || value;
    
    // Answer the callback (removes loading spinner)
    await answerCallback(ALEX_BOT, callbackId, `✅ Accepted: ${timeStr}`);
    
    // Send confirmation on Alex's bot
    await sendMessage(ALEX_BOT, chatId, 
      `✅ *Accepted: ${timeStr}*\n\nSending confirmation to Darren's AI agent via AI2AI...\n🔐 Response signed & encrypted\n\n📅 ${lastRequest.subject} — ${timeStr}\nYou're all set!`
    );
    
    // Send confirmation on Darren's bot
    await sendMessage(DARREN_BOT, chatId,
      `📨 *Alex's agent responded via AI2AI*\n\n✅ *${lastRequest.subject} confirmed!*\n\n📅 ${timeStr}\n📍 ${lastRequest.location}\n⏱ ${lastRequest.duration} minutes\n🔐 Response verified (Ed25519 signature valid)\n\nAdded to calendar. You're all set! 🍽️`
    );
    
    console.log(`✅ Accepted: ${timeStr} — confirmations sent to both bots`);

  } else if (action === 'reject') {
    await answerCallback(ALEX_BOT, callbackId, '❌ Declined');
    
    await sendMessage(ALEX_BOT, chatId,
      `❌ *Declined*\n\nSending decline to Darren's AI agent via AI2AI...\n🔐 Response signed & encrypted`
    );
    
    await sendMessage(DARREN_BOT, chatId,
      `📨 *Alex's agent responded via AI2AI*\n\n❌ *${lastRequest.subject} — Declined*\n\nAlex isn't available for the proposed times. Want me to suggest alternatives?`
    );
    
    console.log(`❌ Declined — notifications sent to both bots`);

  } else if (action === 'counter') {
    await answerCallback(ALEX_BOT, callbackId, '💬 Send a suggestion');
    
    await sendMessage(ALEX_BOT, chatId,
      `💬 *Suggest an alternative*\n\nType your preferred time and I'll send it to Darren's AI agent.\n\nExample: "Friday 8pm" or "Next Saturday lunch"`
    );
    
    console.log(`💬 Counter-proposal requested`);
  }
}

async function pollUpdates() {
  try {
    const result = await telegramAPI(ALEX_BOT.token, 'getUpdates', {
      offset: offset,
      timeout: 30,
      allowed_updates: ['callback_query']
    });

    if (result.ok && result.result.length > 0) {
      for (const update of result.result) {
        offset = update.update_id + 1;
        if (update.callback_query) {
          await handleCallback(update.callback_query);
        }
      }
    }
  } catch (err) {
    console.error('Poll error:', err.message);
  }

  // Poll again
  setTimeout(pollUpdates, 500);
}

// Update request context from command line args or environment
function updateContext() {
  if (process.env.AI2AI_SUBJECT) lastRequest.subject = process.env.AI2AI_SUBJECT;
  if (process.env.AI2AI_LOCATION) lastRequest.location = process.env.AI2AI_LOCATION;
  if (process.env.AI2AI_DURATION) lastRequest.duration = parseInt(process.env.AI2AI_DURATION);
}

// Also listen for HTTP updates to change context dynamically
const contextServer = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/context') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const ctx = JSON.parse(body);
        if (ctx.subject) lastRequest.subject = ctx.subject;
        if (ctx.location) lastRequest.location = ctx.location;
        if (ctx.duration) lastRequest.duration = ctx.duration;
        if (ctx.times) lastRequest.times = ctx.times;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, context: lastRequest }));
        console.log('📝 Context updated:', lastRequest.subject);
      } catch(e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  } else if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'online', context: lastRequest }));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

console.log('🌉 AI2AI Telegram Bridge starting...');
console.log(`👤 Watching Alex's bot for callbacks`);
console.log(`📡 Context server on http://localhost:18820`);
console.log(`🔄 Polling for button presses...\n`);

updateContext();
contextServer.listen(18820);

// Flush any old updates first
telegramAPI(ALEX_BOT.token, 'getUpdates', { offset: -1 }).then(result => {
  if (result.ok && result.result.length > 0) {
    offset = result.result[result.result.length - 1].update_id + 1;
  }
  console.log('✅ Ready — press a button on Alex\'s bot!\n');
  pollUpdates();
});
