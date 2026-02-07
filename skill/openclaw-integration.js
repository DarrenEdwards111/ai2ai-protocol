/**
 * AI2AI OpenClaw Integration
 *
 * Bridges the AI2AI protocol with OpenClaw's agent system:
 * - Parses natural language commands into AI2AI client calls
 * - Forwards incoming AI2AI messages to the human via their chat channel
 * - Routes human replies back as AI2AI responses
 * - Manages the pending approval flow
 *
 * Usage from an OpenClaw skill:
 *   const ai2ai = require('./openclaw-integration');
 *   const result = await ai2ai.handleCommand("schedule dinner with Alex next Thursday");
 *   // Or process pending: ai2ai.handleHumanReply(approvalId, "Thursday works");
 */

const path = require('path');
const { ping, requestMeeting, relayMessage, requestInfo, requestQuote, requestGroupMeeting } = require('./ai2ai-client');
const { listContacts, getContact, setTrustLevel, blockAgent } = require('./ai2ai-trust');
const { listPendingApprovals, resolvePendingApproval, removePendingApproval, runMaintenance } = require('./ai2ai-conversations');
const { listQueue } = require('./ai2ai-queue');
const { discover, startMdnsDiscovery } = require('./ai2ai-discovery');
const logger = require('./ai2ai-logger');

// ─── Natural Language → Intent Mapping ──────────────────────────────────────

/**
 * Parse a natural language command into an AI2AI action.
 *
 * Returns: { action, params, error? }
 *
 * Recognized patterns:
 *   "talk to <name>'s AI at <endpoint>"
 *   "schedule <event> with <name>"
 *   "send <name> a message: <text>"
 *   "ask <name> about <question>"
 *   "get a quote from <name> for <item>"
 *   "show contacts" / "ai2ai contacts"
 *   "ai2ai status"
 *   "ai2ai pending"
 *   "trust <name>" / "block <name>"
 *   "discover <domain>"
 */
function parseCommand(text) {
  const t = text.trim();

  // ─── Handshake / Connect ──────────────────────────────────────
  let m = t.match(/^(?:talk to|connect to|ping)\s+(.+?)(?:'s\s+AI)?\s+at\s+(.+)$/i);
  if (m) {
    return { action: 'ping', params: { name: m[1].trim(), endpoint: m[2].trim() } };
  }

  // ─── Schedule meeting ─────────────────────────────────────────
  m = t.match(/^schedule\s+(.+?)\s+with\s+(.+?)(?:\s+(?:on|at|next|for)\s+(.+))?$/i);
  if (m) {
    return {
      action: 'schedule',
      params: {
        subject: m[1].trim(),
        name: m[2].trim(),
        timeHint: m[3]?.trim() || null,
      },
    };
  }

  // ─── Send message ─────────────────────────────────────────────
  m = t.match(/^(?:send|tell|message)\s+(.+?)\s+(?:a message|that|saying)?[:\s]+(.+)$/i);
  if (m) {
    return { action: 'message', params: { name: m[1].trim(), message: m[2].trim() } };
  }

  // ─── Ask / Info request ───────────────────────────────────────
  m = t.match(/^ask\s+(.+?)\s+(?:about|if|whether)\s+(.+)$/i);
  if (m) {
    return { action: 'info', params: { name: m[1].trim(), question: m[2].trim() } };
  }

  // ─── Commerce / Quote ─────────────────────────────────────────
  m = t.match(/^(?:get a quote|request quote|buy|purchase)\s+(?:from\s+)?(.+?)\s+(?:for|about)\s+(.+)$/i);
  if (m) {
    return { action: 'commerce', params: { name: m[1].trim(), item: m[2].trim() } };
  }

  // ─── Trust management ─────────────────────────────────────────
  m = t.match(/^trust\s+(.+)$/i);
  if (m) return { action: 'trust', params: { name: m[1].trim(), level: 'trusted' } };

  m = t.match(/^block\s+(.+)$/i);
  if (m) return { action: 'block', params: { name: m[1].trim() } };

  // ─── Discovery ────────────────────────────────────────────────
  m = t.match(/^discover\s+(.+)$/i);
  if (m) return { action: 'discover', params: { domain: m[1].trim() } };

  // ─── Status commands ──────────────────────────────────────────
  if (/^(?:ai2ai\s+)?(?:show\s+)?contacts$/i.test(t)) return { action: 'contacts', params: {} };
  if (/^(?:ai2ai\s+)?status$/i.test(t)) return { action: 'status', params: {} };
  if (/^(?:ai2ai\s+)?pending$/i.test(t)) return { action: 'pending', params: {} };
  if (/^(?:ai2ai\s+)?queue$/i.test(t)) return { action: 'queue', params: {} };

  return { action: null, error: 'Could not understand AI2AI command. Try: "schedule X with Y", "send Y a message: ...", "show contacts"' };
}

// ─── Command Execution ──────────────────────────────────────────────────────

/**
 * Resolve a contact name to their endpoint.
 * Searches contacts by agent name or human name.
 */
function resolveContact(name) {
  const contacts = listContacts();
  const lower = name.toLowerCase();

  for (const [agentId, contact] of Object.entries(contacts)) {
    if (
      agentId.toLowerCase().includes(lower) ||
      (contact.humanName && contact.humanName.toLowerCase().includes(lower))
    ) {
      return { agentId, contact };
    }
  }
  return null;
}

/**
 * Execute a parsed AI2AI command.
 *
 * @param {object} parsed - Output of parseCommand()
 * @returns {Promise<{success: boolean, message: string, data?: any}>}
 */
async function executeCommand(parsed) {
  if (!parsed.action) {
    return { success: false, message: parsed.error };
  }

  try {
    switch (parsed.action) {
      case 'ping': {
        const { name, endpoint } = parsed.params;
        const result = await ping(endpoint);
        return {
          success: true,
          message: `✅ Connected to ${name}'s AI at ${endpoint}.\nCapabilities: ${result.payload?.capabilities?.join(', ') || 'unknown'}`,
          data: result,
        };
      }

      case 'schedule': {
        const { subject, name, timeHint } = parsed.params;
        const resolved = resolveContact(name);
        if (!resolved) {
          return { success: false, message: `❌ I don't know ${name}'s AI. Use "talk to ${name}'s AI at <endpoint>" first.` };
        }
        if (!resolved.contact.endpoint) {
          return { success: false, message: `❌ I know ${name}'s AI but don't have their endpoint. Re-connect with "talk to ${name}'s AI at <endpoint>".` };
        }

        // Generate some proposed times (basic heuristic from timeHint)
        const proposedTimes = generateProposedTimes(timeHint);

        const result = await requestMeeting(resolved.contact.endpoint, {
          subject,
          proposedTimes,
          to: { agent: resolved.agentId, human: resolved.contact.humanName },
        });

        return {
          success: true,
          message: `📅 Meeting request sent to ${name}'s AI: "${subject}"\nStatus: ${result.status}${result.conversation ? `\nConversation: ${result.conversation}` : ''}`,
          data: result,
        };
      }

      case 'message': {
        const { name, message } = parsed.params;
        const resolved = resolveContact(name);
        if (!resolved) {
          return { success: false, message: `❌ I don't know ${name}'s AI. Connect first.` };
        }
        if (!resolved.contact.endpoint) {
          return { success: false, message: `❌ No endpoint for ${name}'s AI.` };
        }

        const result = await relayMessage(resolved.contact.endpoint, {
          message,
          to: { agent: resolved.agentId, human: resolved.contact.humanName },
        });

        return {
          success: true,
          message: `💬 Message sent to ${name} via their AI.\nStatus: ${result.status}`,
          data: result,
        };
      }

      case 'info': {
        const { name, question } = parsed.params;
        const resolved = resolveContact(name);
        if (!resolved?.contact?.endpoint) {
          return { success: false, message: `❌ Can't reach ${name}'s AI.` };
        }

        const result = await requestInfo(resolved.contact.endpoint, {
          question,
          to: { agent: resolved.agentId, human: resolved.contact.humanName },
        });

        return {
          success: true,
          message: `❓ Question sent to ${name}'s AI: "${question}"\nStatus: ${result.status}`,
          data: result,
        };
      }

      case 'commerce': {
        const { name, item } = parsed.params;
        const resolved = resolveContact(name);
        if (!resolved?.contact?.endpoint) {
          return { success: false, message: `❌ Can't reach ${name}'s AI.` };
        }

        const result = await requestQuote(resolved.contact.endpoint, {
          item,
          to: { agent: resolved.agentId, human: resolved.contact.humanName },
        });

        return {
          success: true,
          message: `🛒 Quote request sent to ${name}'s AI for: "${item}"\nStatus: ${result.status}`,
          data: result,
        };
      }

      case 'trust': {
        const { name, level } = parsed.params;
        const resolved = resolveContact(name);
        if (!resolved) {
          return { success: false, message: `❌ Unknown contact: ${name}` };
        }
        const oldLevel = resolved.contact.trustLevel || 'none';
        setTrustLevel(resolved.agentId, level);
        logger.logTrustChange(resolved.agentId, oldLevel, level, 'manual');
        return { success: true, message: `✅ ${name}'s AI trust level: ${oldLevel} → ${level}` };
      }

      case 'block': {
        const { name } = parsed.params;
        const resolved = resolveContact(name);
        if (!resolved) {
          return { success: false, message: `❌ Unknown contact: ${name}` };
        }
        blockAgent(resolved.agentId);
        logger.logBlock(resolved.agentId, true);
        return { success: true, message: `🚫 ${name}'s AI has been blocked.` };
      }

      case 'discover': {
        const { domain } = parsed.params;
        const result = await discover(domain);
        if (!result) {
          return { success: false, message: `❌ No AI2AI endpoint found for ${domain}` };
        }
        return {
          success: true,
          message: `🔍 Found AI2AI endpoint for ${domain}:\n  Method: ${result.method}\n  Endpoint: ${result.endpoint}`,
          data: result,
        };
      }

      case 'contacts': {
        const contacts = listContacts();
        const entries = Object.entries(contacts);
        if (entries.length === 0) {
          return { success: true, message: '📋 No AI2AI contacts yet.' };
        }
        const lines = entries.map(([id, c]) =>
          `• **${c.humanName || id}** (${id}) — trust: ${c.trustLevel || 'none'}${c.blocked ? ' 🚫BLOCKED' : ''}${c.endpoint ? `\n  endpoint: ${c.endpoint}` : ''}`
        );
        return { success: true, message: `📋 **AI2AI Contacts:**\n\n${lines.join('\n')}` };
      }

      case 'status': {
        const contacts = listContacts();
        const pending = listPendingApprovals().filter(p => !p.resolved);
        const queued = listQueue().filter(q => q.status !== 'delivered');

        return {
          success: true,
          message: [
            '🦞 **AI2AI Status**',
            `  Contacts: ${Object.keys(contacts).length}`,
            `  Pending approvals: ${pending.length}`,
            `  Queued messages: ${queued.length}`,
          ].join('\n'),
        };
      }

      case 'pending': {
        const pending = listPendingApprovals().filter(p => !p.resolved);
        if (pending.length === 0) {
          return { success: true, message: '✅ No pending approvals.' };
        }
        const lines = pending.map((p, i) =>
          `${i + 1}. [${p.envelope?.id?.substring(0, 8)}] ${p.approvalMessage?.substring(0, 120)}...`
        );
        return {
          success: true,
          message: `📋 **Pending Approvals (${pending.length}):**\n\n${lines.join('\n\n')}`,
          data: pending,
        };
      }

      case 'queue': {
        const queued = listQueue();
        if (queued.length === 0) {
          return { success: true, message: '✅ Message queue is empty.' };
        }
        const lines = queued.map((q) =>
          `• [${q.id?.substring(0, 8)}] → ${q.endpoint} — ${q.status} (attempt ${q.attempt})`
        );
        return {
          success: true,
          message: `📬 **Message Queue (${queued.length}):**\n\n${lines.join('\n')}`,
        };
      }

      default:
        return { success: false, message: `Unknown action: ${parsed.action}` };
    }
  } catch (err) {
    logger.error('INTEGRATION', `Command failed: ${err.message}`, { action: parsed.action });
    return { success: false, message: `❌ Error: ${err.message}` };
  }
}

/**
 * High-level: parse and execute a natural language AI2AI command.
 */
async function handleCommand(text) {
  const parsed = parseCommand(text);
  logger.info('INTEGRATION', `Command: "${text}" → action=${parsed.action || 'unknown'}`);
  return executeCommand(parsed);
}

// ─── Human Reply Handling ───────────────────────────────────────────────────

/**
 * Handle a human's reply to a pending approval.
 *
 * @param {string} approvalId - The pending approval ID
 * @param {string} humanReply - The human's response text
 * @returns {Promise<{success: boolean, message: string, responseEnvelope?: object}>}
 */
async function handleHumanReply(approvalId, humanReply) {
  const pending = listPendingApprovals().find(p =>
    (p.envelope?.id === approvalId || p._filename === `${approvalId}.json`) && !p.resolved
  );

  if (!pending) {
    return { success: false, message: 'Approval not found or already resolved.' };
  }

  const isApproved = !['decline', 'reject', 'no', 'deny'].includes(humanReply.toLowerCase().trim());

  // Resolve the approval
  resolvePendingApproval(pending.envelope?.id || approvalId, isApproved, humanReply);

  if (!isApproved) {
    // Send rejection back
    const { createEnvelope, sendMessage } = require('./ai2ai-client');
    const contact = getContact(pending.envelope?.from?.agent);

    if (contact?.endpoint) {
      const rejectEnvelope = createEnvelope({
        to: pending.envelope.from,
        type: 'reject',
        intent: pending.envelope.intent,
        conversationId: pending.envelope.conversation,
        payload: { reason: humanReply },
      });

      try {
        await sendMessage(contact.endpoint, rejectEnvelope);
      } catch (err) {
        logger.warn('INTEGRATION', `Failed to send rejection: ${err.message}`);
      }
    }

    return { success: true, message: '❌ Declined and notified the other agent.' };
  }

  // If the handler has a formatResponse, use it to build the AI2AI response
  const handler = require('./ai2ai-handlers').getHandler(pending.handler);
  if (handler && pending.handler !== 'reply') {
    const result = handler(pending.envelope.payload, pending.envelope.from);
    if (result.formatResponse) {
      const formatted = result.formatResponse(humanReply);

      const { createEnvelope, sendMessage } = require('./ai2ai-client');
      const contact = getContact(pending.envelope?.from?.agent);

      if (contact?.endpoint) {
        const responseEnvelope = createEnvelope({
          to: pending.envelope.from,
          type: formatted.type || 'response',
          intent: formatted.intent || pending.envelope.intent,
          conversationId: pending.envelope.conversation,
          payload: formatted.payload,
        });

        try {
          const sendResult = await sendMessage(contact.endpoint, responseEnvelope);
          return {
            success: true,
            message: `✅ Your reply has been sent to ${pending.envelope.from?.human}'s AI.`,
            data: sendResult,
          };
        } catch (err) {
          return { success: false, message: `❌ Couldn't send reply: ${err.message}` };
        }
      }
    }
  }

  return { success: true, message: '✅ Approved.' };
}

// ─── Incoming Message Forwarding ────────────────────────────────────────────

/**
 * Get all unresolved pending approvals formatted for the human.
 * Call this periodically or on incoming messages to notify the human.
 */
function getNewNotifications() {
  return listPendingApprovals()
    .filter(p => !p.resolved && !p._notified)
    .map(p => ({
      id: p.envelope?.id,
      message: p.approvalMessage,
      from: p.envelope?.from?.human || p.envelope?.from?.agent,
      intent: p.envelope?.intent || p.handler,
      createdAt: p.createdAt,
      isInform: p.isInform || false,
    }));
}

/**
 * Mark notifications as sent to human
 */
function markNotified(approvalIds) {
  const fs = require('fs');
  const pendingDir = path.join(__dirname, 'pending');

  for (const id of approvalIds) {
    const filePath = path.join(pendingDir, `${id}.json`);
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      data._notified = true;
      data._notifiedAt = new Date().toISOString();
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Generate proposed times from a natural language hint.
 * Basic implementation — in production, would check calendar.
 */
function generateProposedTimes(timeHint) {
  const now = new Date();
  const times = [];

  if (!timeHint) {
    // Default: suggest next 3 evenings at 7pm
    for (let i = 1; i <= 3; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      d.setHours(19, 0, 0, 0);
      times.push(d.toISOString());
    }
    return times;
  }

  // Simple day-of-week parsing
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const lowerHint = timeHint.toLowerCase();

  for (let i = 0; i < days.length; i++) {
    if (lowerHint.includes(days[i])) {
      const d = new Date(now);
      const currentDay = d.getDay();
      let daysUntil = i - currentDay;
      if (daysUntil <= 0) daysUntil += 7;
      d.setDate(d.getDate() + daysUntil);
      d.setHours(19, 0, 0, 0);
      times.push(d.toISOString());
    }
  }

  if (lowerHint.includes('next week')) {
    for (let i = 1; i <= 5; i++) {
      const d = new Date(now);
      const daysUntilMonday = ((8 - d.getDay()) % 7) || 7;
      d.setDate(d.getDate() + daysUntilMonday + i - 1);
      d.setHours(19, 0, 0, 0);
      times.push(d.toISOString());
    }
  }

  if (lowerHint.includes('tomorrow')) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(19, 0, 0, 0);
    times.push(d.toISOString());
  }

  // Fallback: 3 days from now
  if (times.length === 0) {
    for (let i = 1; i <= 3; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      d.setHours(19, 0, 0, 0);
      times.push(d.toISOString());
    }
  }

  return times;
}

module.exports = {
  parseCommand,
  executeCommand,
  handleCommand,
  handleHumanReply,
  getNewNotifications,
  markNotified,
  resolveContact,
  generateProposedTimes,
};
