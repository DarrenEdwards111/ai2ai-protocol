/**
 * AI2AI Protocol — Comprehensive Test Suite
 *
 * Tests all modules: crypto, encryption, trust, handlers, server, client,
 * conversations, queue, discovery, logger, and OpenClaw integration.
 */

const fs = require('fs');
const path = require('path');

const PORT = 18801;
const ENDPOINT = `http://localhost:${PORT}/ai2ai`;

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`   ✅ ${message}`);
  } else {
    failed++;
    failures.push(message);
    console.log(`   ❌ ${message}`);
  }
}

function assertThrows(fn, message) {
  try {
    fn();
    failed++;
    failures.push(message);
    console.log(`   ❌ ${message} (expected to throw)`);
  } catch {
    passed++;
    console.log(`   ✅ ${message}`);
  }
}

function skip(message) {
  skipped++;
  console.log(`   ⏭️  ${message} (skipped)`);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Clean test state ───────────────────────────────────────────────────────

function cleanTestState() {
  // Clean up outbox, logs, and test conversation files
  const dirs = [
    path.join(__dirname, 'outbox'),
    path.join(__dirname, 'logs'),
  ];
  for (const dir of dirs) {
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
async function runTests() {
  console.log('🧪 AI2AI Protocol — Comprehensive Test Suite\n');
  cleanTestState();

  // ─── 1. Crypto ──────────────────────────────────────────────────────────
  console.log('━━━ 1. Crypto (Ed25519 signing) ━━━');
  const crypto = require('./ai2ai-crypto');
  {
    const keys = crypto.loadOrCreateKeys();
    assert(keys.publicKey.includes('PUBLIC KEY'), 'Load/create Ed25519 keys');

    const fingerprint = crypto.getFingerprint(keys.publicKey);
    assert(fingerprint.includes(':'), 'Generate fingerprint');
    assert(fingerprint.split(':').length === 8, 'Fingerprint has 8 groups');

    const testEnvelope = {
      id: 'test-123',
      timestamp: new Date().toISOString(),
      from: { agent: 'a', node: 'n', human: 'H' },
      to: { agent: 'b', node: 'n2', human: 'H2' },
      conversation: 'conv-1',
      type: 'ping',
      intent: null,
      payload: { hello: 'world' },
    };

    const sig = crypto.signMessage(testEnvelope, keys.privateKey);
    assert(typeof sig === 'string' && sig.length > 10, 'Sign message');

    const valid = crypto.verifyMessage(testEnvelope, sig, keys.publicKey);
    assert(valid === true, 'Verify valid signature');

    const tampered = { ...testEnvelope, payload: { hello: 'tampered' } };
    const invalid = crypto.verifyMessage(tampered, sig, keys.publicKey);
    assert(invalid === false, 'Reject tampered signature');
  }

  // ─── 2. Encryption ─────────────────────────────────────────────────────
  console.log('\n━━━ 2. Encryption (X25519 + AES-256-GCM) ━━━');
  const encryption = require('./ai2ai-encryption');
  {
    const keysA = encryption.generateX25519KeyPair();
    const keysB = encryption.generateX25519KeyPair();
    assert(keysA.publicKeyDer && keysA.publicKeyDer.length > 10, 'Generate X25519 keypair A');
    assert(keysB.publicKeyDer && keysB.publicKeyDer.length > 10, 'Generate X25519 keypair B');

    const payload = { secret: 'dinner at 7', location: 'Italian place' };

    // Encrypt with B's public key
    const encrypted = encryption.encryptPayloadX25519(payload, keysB.publicKeyDer);
    assert(encrypted !== null, 'Encrypt payload');
    assert(encrypted._encrypted === true, 'Encrypted flag set');
    assert(typeof encrypted.ephemeralPub === 'string', 'Has ephemeral public key');
    assert(typeof encrypted.nonce === 'string', 'Has nonce');
    assert(typeof encrypted.ciphertext === 'string', 'Has ciphertext');
    assert(typeof encrypted.tag === 'string', 'Has auth tag');

    // Decrypt with B's private key
    const decrypted = encryption.decryptPayloadX25519(encrypted, keysB.privateKey);
    assert(decrypted !== null, 'Decrypt payload');
    assert(decrypted.secret === 'dinner at 7', 'Decrypted content matches');
    assert(decrypted.location === 'Italian place', 'All fields preserved');

    // Wrong key should fail
    const wrongDecrypt = encryption.decryptPayloadX25519(encrypted, keysA.privateKey);
    assert(wrongDecrypt === null, 'Wrong key returns null (graceful failure)');

    // isEncrypted check
    assert(encryption.isEncrypted(encrypted) === true, 'isEncrypted detects encrypted payload');
    assert(encryption.isEncrypted({ hello: 'world' }) === false, 'isEncrypted rejects plain payload');
    assert(encryption.isEncrypted(null) === false, 'isEncrypted handles null');

    // Load/create persistent X25519 keys
    const persistentKeys = encryption.loadOrCreateX25519Keys();
    assert(persistentKeys.publicKeyDer && persistentKeys.privateKey, 'Load/create persistent X25519 keys');
  }

  // ─── 3. Trust ───────────────────────────────────────────────────────────
  console.log('\n━━━ 3. Trust Management ━━━');
  const trust = require('./ai2ai-trust');
  {
    // Clean test contact
    const testAgent = 'test-agent-' + Date.now();
    trust.upsertContact(testAgent, { humanName: 'Test Human', trustLevel: 'none' });

    const contact = trust.getContact(testAgent);
    assert(contact !== null, 'Create and retrieve contact');
    assert(contact.humanName === 'Test Human', 'Contact has correct name');
    assert(contact.trustLevel === 'none', 'Default trust level is none');

    // Trust levels
    assert(trust.requiresApproval(testAgent, 'schedule.meeting', 'request') === true, 'None: requires approval for requests');

    trust.setTrustLevel(testAgent, 'known');
    assert(trust.requiresApproval(testAgent, 'schedule.meeting', 'request') === true, 'Known: requires approval for requests');
    assert(trust.requiresApproval(testAgent, 'info.share', 'inform') === false, 'Known: auto-approve info share');

    trust.setTrustLevel(testAgent, 'trusted');
    assert(trust.requiresApproval(testAgent, 'schedule.meeting', 'request') === false, 'Trusted: auto-approve routine');
    assert(trust.requiresApproval(testAgent, 'commerce.request', 'request') === true, 'Trusted: still requires approval for commerce');

    // Block
    trust.blockAgent(testAgent);
    assert(trust.isBlocked(testAgent) === true, 'Block agent');

    // List contacts
    const contacts = trust.listContacts();
    assert(typeof contacts === 'object', 'List contacts returns object');

    // Invalid trust level
    assertThrows(() => trust.setTrustLevel(testAgent, 'invalid'), 'Reject invalid trust level');
  }

  // ─── 4. Handlers ───────────────────────────────────────────────────────
  console.log('\n━━━ 4. Intent Handlers ━━━');
  const handlers = require('./ai2ai-handlers');
  {
    const supported = handlers.supportedIntents();
    assert(supported.includes('schedule.meeting'), 'Has schedule.meeting');
    assert(supported.includes('message.relay'), 'Has message.relay');
    assert(supported.includes('commerce.request'), 'Has commerce.request');
    assert(supported.includes('commerce.offer'), 'Has commerce.offer');
    assert(supported.includes('commerce.accept'), 'Has commerce.accept');
    assert(supported.includes('commerce.reject'), 'Has commerce.reject');
    assert(supported.includes('schedule.group'), 'Has schedule.group');
    assert(supported.includes('info.request'), 'Has info.request');
    assert(supported.includes('social.introduction'), 'Has social.introduction');

    // Test schedule handler
    const schedResult = handlers.getHandler('schedule.meeting')(
      { subject: 'Dinner', proposed_times: ['2026-02-10T19:00:00Z'], duration_minutes: 60 },
      { agent: 'test', human: 'Test' }
    );
    assert(schedResult.needsApproval === true, 'Schedule requires approval');
    assert(schedResult.approvalMessage.includes('Meeting Request'), 'Schedule has approval message');
    const schedResponse = schedResult.formatResponse('1');
    assert(schedResponse.payload.accepted_time === '2026-02-10T19:00:00Z', 'Schedule accept by number');

    // Test commerce handler
    const commResult = handlers.getHandler('commerce.request')(
      { item: 'Widget', quantity: 10, budget: '100' },
      { agent: 'seller', human: 'Seller' }
    );
    assert(commResult.alwaysRequiresApproval === true, 'Commerce always requires approval');
    assert(commResult.approvalMessage.includes('Quote Request'), 'Commerce has approval message');

    // Test commerce offer
    const offerResult = handlers.getHandler('commerce.offer')(
      { offer: '50 per unit', price: 50, item: 'Widget' },
      { agent: 'buyer', human: 'Buyer' }
    );
    const acceptResponse = offerResult.formatResponse('accept');
    assert(acceptResponse.type === 'confirm', 'Accept offer returns confirm');
    const declineResponse = offerResult.formatResponse('decline');
    assert(declineResponse.type === 'reject', 'Decline offer returns reject');

    // Test message relay
    const msgResult = handlers.getHandler('message.relay')(
      { message: 'Hi!', urgency: 'low', reply_requested: true },
      { agent: 'test', human: 'Test' }
    );
    assert(msgResult.approvalMessage.includes('Hi!'), 'Message relay shows message');

    // Test group scheduling
    const groupResult = handlers.getHandler('schedule.group')(
      {
        subject: 'Team lunch',
        proposed_times: ['2026-02-10T12:00:00Z'],
        participants: [{ agent: 'a', human: 'Alice' }, { agent: 'b', human: 'Bob' }],
      },
      { agent: 'organizer', human: 'Organizer' }
    );
    assert(groupResult.approvalMessage.includes('Group Meeting'), 'Group schedule has correct title');
    assert(groupResult.approvalMessage.includes('Alice'), 'Group schedule lists participants');

    // Unknown handler
    assert(handlers.getHandler('nonexistent') === null, 'Unknown intent returns null');
  }

  // ─── 5. Logger ──────────────────────────────────────────────────────────
  console.log('\n━━━ 5. Logger ━━━');
  const logger = require('./ai2ai-logger');
  {
    logger.info('TEST', 'Test log entry', { key: 'value' });
    logger.warn('TEST', 'Test warning');
    logger.error('TEST', 'Test error', { code: 42 });

    logger.logOutgoing({ type: 'ping', intent: null, to: { agent: 'test' }, id: 'out-1', conversation: 'c1' });
    logger.logIncoming({ type: 'request', intent: 'schedule.meeting', from: { agent: 'test' }, id: 'in-1', conversation: 'c1' });
    logger.logTrustChange('test-agent', 'none', 'trusted', 'test');
    logger.logBlock('test-agent', true);

    // Read back logs
    const today = new Date().toISOString().split('T')[0];
    const logs = logger.readLog(today);
    assert(logs.length >= 4, `Logger wrote entries (found ${logs.length})`);
    assert(logs.some(l => l.cat === 'TEST' && l.msg === 'Test log entry'), 'Log contains test entry');
    assert(logs.some(l => l.cat === 'OUT'), 'Log contains outgoing message');
    assert(logs.some(l => l.cat === 'IN'), 'Log contains incoming message');
    assert(logs.some(l => l.cat === 'TRUST'), 'Log contains trust change');

    // Clean old logs (shouldn't delete today's)
    const cleaned = logger.cleanOldLogs(0); // 0 days = clean everything before today
    assert(typeof cleaned === 'number', 'cleanOldLogs returns count');
  }

  // ─── 6. Conversations ──────────────────────────────────────────────────
  console.log('\n━━━ 6. Conversation Management ━━━');
  const conversations = require('./ai2ai-conversations');
  {
    const convId = 'test-conv-' + Date.now();
    const conv = conversations.createConversation(convId, {
      intent: 'schedule.meeting',
      initiator: { agent: 'a', human: 'Alice' },
      recipient: { agent: 'b', human: 'Bob' },
    });
    assert(conv.state === 'proposed', 'New conversation is proposed');
    assert(conv.intent === 'schedule.meeting', 'Conversation has intent');

    // Transitions
    const neg = conversations.transitionState(convId, 'negotiating');
    assert(neg.state === 'negotiating', 'Transition to negotiating');

    const conf = conversations.transitionState(convId, 'confirmed');
    assert(conf.state === 'confirmed', 'Transition to confirmed');

    // Invalid transition
    const invalid = conversations.transitionState(convId, 'proposed');
    assert(invalid === null, 'Reject invalid transition (confirmed → proposed)');

    // List conversations
    const all = conversations.listConversations();
    assert(all.length >= 1, 'List conversations');

    const confirmed = conversations.listConversations('confirmed');
    assert(confirmed.some(c => c.id === convId), 'Filter conversations by state');

    // Add participant
    const convId2 = 'test-group-' + Date.now();
    conversations.createConversation(convId2, {
      intent: 'schedule.group',
      initiator: { agent: 'a', human: 'Alice' },
      participants: [{ agent: 'a', human: 'Alice' }, { agent: 'b', human: 'Bob' }],
    });
    const updated = conversations.addParticipant(convId2, { agent: 'c', human: 'Charlie' });
    assert(updated.participants.length === 3, 'Add participant to group');

    // Pending approval management
    const approvalId = 'test-approval-' + Date.now();
    const pendingDir = path.join(__dirname, 'pending');
    fs.writeFileSync(path.join(pendingDir, `${approvalId}.json`), JSON.stringify({
      envelope: { id: approvalId, from: { agent: 'test' } },
      approvalMessage: 'Test approval',
      createdAt: new Date().toISOString(),
    }));

    const pendingList = conversations.listPendingApprovals();
    assert(pendingList.some(p => p.envelope?.id === approvalId), 'List pending approvals');

    const resolved = conversations.resolvePendingApproval(approvalId, true, 'Yes please');
    assert(resolved.approved === true, 'Resolve pending approval');

    // Clean up test approval
    conversations.removePendingApproval(approvalId);

    // Stale approval cleanup
    const staleId = 'stale-approval-' + Date.now();
    fs.writeFileSync(path.join(pendingDir, `${staleId}.json`), JSON.stringify({
      envelope: { id: staleId, from: { agent: 'stale' } },
      approvalMessage: 'Stale',
      createdAt: new Date(Date.now() - 25 * 3600000).toISOString(), // 25 hours ago
    }));

    const cleanResult = conversations.cleanupPendingApprovals(24);
    assert(cleanResult.expired >= 1, 'Auto-reject stale approvals');
    conversations.removePendingApproval(staleId);
  }

  // ─── 7. Queue ───────────────────────────────────────────────────────────
  console.log('\n━━━ 7. Message Queue ━━━');
  const queue = require('./ai2ai-queue');
  {
    const testEnvelope = {
      id: 'queue-test-' + Date.now(),
      type: 'request',
      intent: 'message.relay',
      to: { agent: 'offline-agent' },
      payload: { message: 'test' },
    };

    const queueId = queue.enqueue('http://localhost:99999/ai2ai', testEnvelope);
    assert(typeof queueId === 'string', 'Enqueue returns queue ID');

    const queued = queue.listQueue();
    assert(queued.some(q => q.id === queueId), 'Message appears in queue');

    const entry = queue.loadEntry(queueId);
    assert(entry.status === 'queued', 'Entry status is queued');
    assert(entry.attempt === 0, 'Entry has 0 attempts');

    // Test delivery attempt with a failing send function
    let failCallCount = 0;
    const failSend = async () => { failCallCount++; throw new Error('Connection refused'); };

    const delivered = await queue.attemptDelivery(queueId, failSend, null);
    assert(delivered === false, 'Delivery fails gracefully');
    assert(failCallCount === 1, 'Send function was called');

    const afterAttempt = queue.loadEntry(queueId);
    assert(afterAttempt.attempt === 1, 'Attempt count incremented');
    assert(afterAttempt.lastError === 'Connection refused', 'Error recorded');

    // Test successful delivery
    const queueId2 = queue.enqueue('http://localhost:99999/ai2ai', { ...testEnvelope, id: 'queue-test-2-' + Date.now() });
    const successSend = async () => ({ status: 'ok' });
    const delivered2 = await queue.attemptDelivery(queueId2, successSend, null);
    assert(delivered2 === true, 'Successful delivery returns true');
    assert(queue.loadEntry(queueId2) === null, 'Delivered entry removed from queue');

    // Clean up
    queue.removeEntry(queueId);
    queue.cancelAllRetries();

    // Clean queue
    const cleaned = queue.cleanQueue(0);
    assert(typeof cleaned === 'number', 'cleanQueue returns count');
  }

  // ─── 8. Server ──────────────────────────────────────────────────────────
  console.log('\n━━━ 8. Server ━━━');
  const { startServer } = require('./ai2ai-server');
  {
    console.log('   Starting test server on port ' + PORT + '...');
    const server = startServer(PORT);
    await sleep(500);

    try {
      // Health check
      const healthRes = await fetch(`http://localhost:${PORT}/ai2ai/health`);
      const health = await healthRes.json();
      assert(health.status === 'online', 'Health check returns online');
      assert(health.intents.includes('commerce.request'), 'Health lists commerce intent');

      // .well-known/ai2ai.json
      const wellKnownRes = await fetch(`http://localhost:${PORT}/.well-known/ai2ai.json`);
      const wellKnown = await wellKnownRes.json();
      assert(wellKnown.ai2ai === '0.1', '.well-known has protocol version');
      assert(wellKnown.endpoint.includes('/ai2ai'), '.well-known has endpoint');
      assert(wellKnown.capabilities.length > 0, '.well-known has capabilities');

      // Ping
      const { ping } = require('./ai2ai-client');
      const pingResult = await ping(ENDPOINT);
      assert(pingResult.status === 'ok', 'Ping returns ok');
      assert(pingResult.payload?.x25519_public_key, 'Ping returns X25519 public key');

      // Meeting request
      const { requestMeeting } = require('./ai2ai-client');
      const meetingResult = await requestMeeting(ENDPOINT, {
        subject: 'Test Dinner',
        proposedTimes: ['2026-02-10T19:00:00Z', '2026-02-11T19:00:00Z'],
        durationMinutes: 60,
        location: 'Coffee shop',
      });
      assert(meetingResult.status === 'pending_approval', 'Meeting request is pending approval');
      assert(meetingResult.conversation, 'Meeting has conversation ID');

      // Message relay
      const { relayMessage } = require('./ai2ai-client');
      const msgResult = await relayMessage(ENDPOINT, {
        message: 'Test message from AI2AI tests',
        urgency: 'low',
        replyRequested: true,
      });
      assert(msgResult.status === 'pending_approval', 'Message relay is pending');

      // Commerce request
      const { requestQuote } = require('./ai2ai-client');
      const quoteResult = await requestQuote(ENDPOINT, {
        item: 'Test Widget',
        quantity: 5,
        budget: '100',
      });
      assert(quoteResult.status === 'pending_approval', 'Commerce request is pending');

      // Invalid message
      const badRes = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ garbage: true }),
      });
      const badResult = await badRes.json();
      assert(badResult.error === 'Invalid AI2AI envelope', 'Reject invalid envelope');

      // Invalid JSON
      const badJsonRes = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json at all{{{',
      });
      assert(badJsonRes.status === 400, 'Reject invalid JSON');

      // 404 for unknown routes
      const notFoundRes = await fetch(`http://localhost:${PORT}/nope`);
      assert(notFoundRes.status === 404, '404 for unknown routes');

      // Check pending approvals exist
      const pendingDir = path.join(__dirname, 'pending');
      const pending = fs.readdirSync(pendingDir).filter(f => f.endsWith('.json'));
      assert(pending.length >= 3, `Pending approvals created (found ${pending.length})`);

      // Check conversations exist
      const convDir = path.join(__dirname, 'conversations');
      const convs = fs.readdirSync(convDir).filter(f => f.endsWith('.jsonl'));
      assert(convs.length >= 1, `Conversations recorded (found ${convs.length})`);

    } finally {
      server.close();
      await sleep(200);
    }
  }

  // ─── 9. OpenClaw Integration ────────────────────────────────────────────
  console.log('\n━━━ 9. OpenClaw Integration ━━━');
  const integration = require('./openclaw-integration');
  {
    // Parse command tests
    let parsed;

    parsed = integration.parseCommand("talk to Alex's AI at http://localhost:18800/ai2ai");
    assert(parsed.action === 'ping', 'Parse: talk to → ping');
    assert(parsed.params.name === 'Alex', 'Parse: extracts name');
    assert(parsed.params.endpoint === 'http://localhost:18800/ai2ai', 'Parse: extracts endpoint');

    parsed = integration.parseCommand('schedule dinner with Alex on Thursday');
    assert(parsed.action === 'schedule', 'Parse: schedule → schedule');
    assert(parsed.params.subject === 'dinner', 'Parse: extracts subject');
    assert(parsed.params.name === 'Alex', 'Parse: extracts name');
    assert(parsed.params.timeHint === 'Thursday', 'Parse: extracts time hint');

    parsed = integration.parseCommand('send Bob a message: Hey, how are you?');
    assert(parsed.action === 'message', 'Parse: send → message');
    assert(parsed.params.name === 'Bob', 'Parse: extracts recipient');
    assert(parsed.params.message === 'Hey, how are you?', 'Parse: extracts message text');

    parsed = integration.parseCommand('ask Charlie about the project deadline');
    assert(parsed.action === 'info', 'Parse: ask → info');
    assert(parsed.params.question === 'the project deadline', 'Parse: extracts question');

    parsed = integration.parseCommand('get a quote from Seller for 10 widgets');
    assert(parsed.action === 'commerce', 'Parse: get a quote → commerce');
    assert(parsed.params.item === '10 widgets', 'Parse: extracts item');

    parsed = integration.parseCommand('trust Alex');
    assert(parsed.action === 'trust', 'Parse: trust → trust');

    parsed = integration.parseCommand('block Spammer');
    assert(parsed.action === 'block', 'Parse: block → block');

    parsed = integration.parseCommand('discover example.com');
    assert(parsed.action === 'discover', 'Parse: discover → discover');

    parsed = integration.parseCommand('show contacts');
    assert(parsed.action === 'contacts', 'Parse: show contacts → contacts');

    parsed = integration.parseCommand('ai2ai status');
    assert(parsed.action === 'status', 'Parse: ai2ai status → status');

    parsed = integration.parseCommand('ai2ai pending');
    assert(parsed.action === 'pending', 'Parse: ai2ai pending → pending');

    parsed = integration.parseCommand('ai2ai queue');
    assert(parsed.action === 'queue', 'Parse: ai2ai queue → queue');

    parsed = integration.parseCommand('banana smoothie recipe');
    assert(parsed.action === null, 'Parse: unrecognized → null');
    assert(parsed.error, 'Parse: unrecognized has error message');

    // Status command execution (doesn't need server)
    const statusResult = await integration.handleCommand('ai2ai status');
    assert(statusResult.success === true, 'Status command succeeds');
    assert(statusResult.message.includes('AI2AI Status'), 'Status has header');

    const contactsResult = await integration.handleCommand('show contacts');
    assert(contactsResult.success === true, 'Contacts command succeeds');

    // Unknown contact
    const unknownResult = await integration.handleCommand('schedule dinner with UnknownPerson999');
    assert(unknownResult.success === false, 'Fail gracefully for unknown contact');
    assert(unknownResult.message.includes("don't know"), 'Error message mentions unknown contact');

    // Notifications
    const notifications = integration.getNewNotifications();
    assert(Array.isArray(notifications), 'getNewNotifications returns array');

    // Proposed times generation
    const times = integration.generateProposedTimes(null);
    assert(times.length === 3, 'Default generates 3 proposed times');

    const thursdayTimes = integration.generateProposedTimes('Thursday');
    assert(thursdayTimes.length >= 1, 'Thursday hint generates times');

    const tomorrowTimes = integration.generateProposedTimes('tomorrow');
    assert(tomorrowTimes.length >= 1, 'Tomorrow hint generates times');
  }

  // ─── 10. Discovery ─────────────────────────────────────────────────────
  console.log('\n━━━ 10. Discovery ━━━');
  const discovery = require('./ai2ai-discovery');
  {
    // Well-known JSON generation
    const wellKnownJson = discovery.generateWellKnownJson({
      port: 18800,
      agentName: 'test-agent',
      humanName: 'Test Human',
    });
    assert(wellKnownJson.ai2ai === '0.1', 'Well-known has protocol version');
    assert(wellKnownJson.agent === 'test-agent', 'Well-known has agent name');
    assert(wellKnownJson.capabilities.length > 0, 'Well-known has capabilities');

    // DNS TXT lookup (will fail for nonexistent domain, but shouldn't crash)
    const dnsResult = await discovery.lookupDnsTxt('this-domain-definitely-does-not-exist-ai2ai.example');
    assert(dnsResult === null, 'DNS TXT returns null for nonexistent domain');

    // DNS SRV lookup
    const srvResult = await discovery.lookupDnsSrv('this-domain-definitely-does-not-exist-ai2ai.example');
    assert(srvResult === null, 'DNS SRV returns null for nonexistent domain');

    // .well-known fetch (will fail for nonexistent domain)
    const fetchResult = await discovery.fetchWellKnown('this-domain-definitely-does-not-exist-ai2ai.example');
    assert(fetchResult === null, 'Well-known fetch returns null for unreachable domain');

    // Unified discover
    const discoverResult = await discovery.discover('this-domain-definitely-does-not-exist-ai2ai.example');
    assert(discoverResult === null, 'Unified discover returns null when all methods fail');

    // mDNS (start/stop without crashing)
    // Skip actual mDNS in CI/test — just test the API shape
    skip('mDNS start/stop (requires network multicast)');
  }

  // ─── 11. Encryption roundtrip via client/server ─────────────────────────
  console.log('\n━━━ 11. Encryption Integration ━━━');
  {
    const { encryptPayloadX25519, decryptPayloadX25519, generateX25519KeyPair, isEncrypted } = encryption;

    // Full roundtrip: encrypt → transmit → decrypt
    const senderKeys = generateX25519KeyPair();
    const recipientKeys = generateX25519KeyPair();

    const original = {
      subject: 'Secret meeting',
      proposed_times: ['2026-02-10T19:00:00Z'],
      location_preference: 'undisclosed',
    };

    const enc = encryptPayloadX25519(original, recipientKeys.publicKeyDer);
    assert(isEncrypted(enc), 'Roundtrip: payload is encrypted');
    assert(!enc.subject, 'Roundtrip: original fields not visible');

    const dec = decryptPayloadX25519(enc, recipientKeys.privateKey);
    assert(dec.subject === 'Secret meeting', 'Roundtrip: decrypted matches original');
    assert(dec.proposed_times[0] === '2026-02-10T19:00:00Z', 'Roundtrip: array fields preserved');

    // Empty payload
    const emptyEnc = encryptPayloadX25519({}, recipientKeys.publicKeyDer);
    const emptyDec = decryptPayloadX25519(emptyEnc, recipientKeys.privateKey);
    assert(JSON.stringify(emptyDec) === '{}', 'Roundtrip: empty payload works');

    // Large payload
    const largePayload = { data: 'x'.repeat(10000), nested: { deep: true } };
    const largeEnc = encryptPayloadX25519(largePayload, recipientKeys.publicKeyDer);
    const largeDec = decryptPayloadX25519(largeEnc, recipientKeys.privateKey);
    assert(largeDec.data.length === 10000, 'Roundtrip: large payload works');
  }

  // ─── 12. Error Recovery ─────────────────────────────────────────────────
  console.log('\n━━━ 12. Error Recovery ━━━');
  {
    // Bad encryption data
    const badDecrypt = encryption.decryptPayloadX25519(
      { _encrypted: true, ephemeralPub: 'bad', nonce: 'bad', ciphertext: 'bad', tag: 'bad' },
      encryption.generateX25519KeyPair().privateKey
    );
    assert(badDecrypt === null, 'Bad encryption data returns null');

    // Encrypt with null/undefined
    const nullEnc = encryption.encryptPayloadX25519(null, 'bad-key');
    assert(nullEnc === null, 'Encrypt null payload returns null');

    // Client with unreachable endpoint (without queue)
    const client = require('./ai2ai-client');
    try {
      const oldQueue = client.CONFIG.enableQueue;
      client.CONFIG.enableQueue = false;
      await client.sendMessage('http://localhost:1/ai2ai', client.createEnvelope({
        to: { agent: 'test' }, type: 'ping', payload: {},
      }), { queue: false });
      assert(false, 'Should have thrown for unreachable endpoint');
    } catch (err) {
      assert(err.message.includes('Failed to reach'), 'Meaningful error for unreachable endpoint');
    } finally {
      client.CONFIG.enableQueue = true;
    }

    // Blocked agent
    trust.blockAgent('blocked-test-agent');
    try {
      await client.sendMessage('http://localhost:1/ai2ai', client.createEnvelope({
        to: { agent: 'blocked-test-agent' }, type: 'ping', payload: {},
      }));
      assert(false, 'Should have thrown for blocked agent');
    } catch (err) {
      assert(err.message.includes('blocked'), 'Error message mentions blocked');
    }
  }

  // ─── Summary ────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log(`  ✅ Passed: ${passed}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log(`  ⏭️  Skipped: ${skipped}`);
  console.log('═'.repeat(60));

  if (failures.length > 0) {
    console.log('\n  Failures:');
    failures.forEach(f => console.log(`    • ${f}`));
  }

  console.log();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('❌ Test suite crashed:', err);
  process.exit(1);
});
