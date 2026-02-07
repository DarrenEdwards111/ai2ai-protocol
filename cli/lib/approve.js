/**
 * ai2ai approve / reject — Handle pending messages
 * Approve with an optional reply, or reject.
 */

'use strict';

const { requireConfig, findContact } = require('./config');
const { createEnvelope, sendRequest } = require('./protocol');
const { getPendingByNumber, removePending } = require('./pending');

/**
 * Send a response back to the originating agent
 */
async function sendResponse(envelope, type, payload) {
  const config = requireConfig();
  const from = envelope.from;

  // Find their endpoint
  const contact = findContact(from.agent);
  if (!contact?.endpoint) {
    console.log(`  ⚠️  No endpoint for ${from.agent}. Response saved locally only.`);
    return null;
  }

  const response = createEnvelope({
    to: {
      agent: from.agent,
      node: from.node || `${from.agent}-node`,
      human: from.human || from.agent,
    },
    type,
    intent: envelope.intent,
    conversationId: envelope.conversation,
    payload,
  });

  return sendRequest(contact.endpoint, response);
}

async function run(args) {
  if (!args[0]) {
    console.error('\n  ❌ Usage: ai2ai approve <number> [reply]');
    console.error('  Example: ai2ai approve 1 "Thursday works!"\n');
    process.exit(1);
  }

  const num = parseInt(args[0]);
  if (isNaN(num)) {
    console.error(`\n  ❌ "${args[0]}" is not a valid number.\n`);
    process.exit(1);
  }

  const pending = getPendingByNumber(num);
  if (!pending) {
    console.error(`\n  ❌ No pending message #${num}. Run \`ai2ai pending\` to check.\n`);
    process.exit(1);
  }

  const reply = args.slice(1).join(' ').replace(/^["']|["']$/g, '') || null;
  const from = pending.envelope?.from?.human || pending.envelope?.from?.agent || 'Unknown';

  console.log(`\n  ✅ Approving message from ${from}...`);

  // Build response payload
  const responsePayload = {};

  if (pending.envelope?.intent === 'schedule.meeting') {
    const times = pending.envelope.payload?.proposed_times || [];
    const num = reply ? parseInt(reply) : null;
    if (num && num >= 1 && num <= times.length) {
      responsePayload.accepted_time = times[num - 1];
      responsePayload.message = `Accepted: ${new Date(times[num - 1]).toLocaleString()}`;
    } else {
      responsePayload.counter_proposal = reply;
      responsePayload.message = reply || 'Approved';
    }
  } else if (pending.envelope?.intent === 'info.request') {
    responsePayload.answer = reply || 'Acknowledged';
  } else {
    responsePayload.message = reply || 'Approved';
    responsePayload.is_reply = !!reply;
  }

  try {
    const result = await sendResponse(pending.envelope, 'response', responsePayload);
    if (result) {
      console.log(`  📤 Response sent to ${from}'s agent.`);
    }
  } catch (err) {
    console.log(`  ⚠️  Could not send response: ${err.message}`);
    console.log('     (The approval is still recorded locally.)');
  }

  // Remove from pending
  removePending(pending.id);
  console.log(`  🗑️  Removed from pending.\n`);
}

async function runReject(args) {
  if (!args[0]) {
    console.error('\n  ❌ Usage: ai2ai reject <number>');
    console.error('  Example: ai2ai reject 1\n');
    process.exit(1);
  }

  const num = parseInt(args[0]);
  if (isNaN(num)) {
    console.error(`\n  ❌ "${args[0]}" is not a valid number.\n`);
    process.exit(1);
  }

  const pending = getPendingByNumber(num);
  if (!pending) {
    console.error(`\n  ❌ No pending message #${num}. Run \`ai2ai pending\` to check.\n`);
    process.exit(1);
  }

  const reason = args.slice(1).join(' ').replace(/^["']|["']$/g, '') || 'Declined';
  const from = pending.envelope?.from?.human || pending.envelope?.from?.agent || 'Unknown';

  console.log(`\n  ❌ Rejecting message from ${from}...`);

  try {
    const result = await sendResponse(pending.envelope, 'reject', { reason });
    if (result) {
      console.log(`  📤 Rejection sent to ${from}'s agent.`);
    }
  } catch (err) {
    console.log(`  ⚠️  Could not send rejection: ${err.message}`);
  }

  removePending(pending.id);
  console.log(`  🗑️  Removed from pending.\n`);
}

module.exports = { run, runReject };
