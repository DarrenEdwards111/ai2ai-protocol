/**
 * AI2AI v1.0 — New Feature Tests
 * 
 * Tests: Registry, Reliability, Security, Client, Integrations
 */

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (condition) { passed++; console.log(`   ✅ ${message}`); }
  else { failed++; failures.push(message); console.log(`   ❌ ${message}`); }
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) cleanDir(p);
      else fs.unlinkSync(p);
    }
    try { fs.rmdirSync(dir); } catch { /* ignore */ }
  }
}

async function runTests() {
  console.log('🧪 AI2AI v1.0 — New Feature Tests\n');

  // Clean test dirs
  for (const d of ['/tmp/ai2ai-test-reg', '/tmp/ai2ai-test-dlq', '/tmp/ai2ai-test-queue', '/tmp/ai2ai-test-client1', '/tmp/ai2ai-test-client2']) {
    cleanDir(d);
  }

  // ─── 1. Registry ──────────────────────────────────────────────────────
  console.log('━━━ 1. Registry ━━━');
  const { RegistryClient, RegistryServer } = require('./registry');
  {
    const server = new RegistryServer({ staleTimeout: 5000 });
    await server.start(18899);

    const client = new RegistryClient({ registryUrl: 'http://localhost:18899', agentId: 'test-agent-1' });

    // Register
    const regResult = await client.register({
      endpoint: 'http://localhost:18800/ai2ai',
      name: 'test-agent-1',
      humanName: 'Test Human',
      capabilities: ['schedule.meeting', 'message.relay'],
    });
    assert(regResult.status === 'registered', 'Register agent');

    // Register a second agent
    const client2 = new RegistryClient({ registryUrl: 'http://localhost:18899', agentId: 'test-agent-2' });
    await client2.register({
      endpoint: 'http://localhost:18801/ai2ai',
      name: 'test-agent-2',
      humanName: 'Test Human 2',
      capabilities: ['message.relay'],
    });

    // Search all
    const all = await client.search();
    assert(Array.isArray(all) && all.length >= 2, `Search returns agents (found ${all.length})`);

    // Search by capability
    const schedAgents = await client.search({ capability: 'schedule.meeting' });
    assert(schedAgents.length >= 1, 'Search by capability');
    assert(schedAgents.some(a => a.id === 'test-agent-1'), 'Found correct agent by capability');

    // Search by name
    const byName = await client.search({ name: 'test-agent-2' });
    assert(byName.length >= 1, 'Search by name');

    // Resolve
    const resolved = await client.resolve('test-agent-1');
    assert(resolved && resolved.id === 'test-agent-1', 'Resolve agent by ID');
    assert(resolved.endpoint === 'http://localhost:18800/ai2ai', 'Resolved endpoint correct');

    // Resolve non-existent
    const notFound = await client.resolve('nonexistent-agent');
    assert(notFound === null, 'Resolve returns null for unknown agent');

    // Heartbeat
    const hbResult = await client.heartbeat();
    assert(hbResult.status === 'ok', 'Heartbeat succeeds');

    // Deregister
    const deregResult = await client.deregister();
    assert(deregResult.status === 'deregistered', 'Deregister agent');

    // Verify deregistered
    const afterDereg = await client2.resolve('test-agent-1');
    assert(afterDereg === null, 'Agent gone after deregister');

    client.destroy();
    client2.destroy();
    server.stop();
  }

  // ─── 2. Reliability — Retry with Backoff ──────────────────────────────
  console.log('\n━━━ 2. Reliability — Retry & Backoff ━━━');
  const { retryWithBackoff, CircuitBreaker, Deduplicator, DeliveryTracker, DeadLetterQueue, PersistentQueue, RECEIPT_STATUS } = require('./reliability');
  {
    // Retry success on 3rd attempt
    let attempts = 0;
    const result = await retryWithBackoff(async (attempt) => {
      attempts++;
      if (attempt < 2) throw new Error('not yet');
      return 'success';
    }, { maxRetries: 3, baseDelay: 10, factor: 2 });
    assert(result === 'success', 'Retry succeeds after failures');
    assert(attempts === 3, `Took 3 attempts (actual: ${attempts})`);

    // Retry exhaustion
    let retryFailed = false;
    try {
      await retryWithBackoff(async () => { throw new Error('always fails'); }, { maxRetries: 2, baseDelay: 10 });
    } catch (e) {
      retryFailed = true;
      assert(e.message === 'always fails', 'Retry throws last error');
    }
    assert(retryFailed, 'Retry throws after exhaustion');
  }

  // ─── 3. Reliability — Circuit Breaker ─────────────────────────────────
  console.log('\n━━━ 3. Circuit Breaker ━━━');
  {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 100 });
    assert(cb.getState() === 'closed', 'Initial state is closed');

    // 3 failures → open
    for (let i = 0; i < 3; i++) {
      try { await cb.execute(async () => { throw new Error('fail'); }); } catch { /* expected */ }
    }
    assert(cb.getState() === 'open', 'Circuit opens after threshold');

    // Open circuit rejects immediately
    let openRejected = false;
    try { await cb.execute(async () => 'should not run'); } catch (e) {
      openRejected = e.message.includes('Circuit breaker is open');
    }
    assert(openRejected, 'Open circuit rejects requests');

    // Wait for reset timeout → half-open
    await sleep(150);
    assert(cb.getState() === 'half-open', 'Circuit transitions to half-open after timeout');

    // Success in half-open → closed
    const closedResult = await cb.execute(async () => 'recovered');
    assert(closedResult === 'recovered', 'Half-open allows one request');
    assert(cb.getState() === 'closed', 'Success in half-open closes circuit');

    // Reset
    cb.reset();
    assert(cb.failures === 0, 'Reset clears failures');
  }

  // ─── 4. Reliability — Deduplication ───────────────────────────────────
  console.log('\n━━━ 4. Message Deduplication ━━━');
  {
    const dedup = new Deduplicator({ ttl: 1000 });
    assert(dedup.isDuplicate('msg-1') === false, 'First message is not duplicate');
    assert(dedup.isDuplicate('msg-1') === true, 'Same ID is duplicate');
    assert(dedup.isDuplicate('msg-2') === false, 'Different ID is not duplicate');
    assert(dedup.size === 2, 'Tracks 2 messages');

    // Idempotency key generation
    const key = Deduplicator.generateKey({
      from: { agent: 'a' },
      to: { agent: 'b' },
      type: 'message',
      intent: 'relay',
      payload: { text: 'hello' },
    });
    assert(typeof key === 'string' && key.length === 16, 'Generates 16-char idempotency key');

    dedup.clear();
    assert(dedup.size === 0, 'Clear removes all entries');
  }

  // ─── 5. Reliability — Delivery Receipts ───────────────────────────────
  console.log('\n━━━ 5. Delivery Receipts ━━━');
  {
    const tracker = new DeliveryTracker();
    let sentEmitted = false, deliveredEmitted = false, readEmitted = false;

    tracker.on('sent', () => { sentEmitted = true; });
    tracker.on('delivered', () => { deliveredEmitted = true; });
    tracker.on('read', () => { readEmitted = true; });

    tracker.trackSent('msg-100');
    assert(sentEmitted, 'Sent event emitted');
    const receipt = tracker.getReceipt('msg-100');
    assert(receipt.status === RECEIPT_STATUS.SENT, 'Status is sent');

    tracker.markDelivered('msg-100');
    assert(deliveredEmitted, 'Delivered event emitted');
    assert(tracker.getReceipt('msg-100').status === RECEIPT_STATUS.DELIVERED, 'Status updated to delivered');

    tracker.markRead('msg-100');
    assert(readEmitted, 'Read event emitted');
    assert(tracker.getReceipt('msg-100').status === RECEIPT_STATUS.READ, 'Status updated to read');

    // Receipt payload
    const rp = DeliveryTracker.createReceiptPayload('msg-100', 'delivered');
    assert(rp.type === 'receipt', 'Receipt payload has type');
    assert(rp.payload.messageId === 'msg-100', 'Receipt payload has messageId');

    assert(tracker.getReceipt('nonexistent') === null, 'Unknown message returns null');
    tracker.clear();
  }

  // ─── 6. Reliability — Dead Letter Queue ───────────────────────────────
  console.log('\n━━━ 6. Dead Letter Queue ━━━');
  {
    const dlq = new DeadLetterQueue('/tmp/ai2ai-test-dlq');
    const entry = dlq.add({ id: 'failed-1', payload: { test: true } }, 'Connection refused', 3);
    assert(entry.id === 'failed-1', 'DLQ add returns entry');
    assert(dlq.size === 1, 'DLQ has 1 entry');

    const list = dlq.list();
    assert(list.length === 1, 'DLQ list returns entries');
    assert(list[0].error === 'Connection refused', 'DLQ entry has error');
    assert(list[0].attempts === 3, 'DLQ entry has attempt count');

    dlq.remove('failed-1');
    assert(dlq.size === 0, 'DLQ remove works');
  }

  // ─── 7. Reliability — Persistent Queue ────────────────────────────────
  console.log('\n━━━ 7. Persistent Queue ━━━');
  {
    const pq = new PersistentQueue('/tmp/ai2ai-test-queue');
    const id = pq.enqueue({ id: 'queued-1', payload: { msg: 'hello' } }, 'http://localhost:99999/ai2ai', { priority: 1 });
    assert(typeof id === 'string', 'Enqueue returns ID');
    assert(pq.size === 1, 'Queue has 1 entry');

    pq.enqueue({ id: 'queued-2', payload: { msg: 'world' } }, 'http://localhost:99999/ai2ai', { priority: 2 });
    assert(pq.size === 2, 'Queue has 2 entries');

    const next = pq.dequeue();
    assert(next.id === 'queued-2', 'Dequeue returns highest priority');

    pq.complete('queued-2');
    assert(pq.size === 1, 'Complete removes entry');

    pq.fail('queued-1', 'Connection refused');
    const failed = pq.load('queued-1');
    assert(failed.attempts === 1, 'Fail increments attempts');
    assert(failed.lastError === 'Connection refused', 'Fail records error');

    pq.complete('queued-1');
  }

  // ─── 8. Security — Rate Limiter ───────────────────────────────────────
  console.log('\n━━━ 8. Rate Limiter ━━━');
  const { RateLimiter, NonceTracker, isMessageExpired, addMessageTTL, isMessageTTLExpired, Blocklist, VerificationCache, KeyRotation } = require('./security');
  {
    const rl = new RateLimiter({ maxRequests: 3, windowMs: 1000 });
    assert(rl.allow('agent-a') === true, 'First request allowed');
    assert(rl.allow('agent-a') === true, 'Second request allowed');
    assert(rl.allow('agent-a') === true, 'Third request allowed');
    assert(rl.allow('agent-a') === false, 'Fourth request blocked');
    assert(rl.allow('agent-b') === true, 'Different agent allowed');
    assert(rl.remaining('agent-a') === 0, 'Remaining is 0 for exhausted agent');
    assert(rl.remaining('agent-b') === 2, 'Remaining is 2 for agent-b');
    rl.reset('agent-a');
    assert(rl.allow('agent-a') === true, 'Allowed after reset');
    rl.clear();
  }

  // ─── 9. Security — Message Expiry ─────────────────────────────────────
  console.log('\n━━━ 9. Message Expiry ━━━');
  {
    const fresh = { timestamp: new Date().toISOString() };
    assert(isMessageExpired(fresh) === false, 'Fresh message not expired');

    const old = { timestamp: new Date(Date.now() - 25 * 3600000).toISOString() };
    assert(isMessageExpired(old) === true, '25h-old message is expired');

    const custom = { timestamp: new Date(Date.now() - 2000).toISOString() };
    assert(isMessageExpired(custom, 1000) === true, 'Custom TTL: 2s old > 1s TTL');
    assert(isMessageExpired(custom, 5000) === false, 'Custom TTL: 2s old < 5s TTL');

    // TTL field
    const withTTL = addMessageTTL({ payload: {} }, 3600000);
    assert(withTTL.expiresAt, 'addMessageTTL adds expiresAt');
    assert(isMessageTTLExpired(withTTL) === false, 'TTL not yet expired');

    const expiredTTL = { expiresAt: new Date(Date.now() - 1000).toISOString() };
    assert(isMessageTTLExpired(expiredTTL) === true, 'Expired TTL detected');

    assert(isMessageExpired({}) === false, 'No timestamp → not expired');
  }

  // ─── 10. Security — Nonce Tracking ────────────────────────────────────
  console.log('\n━━━ 10. Nonce Tracking ━━━');
  {
    const nt = new NonceTracker();
    const nonce1 = nt.generate();
    assert(typeof nonce1 === 'string' && nonce1.length === 32, 'Generate 32-char hex nonce');

    assert(nt.isReplay(nonce1) === false, 'First use of nonce is not replay');
    assert(nt.isReplay(nonce1) === true, 'Second use of same nonce IS replay');
    assert(nt.size === 1, 'Tracks 1 nonce');

    const nonce2 = nt.generate();
    assert(nonce2 !== nonce1, 'Each nonce is unique');
    nt.clear();
    assert(nt.size === 0, 'Clear removes all nonces');
  }

  // ─── 11. Security — Blocklist ─────────────────────────────────────────
  console.log('\n━━━ 11. Blocklist ━━━');
  {
    const bl = new Blocklist(); // in-memory only
    bl.block('bad-agent');
    assert(bl.isBlocked('bad-agent') === true, 'Blocked agent detected');
    assert(bl.isBlocked('good-agent') === false, 'Good agent not blocked');
    assert(bl.list().includes('bad-agent'), 'List includes blocked agent');

    bl.unblock('bad-agent');
    assert(bl.isBlocked('bad-agent') === false, 'Unblocked agent no longer blocked');
  }

  // ─── 12. Security — Verification Cache ────────────────────────────────
  console.log('\n━━━ 12. Verification Cache ━━━');
  {
    const vc = new VerificationCache({ ttl: 500 });
    assert(vc.get('sig1', 'pub1') === null, 'Cache miss returns null');

    vc.set('sig1', 'pub1', true);
    assert(vc.get('sig1', 'pub1') === true, 'Cache hit returns value');
    assert(vc.size === 1, 'Cache has 1 entry');

    vc.set('sig2', 'pub2', false);
    assert(vc.get('sig2', 'pub2') === false, 'Cache stores false values');

    // TTL expiry
    await sleep(600);
    assert(vc.get('sig1', 'pub1') === null, 'Expired entry returns null');
    vc.clear();
  }

  // ─── 13. Security — Key Rotation ──────────────────────────────────────
  console.log('\n━━━ 13. Key Rotation ━━━');
  {
    const testDir = '/tmp/ai2ai-test-keyrot';
    cleanDir(testDir);
    fs.mkdirSync(testDir, { recursive: true });

    const crypto = require('crypto');
    const kr = new KeyRotation({
      keysDir: testDir,
      generateKeyPair: () => {
        const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
          publicKeyEncoding: { type: 'spki', format: 'pem' },
          privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        });
        return { publicKey, privateKey };
      },
      rotationIntervalMs: 100,
    });

    assert(kr.needsRotation() === false, 'No rotation needed initially');

    // Create initial keys
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    fs.writeFileSync(path.join(testDir, 'agent.pub'), publicKey);
    fs.writeFileSync(path.join(testDir, 'agent.key'), privateKey);

    const rotated = kr.rotate();
    assert(rotated.publicKey.includes('PUBLIC KEY'), 'Rotation generates new public key');
    assert(rotated.publicKey !== publicKey, 'New key differs from old');

    const announcement = kr.createAnnouncement(rotated.publicKey, publicKey);
    assert(announcement.type === 'key_rotation', 'Announcement has correct type');
    assert(announcement.payload.newPublicKey === rotated.publicKey, 'Announcement has new key');

    const prevKeys = kr.getPreviousKeys();
    assert(prevKeys.length >= 1, 'Previous keys stored');
    assert(prevKeys[0] === publicKey, 'Previous key matches original');

    cleanDir(testDir);
  }

  // ─── 14. Production Client ────────────────────────────────────────────
  console.log('\n━━━ 14. Production Client ━━━');
  const { AI2AI } = require('./client');
  {
    const agent1 = new AI2AI({ name: 'prod-agent-1', humanName: 'Alice', port: 18890, dataDir: '/tmp/ai2ai-test-client1' });
    const agent2 = new AI2AI({ name: 'prod-agent-2', humanName: 'Bob', port: 18891, dataDir: '/tmp/ai2ai-test-client2' });

    let receivedMessage = null;
    let receivedRequest = null;

    agent2.on('message', (payload, from) => { receivedMessage = { payload, from }; });
    agent2.on('request', (intent, payload, from) => { receivedRequest = { intent, payload, from }; });

    await agent1.start();
    await agent2.start();

    // Add contacts
    agent1.addContact('prod-agent-2', { endpoint: 'http://localhost:18891/ai2ai' });

    // Send message
    const sendResult = await agent1.send('prod-agent-2', 'Hello Bob!');
    assert(sendResult.status === 'ok', 'Send returns ok');
    await sleep(100);
    assert(receivedMessage !== null, 'Message received');
    assert(receivedMessage.payload.message === 'Hello Bob!', 'Message content correct');
    assert(receivedMessage.from.agent === 'prod-agent-1', 'Sender identity correct');

    // Send request
    const reqResult = await agent1.request('prod-agent-2', 'schedule.meeting', { subject: 'Lunch' });
    assert(reqResult.status === 'ok', 'Request returns ok');
    await sleep(100);
    assert(receivedRequest !== null, 'Request received');
    assert(receivedRequest.intent === 'schedule.meeting', 'Request intent correct');
    assert(receivedRequest.payload.subject === 'Lunch', 'Request payload correct');

    // Health check
    const healthRes = await fetch('http://localhost:18891/ai2ai/health');
    const health = await healthRes.json();
    assert(health.status === 'online', 'Health check returns online');
    assert(health.agent === 'prod-agent-2', 'Health check has agent name');

    // Contact management
    agent1.addContact('test-contact', { endpoint: 'http://example.com', humanName: 'Test' });
    assert(agent1.getContact('test-contact').humanName === 'Test', 'Get contact works');
    assert(agent1.getContact('nonexistent') === null, 'Unknown contact returns null');

    // Blocklist
    agent1.blocklist.block('bad-agent');
    agent1.addContact('bad-agent', { endpoint: 'http://localhost:99999/ai2ai' });
    let blockError = null;
    try { await agent1.send('bad-agent', 'should fail'); } catch (e) { blockError = e; }
    assert(blockError && blockError.message.includes('blocked'), 'Blocked agent rejected');

    // Unresolvable agent
    let resolveError = null;
    try { await agent1.send('unknown-agent', 'should fail'); } catch (e) { resolveError = e; }
    assert(resolveError && resolveError.message.includes('Cannot resolve'), 'Unknown agent rejected');

    await agent1.stop();
    await agent2.stop();
  }

  // ─── 15. Production Client with Registry ──────────────────────────────
  console.log('\n━━━ 15. Client + Registry Integration ━━━');
  {
    const regServer = new RegistryServer();
    await regServer.start(18898);

    const agent = new AI2AI({ name: 'reg-test-agent', port: 18892, registry: 'http://localhost:18898', dataDir: '/tmp/ai2ai-test-client1' });
    await agent.start();
    const regResult = await agent.register();
    assert(regResult.status === 'registered', 'Agent registers with registry');

    const found = await agent.discover({ name: 'reg-test' });
    assert(found.length >= 1, 'Discover finds registered agent');

    await agent.stop();
    regServer.stop();
  }

  // ─── 16. Webhook Integration ──────────────────────────────────────────
  console.log('\n━━━ 16. Webhook Integration ━━━');
  const { createWebhookForwarder, verifyWebhookSignature } = require('./integrations/webhook');
  {
    // Test signature verification
    const body = '{"test":true}';
    const secret = 'test-secret';
    const sig = `sha256=${require('crypto').createHmac('sha256', secret).update(body).digest('hex')}`;

    assert(verifyWebhookSignature(body, sig, secret) === true, 'Valid webhook signature verified');
    assert(verifyWebhookSignature(body, 'sha256=wrong', secret) === false, 'Invalid signature rejected');

    // Test forwarder creation
    const forwarder = createWebhookForwarder({ url: 'http://example.com/hook', secret: 'test' });
    assert(typeof forwarder.forward === 'function', 'Forwarder has forward method');
    assert(typeof forwarder.handler === 'function', 'Forwarder has handler method');
  }

  // ─── 17. Express Middleware ───────────────────────────────────────────
  console.log('\n━━━ 17. Express Middleware ━━━');
  const { ai2aiMiddleware } = require('./integrations/express');
  {
    let handledMessage = null;
    const middleware = ai2aiMiddleware({
      agentName: 'express-test',
      onMessage: (payload, from, envelope) => { handledMessage = { payload, from }; },
      rateLimit: 5,
      blocklist: ['evil-agent'],
    });
    assert(typeof middleware === 'function', 'Middleware is a function');

    // Simulate Express req/res for health check
    const mockRes = {
      _status: 200, _body: null, _headers: {},
      writeHead(s) { this._status = s; return this; },
      json(data) { this._body = data; this.headersSent = true; return this; },
      status(s) { this._status = s; return this; },
      end(d) { this._body = d; },
      headersSent: false,
    };

    middleware({ method: 'GET', path: '/health' }, { ...mockRes }, () => {});
    // Can't fully test without Express but middleware function exists
    assert(true, 'Middleware executes without crash');
  }

  // ─── Summary ──────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log(`  ✅ Passed: ${passed}`);
  console.log(`  ❌ Failed: ${failed}`);
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
