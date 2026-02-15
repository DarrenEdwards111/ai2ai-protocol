<p align="center">
  <img src="https://raw.githubusercontent.com/DarrenEdwards111/ai2ai-protocol/main/logo.jpg" alt="AI2AI Protocol" width="200" />
</p>

<h1 align="center">AI2AI Protocol</h1>

<p align="center">
  <strong>Production-ready agent-to-agent communication protocol</strong><br>
  Zero dependencies • Ed25519 signed • Encrypted • Discoverable
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/ai2ai-protocol"><img src="https://img.shields.io/npm/v/ai2ai-protocol.svg" alt="npm"></a>
  <a href="https://github.com/DarrenEdwards111/ai2ai-protocol/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg" alt="Node">
  <img src="https://img.shields.io/badge/dependencies-0-brightgreen.svg" alt="Zero deps">
</p>

---

## Quick Start

```js
const { AI2AI } = require('ai2ai-protocol/src/client');

const agent = new AI2AI({ name: 'my-agent', port: 18800 });
await agent.start();
await agent.send('other-agent', 'Hello from my AI!');
```

## Features

- 🔐 **Ed25519 signatures** — Every message is cryptographically signed
- 🔒 **X25519 encryption** — Optional payload encryption (AES-256-GCM)
- 📡 **Agent discovery** — Registry, DNS TXT, mDNS/Bonjour, .well-known
- 🔄 **Reliability** — Retry with backoff, circuit breaker, persistent queue
- 📨 **Delivery receipts** — sent/delivered/read confirmations
- 🛡️ **Security hardening** — Rate limiting, nonce tracking, message expiry, blocklist
- 🔑 **Key rotation** — Rotate keys with automatic announcement
- 💀 **Dead letter queue** — Failed messages preserved for retry
- 👤 **Human-in-the-loop** — Approval workflow for sensitive actions
- 🧵 **Conversation threading** — State machine: proposed → negotiating → confirmed
- 🛒 **Commerce** — Request quotes, make offers, accept/reject (always requires human approval)
- 📦 **Zero dependencies** — Node.js built-ins only

## Installation

```bash
npm install ai2ai-protocol
```

Or clone directly:
```bash
git clone https://github.com/DarrenEdwards111/ai2ai-protocol.git
```

## Basic Usage

### Create an Agent

```js
const { AI2AI } = require('ai2ai-protocol/src/client');

const agent = new AI2AI({
  name: 'alice-agent',
  humanName: 'Alice',
  port: 18800,
});

// Listen for messages
agent.on('message', (payload, from) => {
  console.log(`Message from ${from.human}: ${payload.message}`);
});

// Listen for requests
agent.on('request', (intent, payload, from) => {
  console.log(`Request: ${intent} from ${from.human}`);
});

await agent.start();
```

### Send Messages

```js
// Add a contact
agent.addContact('bob-agent', { endpoint: 'http://localhost:18801/ai2ai' });

// Send a message
await agent.send('bob-agent', 'Hey Bob, are you free for lunch?');

// Send a structured request
await agent.request('bob-agent', 'schedule.meeting', {
  subject: 'Team Lunch',
  proposed_times: ['2026-02-20T12:00:00Z'],
});
```

## Discovery

### Registry

```js
const { RegistryServer, RegistryClient } = require('ai2ai-protocol/src/registry');

// Start a registry server
const registry = new RegistryServer();
await registry.start(18820);

// Register your agent
const agent = new AI2AI({
  name: 'my-agent',
  port: 18800,
  registry: 'http://localhost:18820',
});
await agent.start();
await agent.register();

// Discover other agents
const agents = await agent.discover({ capability: 'schedule.meeting' });
```

### DNS TXT Record

Add a DNS TXT record:
```
_ai2ai.yourdomain.com  TXT  "endpoint=https://your-server.com/ai2ai"
```

### Local Network (mDNS)

```js
const { startLocalDiscovery } = require('ai2ai-protocol/src/registry');

const discovery = startLocalDiscovery((agent) => {
  console.log(`Found: ${agent.agentId} at ${agent.endpoint}`);
});

discovery.announce('my-agent', 18800, 'Alice');
discovery.query();
```

## Security Model

| Feature | Description |
|---------|-------------|
| **Ed25519 signatures** | Every message signed with sender's private key |
| **X25519 encryption** | Optional ECDH + AES-256-GCM payload encryption |
| **Nonce tracking** | Prevent replay attacks |
| **Message expiry** | Reject messages older than configurable TTL (default 24h) |
| **Rate limiting** | Per-agent request throttling |
| **Agent blocklist** | Block specific agents |
| **Key rotation** | Rotate keys with announcement to contacts |
| **Verification cache** | Cache signature verification results |
| **Trust levels** | none → known → trusted (commerce always requires approval) |

## Integrations

### OpenClaw

```js
const { createOpenClawAdapter } = require('ai2ai-protocol/src/integrations/openclaw');

const adapter = createOpenClawAdapter({
  agentName: 'my-agent',
  onMessage: (payload, from) => console.log(from, payload),
  notify: (text) => console.log(text),
});
await adapter.start();
```

### Webhooks

```js
const { createWebhookForwarder } = require('ai2ai-protocol/src/integrations/webhook');

const webhook = createWebhookForwarder({
  url: 'https://your-server.com/webhook',
  secret: 'shared-secret',
});

agent.on('message', webhook.handler);
```

### Express Middleware

```js
const { ai2aiMiddleware } = require('ai2ai-protocol/src/integrations/express');

app.use('/ai2ai', ai2aiMiddleware({
  agentName: 'my-agent',
  onMessage: (payload, from, envelope) => { ... },
}));
```

## Protocol Specification

See [SPEC.md](SPEC.md) for the full protocol specification including:
- Message envelope format
- All message types and intent types
- Security model
- Discovery mechanisms
- Error codes
- Versioning rules

## API Reference

### `AI2AI` (Production Client)

```js
const agent = new AI2AI({
  name: string,           // Agent ID
  humanName: string,      // Human operator name
  port: number,           // Server port (default: 18800)
  registry: string,       // Registry URL
  timeout: number,        // Request timeout ms (default: 30000)
  messageTTL: number,     // Message TTL ms (default: 86400000)
  dataDir: string,        // Data directory
});

await agent.start(port?)          // Start HTTP server
await agent.stop()                // Stop agent
await agent.register(url?)        // Register with registry
await agent.send(id, msg, opts?)  // Send message
await agent.request(id, intent, payload, opts?)  // Send request
await agent.discover(query?)      // Search registry
agent.addContact(id, info)        // Add/update contact
agent.getContact(id)              // Get contact
agent.on('message', handler)      // Listen for messages
agent.on('request', handler)      // Listen for requests
agent.on('receipt', handler)      // Listen for receipts
```

### `RegistryServer`

```js
const server = new RegistryServer({ staleTimeout: 120000 });
await server.start(port)  // Start registry HTTP server
server.stop()             // Stop server
```

### `RegistryClient`

```js
const client = new RegistryClient({ registryUrl, agentId });
await client.register(agentInfo)  // Register
await client.search(query?)       // Search agents
await client.resolve(agentId)     // Resolve by ID
await client.deregister()         // Remove registration
await client.heartbeat()          // Send keepalive
```

### Reliability

```js
const { retryWithBackoff, CircuitBreaker, Deduplicator, DeliveryTracker, DeadLetterQueue, PersistentQueue } = require('ai2ai-protocol/src/reliability');
```

### Security

```js
const { KeyRotation, RateLimiter, NonceTracker, Blocklist, VerificationCache, isMessageExpired } = require('ai2ai-protocol/src/security');
```

## Examples

See the [`examples/`](examples/) directory:

- [`basic-agent.js`](examples/basic-agent.js) — Minimal working agent
- [`two-agents.js`](examples/two-agents.js) — Two agents chatting
- [`with-registry.js`](examples/with-registry.js) — Agent discovery via registry
- [`webhook-receiver.js`](examples/webhook-receiver.js) — Forward to webhooks
- [`openclaw-skill.js`](examples/openclaw-skill.js) — OpenClaw integration

## Tests

```bash
cd src
node test.js      # Original 146 tests
node test-v1.js   # New v1.0 tests (110 tests)
```

## Contributing

1. Fork the repo
2. Create a feature branch
3. Run tests: `cd src && node test.js && node test-v1.js`
4. Submit a PR

## License

Apache 2.0 — See [LICENSE](LICENSE)

---

<p align="center">
  Built by <a href="https://mikoshi.co.uk">Mikoshi Ltd</a> 🦞
</p>
