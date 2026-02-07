/**
 * AI2AI Intent Handlers
 * Each handler processes a specific intent type and returns a response payload.
 */

/**
 * Handle schedule.meeting intent
 */
function handleScheduleMeeting(payload, fromAgent) {
  const { subject, proposed_times, duration_minutes, location_preference, flexibility, notes } = payload;

  // Format for human approval
  const timesFormatted = proposed_times
    .map((t, i) => `  ${i + 1}. ${new Date(t).toLocaleString()}`)
    .join('\n');

  const approvalMessage = [
    `📅 **Meeting Request** from ${fromAgent.human}'s AI (${fromAgent.agent})`,
    ``,
    `**Subject:** ${subject || 'No subject'}`,
    `**Proposed times:**`,
    timesFormatted,
    `**Duration:** ${duration_minutes || 60} minutes`,
    location_preference ? `**Location:** ${location_preference}` : '',
    notes ? `**Notes:** ${notes}` : '',
    flexibility ? `**Flexibility:** ${flexibility}` : '',
    ``,
    `Reply with a number to accept a time, or suggest an alternative.`,
  ].filter(Boolean).join('\n');

  return {
    needsApproval: true,
    approvalMessage,
    formatResponse: (humanReply) => {
      const num = parseInt(humanReply);
      if (num >= 1 && num <= proposed_times.length) {
        return {
          type: 'response',
          payload: {
            accepted_time: proposed_times[num - 1],
            counter_proposal: null,
            message: `${fromAgent.human ? 'They' : 'The agent'} confirmed ${new Date(proposed_times[num - 1]).toLocaleString()}.`,
          },
        };
      }
      // Treat as counter-proposal or message
      return {
        type: 'response',
        payload: {
          accepted_time: null,
          counter_proposal: humanReply,
          message: humanReply,
        },
      };
    },
  };
}

/**
 * Handle message.relay intent
 */
function handleMessageRelay(payload, fromAgent) {
  const { message, urgency, reply_requested } = payload;

  const urgencyEmoji = urgency === 'high' ? '🔴' : urgency === 'medium' ? '🟡' : '💬';

  const approvalMessage = [
    `${urgencyEmoji} **Message** from ${fromAgent.human} (via their AI):`,
    ``,
    `"${message}"`,
    ``,
    reply_requested ? `They'd like a reply. Just type your response.` : `(No reply expected)`,
  ].join('\n');

  return {
    needsApproval: reply_requested,
    approvalMessage,
    formatResponse: reply_requested
      ? (humanReply) => ({
          type: 'response',
          payload: {
            message: humanReply,
            is_reply: true,
          },
        })
      : null,
  };
}

/**
 * Handle info.request intent
 */
function handleInfoRequest(payload, fromAgent) {
  const { question, context } = payload;

  const approvalMessage = [
    `❓ **Info Request** from ${fromAgent.human}'s AI:`,
    ``,
    `"${question}"`,
    context ? `\nContext: ${context}` : '',
    ``,
    `Reply with your answer, or say "decline" to skip.`,
  ].filter(Boolean).join('\n');

  return {
    needsApproval: true,
    approvalMessage,
    formatResponse: (humanReply) => {
      if (humanReply.toLowerCase().trim() === 'decline') {
        return { type: 'reject', payload: { reason: 'Declined to answer' } };
      }
      return {
        type: 'response',
        payload: { answer: humanReply },
      };
    },
  };
}

/**
 * Handle schedule.call intent
 */
function handleScheduleCall(payload, fromAgent) {
  // Reuse meeting logic with different framing
  return handleScheduleMeeting(
    { ...payload, subject: payload.subject || `Call with ${fromAgent.human}` },
    fromAgent
  );
}

/**
 * Handle info.share intent (informational, no response needed)
 */
function handleInfoShare(payload, fromAgent) {
  const { topic, content } = payload;

  const approvalMessage = [
    `ℹ️ **Info** from ${fromAgent.human}'s AI:`,
    topic ? `**Topic:** ${topic}` : '',
    ``,
    content,
  ].filter(Boolean).join('\n');

  return {
    needsApproval: false,
    approvalMessage,
    formatResponse: null,
  };
}

/**
 * Handle social.introduction intent
 */
function handleIntroduction(payload, fromAgent) {
  const { person_name, context, their_agent_address } = payload;

  const approvalMessage = [
    `👋 **Introduction** from ${fromAgent.human}'s AI:`,
    ``,
    `${fromAgent.human} wants to introduce you to **${person_name}**.`,
    context ? `Context: ${context}` : '',
    their_agent_address ? `Their AI is at: ${their_agent_address}` : '',
    ``,
    `Reply "accept" to connect, or "decline" to skip.`,
  ].filter(Boolean).join('\n');

  return {
    needsApproval: true,
    approvalMessage,
    formatResponse: (humanReply) => {
      const accepted = humanReply.toLowerCase().trim() === 'accept';
      return {
        type: accepted ? 'confirm' : 'reject',
        payload: {
          accepted,
          message: accepted ? 'Looking forward to connecting!' : 'Thanks, but not right now.',
        },
      };
    },
  };
}

// ─── Commerce Intents ───────────────────────────────────────────────────────

/**
 * Handle commerce.request — someone wants a quote
 * ALWAYS requires human approval regardless of trust level
 */
function handleCommerceRequest(payload, fromAgent) {
  const { item, description, quantity, budget, currency, notes } = payload;

  const approvalMessage = [
    `🛒 **Quote Request** from ${fromAgent.human}'s AI:`,
    ``,
    `**Item:** ${item || 'Unspecified'}`,
    description ? `**Description:** ${description}` : '',
    quantity ? `**Quantity:** ${quantity}` : '',
    budget ? `**Budget:** ${budget} ${currency || 'USD'}` : '',
    notes ? `**Notes:** ${notes}` : '',
    ``,
    `Reply with your quote, or "decline" to skip.`,
    `⚠️ This is a commerce request — your approval is always required.`,
  ].filter(Boolean).join('\n');

  return {
    needsApproval: true,
    alwaysRequiresApproval: true,
    approvalMessage,
    formatResponse: (humanReply) => {
      if (humanReply.toLowerCase().trim() === 'decline') {
        return { type: 'reject', intent: 'commerce.reject', payload: { reason: 'Not interested' } };
      }
      return {
        type: 'response',
        intent: 'commerce.offer',
        payload: {
          offer: humanReply,
          requires_acceptance: true,
        },
      };
    },
  };
}

/**
 * Handle commerce.offer — someone is making an offer
 */
function handleCommerceOffer(payload, fromAgent) {
  const { offer, price, currency, terms, expires, item } = payload;

  const approvalMessage = [
    `💰 **Offer** from ${fromAgent.human}'s AI:`,
    ``,
    item ? `**Item:** ${item}` : '',
    `**Offer:** ${offer || 'See details'}`,
    price ? `**Price:** ${price} ${currency || 'USD'}` : '',
    terms ? `**Terms:** ${terms}` : '',
    expires ? `**Expires:** ${new Date(expires).toLocaleString()}` : '',
    ``,
    `Reply "accept" to accept, "decline" to reject, or make a counter-offer.`,
    `⚠️ This is a commerce offer — your approval is always required.`,
  ].filter(Boolean).join('\n');

  return {
    needsApproval: true,
    alwaysRequiresApproval: true,
    approvalMessage,
    formatResponse: (humanReply) => {
      const lower = humanReply.toLowerCase().trim();
      if (lower === 'accept') {
        return { type: 'confirm', intent: 'commerce.accept', payload: { accepted: true, message: 'Accepted' } };
      }
      if (lower === 'decline' || lower === 'reject') {
        return { type: 'reject', intent: 'commerce.reject', payload: { reason: 'Declined' } };
      }
      // Counter-offer
      return {
        type: 'response',
        intent: 'commerce.offer',
        payload: { offer: humanReply, is_counter: true },
      };
    },
  };
}

/**
 * Handle commerce.accept
 */
function handleCommerceAccept(payload, fromAgent) {
  const approvalMessage = [
    `✅ **Offer Accepted** by ${fromAgent.human}'s AI:`,
    ``,
    payload.message ? `"${payload.message}"` : 'They accepted your offer.',
    ``,
    `This is for your records. No action needed.`,
  ].join('\n');

  return {
    needsApproval: false,
    approvalMessage,
    formatResponse: null,
  };
}

/**
 * Handle commerce.reject
 */
function handleCommerceReject(payload, fromAgent) {
  const approvalMessage = [
    `❌ **Offer Declined** by ${fromAgent.human}'s AI:`,
    ``,
    payload.reason ? `Reason: "${payload.reason}"` : 'No reason given.',
  ].join('\n');

  return {
    needsApproval: false,
    approvalMessage,
    formatResponse: null,
  };
}

// ─── Group Scheduling ───────────────────────────────────────────────────────

/**
 * Handle schedule.group — Find a time that works for everyone
 */
function handleScheduleGroup(payload, fromAgent) {
  const { subject, proposed_times, duration_minutes, participants, location_preference, notes } = payload;

  const timesFormatted = (proposed_times || [])
    .map((t, i) => `  ${i + 1}. ${new Date(t).toLocaleString()}`)
    .join('\n');

  const participantList = (participants || [])
    .map(p => p.human || p.agent || 'Unknown')
    .join(', ');

  const approvalMessage = [
    `📅 **Group Meeting Request** from ${fromAgent.human}'s AI (${fromAgent.agent})`,
    ``,
    `**Subject:** ${subject || 'No subject'}`,
    `**Participants:** ${participantList}`,
    `**Proposed times:**`,
    timesFormatted,
    `**Duration:** ${duration_minutes || 60} minutes`,
    location_preference ? `**Location:** ${location_preference}` : '',
    notes ? `**Notes:** ${notes}` : '',
    ``,
    `Reply with a number to accept a time, or suggest an alternative.`,
  ].filter(Boolean).join('\n');

  return {
    needsApproval: true,
    approvalMessage,
    formatResponse: (humanReply) => {
      const num = parseInt(humanReply);
      if (num >= 1 && num <= (proposed_times || []).length) {
        return {
          type: 'response',
          payload: {
            accepted_time: proposed_times[num - 1],
            counter_proposal: null,
            participant: fromAgent,
          },
        };
      }
      return {
        type: 'response',
        payload: {
          accepted_time: null,
          counter_proposal: humanReply,
          participant: fromAgent,
        },
      };
    },
  };
}

// Registry of intent handlers
const HANDLERS = {
  'schedule.meeting': handleScheduleMeeting,
  'schedule.call': handleScheduleCall,
  'schedule.group': handleScheduleGroup,
  'message.relay': handleMessageRelay,
  'info.request': handleInfoRequest,
  'info.share': handleInfoShare,
  'social.introduction': handleIntroduction,
  'commerce.request': handleCommerceRequest,
  'commerce.offer': handleCommerceOffer,
  'commerce.accept': handleCommerceAccept,
  'commerce.reject': handleCommerceReject,
};

/**
 * Get handler for an intent
 */
function getHandler(intent) {
  return HANDLERS[intent] || null;
}

/**
 * List supported intents
 */
function supportedIntents() {
  return Object.keys(HANDLERS);
}

module.exports = {
  getHandler,
  supportedIntents,
  HANDLERS,
};
