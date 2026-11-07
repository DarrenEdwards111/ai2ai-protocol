'use strict';
// Mock-only tests for 2.0 integration hardening. All servers bind 127.0.0.1 on an ephemeral port.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), http = require('http'), util = require('util');
const { AI2AI } = require('../src/client');
const wire = require('../src/wire');
const { ai2aiMiddleware } = require('../src/integrations/express');
const { createGrokBotWebhookClient } = require('../src/integrations/grokbot-webhook');
const { createWebhookForwarder, verifyWebhookSignature } = require('../src/integrations/webhook');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai2ai-integrations-'));
const sender = new AI2AI({ name: 'sender', dataDir: path.join(tmp, 'sender') });
const stranger = new AI2AI({ name: 'sender', dataDir: path.join(tmp, 'stranger') }); // same name, different key
const FAKE_KEY = 'test-only-key-' + crypto.randomBytes(12).toString('hex');

function receiver(trustLevel = 'trusted') {
  const a = new AI2AI({ name: 'receiver', dataDir: path.join(tmp, crypto.randomUUID()) });
  if (trustLevel) a.addContact('sender', { publicKey: sender._keys.publicKey, trustLevel });
  return a;
}
function envelope(overrides = {}, signer = sender) {
  const e = { ...signer._createEnvelope('receiver', 'request', 'info.request', { q: 1 }, { requiresApproval: false }), ...overrides };
  e.signature = wire.sign(e, signer._keys.privateKey);
  return e;
}
async function viaExpress(agent, body, method = 'POST', p = '/') {
  const mw = ai2aiMiddleware({ agent });
  const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  let nextErr; await mw({ method, path: p, body }, res, (e) => { nextErr = e; });
  if (nextErr) throw nextErr;
  return res;
}
function countEvents(a) { const c = { n: 0 }; a.on('message', () => c.n++); a.on('request', () => c.n++); return c; }

// ---------- Express shares hardened core ----------
test('express: legacy unverified callbacks are refused at construction', () => {
  assert.throws(() => ai2aiMiddleware({ agentName: 'x', onMessage() {} }), /removed/);
  assert.throws(() => ai2aiMiddleware({}), /requires opts.agent/);
});
test('express: forged signature, unknown key and tampered envelope never dispatch', async () => {
  const a = receiver(); const c = countEvents(a);
  assert.equal((await viaExpress(a, { ...envelope(), signature: Buffer.alloc(64).toString('base64') })).code, 403);
  assert.equal((await viaExpress(a, envelope({}, stranger))).code, 403);
  const t = envelope(); t.payload = { q: 2 };
  assert.equal((await viaExpress(a, t)).code, 403);
  assert.equal((await viaExpress(receiver(null), envelope())).code, 403); // no contact configured
  assert.equal((await viaExpress(a, { ...envelope(), signature: undefined })).code, 400);
  assert.equal(c.n, 0);
});
test('express: replay and expiry rejected; valid trusted dispatches once', async () => {
  const a = receiver(); const c = countEvents(a);
  const e = envelope();
  assert.equal((await viaExpress(a, e)).body.status, 'ok');
  assert.equal((await viaExpress(a, e)).body.status, 'ok'); // durable duplicate, no redispatch
  assert.equal(c.n, 2); // one message + one request event, from a single dispatch
  assert.equal((await viaExpress(a, envelope({ nonce: e.nonce }))).code, 409);
  const old = new Date(Date.now() - 2 * 86400000).toISOString();
  assert.equal((await viaExpress(a, envelope({ timestamp: old, expiresAt: new Date(Date.parse(old) + 1000).toISOString() }))).code, 400);
  assert.equal(c.n, 2);
});
test('express: untrusted and commerce wait for explicit local approval', async () => {
  const a = receiver('known'); const c = countEvents(a); let pending = 0; a.on('approval:required', () => pending++);
  const e = envelope();
  assert.equal((await viaExpress(a, e)).body.status, 'pending_approval');
  const b = receiver(); const cb = countEvents(b);
  const com = envelope({ intent: 'commerce.accept' });
  assert.equal((await viaExpress(b, com)).body.status, 'pending_approval');
  assert.equal(c.n + cb.n, 0); assert.equal(pending, 1);
  assert.throws(() => a.resolveApproval(e.id, 'yes'));
  a.resolveApproval(e.id, true); assert.equal(c.n, 2);
});
test('express: health reports the real wire version', async () => {
  const r = await viaExpress(receiver(), undefined, 'GET', '/health');
  assert.deepEqual(r.body, { status: 'online', agent: 'receiver', protocol: 'ai2ai', version: wire.VERSION });
  assert.equal(wire.VERSION, '1.1');
});

// ---------- Loopback binding ----------
test('client binds loopback by default; HTTP path still hardened', async () => {
  const a = receiver(); await a.start(0);
  try {
    assert.equal(a.server.address().address, '127.0.0.1');
    const r = await fetch(`http://127.0.0.1:${a.port}/ai2ai/health`).then((x) => x.json());
    assert.equal(r.version, '1.1');
    const bad = await fetch(`http://127.0.0.1:${a.port}/ai2ai`, { method: 'POST', body: JSON.stringify(envelope({}, stranger)) });
    assert.equal(bad.status, 403);
  } finally { await a.stop(); }
});
test('legacy ai2ai-server binds loopback by default (isolated copy)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai2ai-srv-'));
  for (const f of fs.readdirSync(path.join(__dirname, '../src'))) if (f.endsWith('.js')) fs.copyFileSync(path.join(__dirname, '../src', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'check.cjs'), `delete process.env.AI2AI_HOST;const {startServer}=require('./ai2ai-server');const s=startServer(0);s.on('listening',async()=>{const a=s.address();const h=await fetch('http://127.0.0.1:'+a.port+'/ai2ai/health').then(r=>r.json());process.stdout.write('RESULT '+JSON.stringify({address:a.address,version:h.version}));s.close();process.exit(0)});`);
  const r = require('child_process').spawnSync(process.execPath, ['check.cjs'], { cwd: dir, encoding: 'utf8', timeout: 15000 });
  const m = /RESULT (.*)/.exec(r.stdout); assert.ok(m, r.stderr + r.stdout);
  assert.deepEqual(JSON.parse(m[1]), { address: '127.0.0.1', version: '1.1' });
});

// ---------- Grok Bot webhook adapter ----------
function mockServer(handler) {
  return new Promise((resolve) => {
    const seen = [];
    const s = http.createServer((req, res) => { let b = ''; req.on('data', (c) => b += c); req.on('end', () => { seen.push({ headers: req.headers, body: b, url: req.url }); handler(req, res); }); });
    s.listen(0, '127.0.0.1', () => resolve({ s, seen, url: `http://127.0.0.1:${s.address().port}/hooks/abc?x=1` }));
  });
}
const close = (s) => new Promise((r) => s.close(r));

test('grokbot: sends exact Bearer header and minimal {testid} body; 2xx = run accepted only', async () => {
  const m = await mockServer((req, res) => { res.writeHead(200); res.end('{}'); });
  try {
    process.env.GB_TEST_KEY = FAKE_KEY;
    const c = createGrokBotWebhookClient({ url: m.url, tokenEnv: 'GB_TEST_KEY', allowInsecureLoopback: true });
    const r = await c.sendDeliveryTest('Hermes_test-01');
    assert.equal(m.seen.length, 1);
    assert.equal(m.seen[0].headers.authorization, 'Bearer ' + FAKE_KEY);
    assert.equal(m.seen[0].headers['content-type'], 'application/json');
    assert.equal(m.seen[0].body, '{"testid":"Hermes_test-01"}');
    assert.equal(m.seen[0].url, '/hooks/abc?x=1');
    assert.equal(r.accepted, true); assert.equal(r.status, 200);
    assert.match(r.meaning, /does not confirm/);
    await assert.rejects(c.sendDeliveryTest('Hermes_test-01'), { code: 'duplicate_testid' });
    assert.equal(m.seen.length, 1);
    assert.equal(util.inspect(c, { depth: 5 }).includes(FAKE_KEY), false);
    assert.equal(JSON.stringify(c).includes(FAKE_KEY), false);
  } finally { delete process.env.GB_TEST_KEY; await close(m.s); }
});
test('grokbot: invalid testids rejected before any network call', async () => {
  const m = await mockServer((req, res) => { res.writeHead(200); res.end(); });
  try {
    const c = createGrokBotWebhookClient({ url: m.url, token: FAKE_KEY, allowInsecureLoopback: true });
    for (const bad of ['', 'a'.repeat(101), 'a b', 'é', 'a\nb', 'a.b', 'a/b', '{"x":1}', 42, null, undefined])
      await assert.rejects(c.sendDeliveryTest(bad), { code: 'invalid_testid' });
    assert.equal(m.seen.length, 0);
    assert.equal((await c.sendDeliveryTest('a'.repeat(100))).accepted, true);
  } finally { await close(m.s); }
});
test('grokbot: non-2xx, auth failure and redirects are errors without secrets; redirect not followed', async () => {
  const target = await mockServer((req, res) => { res.writeHead(200); res.end(); });
  let mode = 500;
  const m = await mockServer((req, res) => {
    if (mode === 302) { res.writeHead(302, { Location: target.url }); return res.end(); }
    res.writeHead(mode); res.end('echo ' + req.headers.authorization);
  });
  try {
    const c = createGrokBotWebhookClient({ url: m.url, token: () => FAKE_KEY, allowInsecureLoopback: true });
    for (const [s, code, id] of [[500, 'http_error', 't1'], [401, 'unauthorized', 't2'], [302, 'redirect_refused', 't3']]) {
      mode = s;
      const err = await c.sendDeliveryTest(id).then(() => null, (e) => e);
      assert.ok(err, 'expected rejection'); assert.equal(err.code, code); assert.equal(err.status, s);
      for (const text of [err.message, err.stack, JSON.stringify(err), util.inspect(err)]) assert.equal(text.includes(FAKE_KEY), false);
    }
    assert.equal(target.seen.length, 0);
    await assert.rejects(c.sendDeliveryTest('t1'), { code: 'duplicate_testid' }); // no accidental resend after failure
  } finally { await close(m.s); await close(target.s); }
});
test('grokbot: network error and timeout are reported, not retried', async () => {
  const dead = http.createServer(); await new Promise((r) => dead.listen(0, '127.0.0.1', r)); const port = dead.address().port; await close(dead);
  const c = createGrokBotWebhookClient({ url: `http://127.0.0.1:${port}/h`, token: FAKE_KEY, allowInsecureLoopback: true });
  const err = await c.sendDeliveryTest('net1').then(() => null, (e) => e);
  assert.equal(err.code, 'network_error'); assert.equal(err.message.includes(FAKE_KEY), false);
  const m = await mockServer(() => { /* never answers */ });
  try {
    const c2 = createGrokBotWebhookClient({ url: m.url, token: FAKE_KEY, allowInsecureLoopback: true, timeout: 200 });
    await assert.rejects(c2.sendDeliveryTest('slow1'), { code: 'timeout' });
    assert.equal(m.seen.length, 1);
  } finally { m.s.closeAllConnections(); await close(m.s); }
});
test('grokbot: configuration and header-injection defences', async () => {
  assert.throws(() => createGrokBotWebhookClient({ url: 'http://example.com/h', token: FAKE_KEY }), { code: 'insecure_url' });
  assert.throws(() => createGrokBotWebhookClient({ url: 'http://example.com/h', token: FAKE_KEY, allowInsecureLoopback: true }), { code: 'insecure_url' });
  assert.throws(() => createGrokBotWebhookClient({ url: 'https://u:p@example.com/h', token: FAKE_KEY }), { code: 'invalid_url' });
  assert.throws(() => createGrokBotWebhookClient({ url: 'ftp://example.com/h', token: FAKE_KEY }), { code: 'insecure_url' });
  assert.throws(() => createGrokBotWebhookClient({ url: 'https://example.com/h' }), { code: 'missing_token_config' });
  const m = await mockServer((req, res) => { res.writeHead(200); res.end(); });
  try {
    const inj = createGrokBotWebhookClient({ url: m.url, token: 'abc\r\nX-Evil: 1', allowInsecureLoopback: true });
    await assert.rejects(inj.sendDeliveryTest('h1'), { code: 'invalid_token' });
    const missing = createGrokBotWebhookClient({ url: m.url, tokenEnv: 'GB_TEST_KEY_UNSET', allowInsecureLoopback: true });
    await assert.rejects(missing.sendDeliveryTest('h2'), { code: 'missing_token' });
    assert.equal(m.seen.length, 0);
  } finally { await close(m.s); }
});

// ---------- Generic HMAC webhook (existing use preserved) ----------
test('webhook: HMAC mode preserved; errors surfaced; header values sanitised', async () => {
  let code = 200;
  const m = await mockServer((req, res) => { res.writeHead(code); res.end('ok'); });
  try {
    const errors = [];
    const fwd = createWebhookForwarder({ url: m.url, secret: 's3cret', onError: (e) => errors.push(e) });
    const e = envelope();
    const r = await fwd.forward(e);
    assert.equal(r.status, 200);
    const got = m.seen[0];
    assert.equal(verifyWebhookSignature(got.body, got.headers['x-ai2ai-signature'], 's3cret'), true);
    assert.equal(JSON.parse(got.body).messageId, e.id);
    await fwd.forward({ ...e, from: { agent: 'evil\r\nX-Injected: 1' } });
    assert.equal(m.seen[1].headers['x-ai2ai-agent'], 'invalid'); assert.equal(m.seen[1].headers['x-injected'], undefined);
    code = 500; await assert.rejects(fwd.forward(e), { code: 'http_error', status: 500 });
    await fwd.handler(e.payload, e.from, e); assert.equal(errors.length, 1); assert.equal(errors[0].message.includes('s3cret'), false);
    code = 301; await assert.rejects(fwd.forward(e), { code: 'redirect_refused' });
    assert.throws(() => createWebhookForwarder({ url: 'http://example.com/h' }), { code: 'insecure_url' });
    assert.throws(() => createWebhookForwarder({ url: m.url, mode: 'grokbot' }), /grokbot-webhook/);
  } finally { await close(m.s); }
});
