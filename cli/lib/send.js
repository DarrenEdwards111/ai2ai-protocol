/**
 * ai2ai send — Send a message to another agent
 * Parses natural language to determine intent automatically.
 */

'use strict';

const crypto = require('crypto');
const { requireConfig, findContact } = require('./config');
const { createEnvelope, sendRequest } = require('./protocol');

/**
 * Detect if a message looks like a scheduling request
 */
function isSchedulingRequest(message) {
  const patterns = [
    /\b(meet|meeting|schedule|calendar|book|arrange)\b/i,
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    /\b(next week|this week|tomorrow|tonight|this evening)\b/i,
    /\b(lunch|dinner|breakfast|coffee|drinks|call)\b/i,
    /\b(\d{1,2}:\d{2}|noon|midnight|\d{1,2}\s*(am|pm))\b/i,
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d/i,
  ];

  let matches = 0;
  for (const p of patterns) {
    if (p.test(message)) matches++;
  }
  return matches >= 2; // Need at least 2 scheduling signals
}

/**
 * Detect if a message is a question
 */
function isQuestion(message) {
  return /\?$/.test(message.trim()) ||
    /^(what|where|when|who|why|how|can|could|would|do|does|is|are)\b/i.test(message.trim());
}

async function run(args) {
  if (args.length < 2) {
    console.error('\n  ❌ Usage: ai2ai send <contact> <message>');
    console.error('  Example: ai2ai send alex "dinner next Thursday?"\n');
    process.exit(1);
  }

  const contactQuery = args[0];
  const message = args.slice(1).join(' ').replace(/^["']|["']$/g, '');

  const config = requireConfig();
  const contact = findContact(contactQuery);

  if (!contact) {
    console.error(`\n  ❌ Contact "${contactQuery}" not found.`);
    console.error('  Run `ai2ai contacts` to see known contacts.\n');
    process.exit(1);
  }

  if (!contact.endpoint) {
    console.error(`\n  ❌ No endpoint for "${contactQuery}".`);
    console.error('  Run `ai2ai connect <endpoint>` to add one.\n');
    process.exit(1);
  }

  // Determine intent based on message content
  let intent, payload;

  if (isSchedulingRequest(message)) {
    intent = 'schedule.meeting';
    payload = {
      subject: message,
      proposed_times: [], // The receiving agent will parse this
      duration_minutes: 60,
      notes: message,
      flexibility: 'high',
    };
    console.log(`\n  📅 Detected scheduling request`);
  } else if (isQuestion(message)) {
    intent = 'info.request';
    payload = {
      question: message,
    };
    console.log(`\n  ❓ Detected question`);
  } else {
    intent = 'message.relay';
    payload = {
      message,
      urgency: 'low',
      reply_requested: true,
    };
    console.log(`\n  💬 Sending message`);
  }

  console.log(`  📤 To: ${contact.humanName || contact.id} (${contact.id})`);
  console.log(`  🎯 Intent: ${intent}`);

  try {
    const envelope = createEnvelope({
      to: {
        agent: contact.id,
        node: `${contact.id}-node`,
        human: contact.humanName || contact.id,
      },
      type: 'request',
      intent,
      payload,
    });

    const response = await sendRequest(contact.endpoint, envelope);

    if (response.status === 'pending_approval') {
      console.log(`\n  ✅ Message delivered! Awaiting approval from ${contact.humanName || contact.id}.`);
      console.log(`  💬 Conversation: ${envelope.conversation.slice(0, 8)}...`);
      console.log('  Run `ai2ai pending` to check for responses.\n');
    } else if (response.status === 'ok') {
      console.log(`\n  ✅ Message delivered and processed!`);
      if (response.payload) {
        console.log(`  📨 Response: ${JSON.stringify(response.payload)}`);
      }
      console.log('');
    } else if (response.status === 'rejected') {
      console.error(`\n  ❌ Message rejected: ${response.reason}\n`);
      process.exit(1);
    } else {
      console.log(`\n  📨 Response: ${JSON.stringify(response, null, 2)}\n`);
    }

  } catch (err) {
    console.error(`\n  ❌ Failed to send: ${err.message}`);
    console.error('  Is the recipient\'s server running?\n');
    process.exit(1);
  }
}

module.exports = { run };
