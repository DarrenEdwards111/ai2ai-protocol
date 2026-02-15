<p align="center">
  <img src="https://raw.githubusercontent.com/DarrenEdwards111/ai2ai-protocol/main/logo.jpg" alt="AI2AI Protocol" width="200" />
</p>

<h1 align="center">AI2AI Protocol</h1>

<p align="center">
  <strong>Production-ready agent-to-agent communication protocol</strong><br>
  Zero dependencies • Ed25519 signed • Encrypted • Discoverable
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/ai2ai"><img src="https://img.shields.io/npm/v/ai2ai.svg" alt="npm"></a>
  <a href="https://github.com/DarrenEdwards111/ai2ai-protocol/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg" alt="Node">
  <img src="https://img.shields.io/badge/dependencies-0-brightgreen.svg" alt="Zero deps">
</p>

---

## Quick Start

```js
const { AI2AI } = require('ai2ai');

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
npm install ai2ai
```

Or clone directly:
```bash
git clone https://github.com/DarrenEdwards111/ai2ai-protocol.git
```

## Basic Usage

### Create an Agent

```js
const { AI2AI } = require('ai2ai');

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
const { RegistryServer, RegistryClient } = require('ai2ai/src/registry');

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
const { startLocalDiscovery } = require('ai2ai/src/registry');

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
const { createOpenClawAdapter } = require('ai2ai/src/integrations/openclaw');

const adapter = createOpenClawAdapter({
  agentName: 'my-agent',
  onMessage: (payload, from) => console.log(from, payload),
  notify: (text) => console.log(text),
});
await adapter.start();
```

### Webhooks

```js
const { createWebhookForwarder } = require('ai2ai/src/integrations/webhook');

const webhook = createWebhookForwarder({
  url: 'https://your-server.com/webhook',
  secret: 'shared-secret',
});

agent.on('message', webhook.handler);
```

### Express Middleware

```js
const { ai2aiMiddleware } = require('ai2ai/src/integrations/express');

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
## 📋 Supported Intents

| Intent | Description |
|--------|-------------|
| `schedule.meeting` | Propose times, negotiate, confirm |
| `schedule.call` | Schedule a call |
| `schedule.group` | Find time for multiple people |
| `message.relay` | Pass a message to another human |
| `info.request` | Ask for specific information |
| `info.share` | Share information (one-way) |
| `social.introduction` | Introduce two humans via agents |
| `commerce.request` | Request a quote |
| `commerce.offer` | Make an offer |
| `commerce.accept` | Accept a deal |
| `commerce.reject` | Decline a deal |

Intents are extensible. Add your own.

---

## 🔒 Security

- **Ed25519** message signing — every message is cryptographically signed
- **X25519 + AES-256-GCM** end-to-end payload encryption
- **Trust levels** — `none` → `known` → `trusted` (escalate over time)
- **Human approval** — required for all actions by default
- **Rate limiting** — per-agent, prevents spam
- **Prompt injection protection** — structured JSON, not raw text execution

---

## 📨 Message Format

Every AI2AI message is a JSON envelope:

```json
{
  "ai2ai": "0.1",
  "id": "uuid",
  "timestamp": "2026-02-07T19:00:00Z",
  "from": {
    "agent": "darren-assistant",
    "human": "Darren"
  },
  "to": {
    "agent": "alex-assistant",
    "human": "Alex"
  },
  "conversation": "conv-uuid",
  "type": "request",
  "intent": "schedule.meeting",
  "payload": { ... },
  "requires_human_approval": true,
  "signature": "ed25519-signature"
}
```

Message types: `ping` | `request` | `response` | `confirm` | `reject` | `inform`

---

## 🏗️ Architecture

```
┌──────────────────────┐         ┌──────────────────────┐
│   Darren's Setup     │         │    Alex's Setup       │
│                      │         │                       │
│  Human ←→ OpenClaw   │         │  Human ←→ OpenClaw    │
│           ↕          │  HTTP   │           ↕           │
│     AI2AI Server ────┼────────→┤     AI2AI Server      │
│     (port 18810)     │←────────┼     (port 18811)      │
│           ↕          │         │           ↕           │
│  Keys | Trust | Log  │         │  Keys | Trust | Log   │
└──────────────────────┘         └──────────────────────┘
```

- **ai2ai-server.js** — HTTP endpoint, receives incoming messages
- **ai2ai-client.js** — Sends outgoing messages
- **ai2ai-handlers.js** — Intent processing (schedule, message, commerce, etc.)
- **ai2ai-crypto.js** — Ed25519 signing & verification
- **ai2ai-encryption.js** — X25519 + AES-256-GCM payload encryption
- **ai2ai-trust.js** — Contact management & trust levels
- **ai2ai-queue.js** — Disk-backed retry queue with exponential backoff
- **ai2ai-discovery.js** — DNS, mDNS, .well-known agent discovery
- **ai2ai-conversations.js** — Conversation state machine & expiry
- **ai2ai-logger.js** — Structured audit logging
- **ai2ai-bridge.js** — CLI tool for agents to use the protocol
- **openclaw-integration.js** — Natural language command parsing

---

## 🎯 Real-World Scenarios

Six runnable demos that prove AI2AI works for real multi-agent tasks. Each spins up local agents, completes a task end-to-end, and verifies the result.

```bash
# Run all demos
node examples/demo-schedule.js      # Schedule Meeting
node examples/demo-price-quote.js   # Price Comparison
node examples/demo-research.js      # Collaborative Research
node examples/demo-delegation.js    # Delegation Chain
node examples/demo-info-exchange.js # Information Exchange
node examples/demo-approval.js      # Human Approval Flow
```

### 1. 🗓️ Schedule Meeting
Two agents negotiate a meeting time. Agent B checks its calendar and proposes slots, Agent A picks one, both confirm.
```
  [Alice] Requesting meeting with Bob: "Project Sync"
  [Bob] Checking calendar... proposing 3 available slots
  [Alice] Picking: 2026-03-10T14:00
  ✅ Both agents agreed: "Project Sync" at 2026-03-10T14:00
```

### 2. 💰 Price Comparison
A buyer agent sends quote requests to two merchant agents, collects responses, and picks the cheapest.
```
  [Merchant B] responding £28
  [Merchant C] responding £32
  ✅ Buyer selected merchant-b at £28
```

### 3. 🔬 Collaborative Research
A researcher agent asks a specialist for technical analysis. The specialist returns structured data with sources, which gets incorporated into a report.
```
  [Specialist] Responding with structured answer (confidence: 0.95)
  [Researcher] Report compiled: "LoRa Modulation Technical Brief" with 3 sections
  ✅ Report includes specialist contribution
```

### 4. 🔗 Delegation Chain
Manager → Coordinator → Worker. The coordinator can't fully complete the task, so it delegates a subtask to the worker, combines results, and returns to the manager.
```
  [Coordinator] delegating to worker
  [Worker] Subtask complete
  [Coordinator] Combining results and sending to manager
  ✅ Delegation chain complete: manager ← coordinator ← worker
```

### 5. 📊 Information Exchange
An agent requests sensor data twice, 2 seconds apart. Verifies both readings have different timestamps and values.
```
  [Sensor] Reading #1: 21.3°C at 2026-02-15T04:16:48Z
  [Sensor] Reading #2: 21.6°C at 2026-02-15T04:16:50Z
  ✅ Two readings received with different timestamps
```

### 6. 🔐 Human Approval Flow
A purchase request for £500 triggers a human approval requirement (threshold: £100). Simulates the human approving before confirming.
```
  [Approver] ⚠️ Amount £500 exceeds £100 — human approval required
  [Approver] 👤 Human reviewed and APPROVED
  ✅ Human approval flow completed
```

---

## 🧪 Tests

```bash
cd src/
node test.js
```

```
✅ Passed: 146
❌ Failed: 0
⏭️  Skipped: 1 (mDNS requires multicast network)
```

---

## 🗺️ Roadmap

- [x] Protocol spec v0.1
- [x] Core implementation (server, client, handlers)
- [x] Ed25519 signing
- [x] X25519 encryption
- [x] Trust management
- [x] Message queuing with retry
- [x] 11 intent handlers
- [x] Network discovery (DNS, mDNS, well-known)
- [x] Conversation state machine
- [x] OpenClaw skill integration
- [x] Two-agent live demo
- [x] 146 tests passing
- [ ] Agent directory / registry
- [ ] ActivityPub bridge
- [ ] Multi-runtime SDKs (Python, Go)
- [ ] Mobile agent support
- [ ] Payment rails for commerce intent
- [ ] Hosted hub (managed endpoints)

---

## 🤔 FAQ

**Q: Does this need powerful models?**
A: No. qwen2:7b (free, local) handles structured JSON negotiation perfectly. But it works just as well with cloud APIs like Claude, GPT, or Gemini if you prefer. The protocol is model-agnostic — it's just JSON.

**Q: How is this different from MCP or ACP?**
A: MCP connects agents to tools. ACP connects agents to services. AI2AI connects agents to *each other*, acting as human representatives. It's the social layer.

**Q: What about bad actors?**
A: Human-in-the-loop by default. Your agent never commits without your approval. Same model as email — you can receive spam, but you don't have to open it.

**Q: Can non-OpenClaw agents use this?**
A: Yes. The protocol is a JSON HTTP API. Any agent framework can implement it.

---

## 📄 License

Apache 2.0 — Build on it. Fork it. Make it better. Patent protected.

---

## 🌍 The Vision

Email gave humans a decentralised way to communicate.
The web gave humans a decentralised way to publish.
**AI2AI gives AI agents a decentralised way to act on behalf of humans.**

No company should own the protocol by which our digital representatives talk to each other.

The protocol is the product. The simpler it is, the more people build on it.

**Built in one night. Open forever. 🦞**
