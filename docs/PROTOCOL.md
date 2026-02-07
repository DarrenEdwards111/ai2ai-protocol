# AI2AI — Open Agent Communication Protocol
### Version 0.2 (Draft)
### Author: D & Assistant
### Date: 2026-02-07

---

## Vision

A simple, open protocol that lets personal AI assistants communicate on behalf of their humans. No cloud. No corporation in the middle. Just your AI talking to mine.

**Design principles:**
- Human-in-the-loop by default (agents ask permission before committing)
- Works with any model (designed for local 7B+ models like qwen2)
- Transport-agnostic (HTTP, WebSocket, P2P, carrier pigeon)
- JSON-based (LLMs already speak JSON fluently)
- Privacy-first (no data leaves your machine without consent)
- Decentralised (no central server, registry, or authority)

---

## 1. Core Concepts

### 1.1 Entities

| Entity | Description |
|--------|-------------|
| **Human** | The person who owns and controls an agent |
| **Agent** | An AI assistant acting on behalf of a human |
| **Node** | A running instance of an agent (OpenClaw, or any compatible runtime) |
| **Conversation** | A thread of messages between two or more agents |

### 1.2 Trust Model

Agents don't trust each other by default. Trust is established through:

1. **Introduction** — Agent A's human says "talk to Agent B at this address"
2. **Handshake** — Agents exchange capabilities and verification
3. **Human approval** — Each agent confirms with its human before proceeding
4. **Reputation** — Over time, agents can auto-approve trusted counterparts

Trust levels:
- `none` — Unknown agent, human must approve everything
- `known` — Previously interacted, human approves actions only
- `trusted` — Human has approved auto-negotiation for routine tasks

### 1.3 Conversation States

Conversations follow a state machine:

```
proposed → negotiating → confirmed
                       → rejected
                       → expired
```

| State | Description |
|-------|-------------|
| `proposed` | Initial request sent or received |
| `negotiating` | Back-and-forth in progress |
| `confirmed` | Both parties agreed |
| `rejected` | One party declined |
| `expired` | Timed out without resolution (default: 7 days) |

---

## 2. Message Format

Every AI2AI message is a JSON envelope:

```json
{
  "ai2ai": "0.2",
  "id": "uuid-v4",
  "timestamp": "2026-02-07T03:55:00Z",
  "from": {
    "agent": "darren-assistant",
    "node": "darren-openclaw-01",
    "human": "Darren"
  },
  "to": {
    "agent": "alex-assistant",
    "node": "alex-openclaw-01",
    "human": "Alex"
  },
  "conversation": "conv-uuid-v4",
  "type": "request|response|confirm|reject|inform|ping",
  "intent": "schedule.meeting",
  "payload": {},
  "requires_human_approval": true,
  "participants": [],
  "signature": "ed25519-signature-base64"
}
```

### 2.1 Multi-Recipient Messages

For group conversations, `to` can be an array:

```json
{
  "to": [
    { "agent": "alex-assistant", "human": "Alex" },
    { "agent": "bob-assistant", "human": "Bob" }
  ],
  "participants": [
    { "agent": "darren-assistant", "human": "Darren" },
    { "agent": "alex-assistant", "human": "Alex" },
    { "agent": "bob-assistant", "human": "Bob" }
  ]
}
```

### 2.2 Message Types

| Type | Description |
|------|-------------|
| `ping` | Discovery / liveness check |
| `request` | Agent asks another agent to do something |
| `response` | Agent replies with options or information |
| `confirm` | Human-approved commitment |
| `reject` | Decline a request (with optional reason) |
| `inform` | One-way notification (no response expected) |

### 2.3 Encrypted Payloads

When encryption is enabled, the `payload` field is replaced with:

```json
{
  "payload": {
    "_encrypted": true,
    "ephemeralPub": "base64-x25519-public-key-der",
    "nonce": "base64-12-byte-iv",
    "ciphertext": "base64-aes-256-gcm-encrypted",
    "tag": "base64-gcm-auth-tag"
  }
}
```

The signature covers the encrypted payload (sign-then-encrypt is NOT used; the envelope is signed first, then the payload is encrypted separately).

---

## 3. Intents (Extensible)

Intents describe what the conversation is about. Start simple, extend later.

### 3.1 Core Intents

```
schedule.meeting     — Negotiate a time to meet
schedule.call        — Negotiate a call time
schedule.group       — Group scheduling (find time for everyone)
message.relay        — Pass a message to the other human
info.request         — Ask for specific information
info.share           — Share information proactively
task.delegate        — Ask the other agent to handle something
task.collaborate     — Work on something together
social.introduction  — Introduce two humans via their agents
commerce.request     — Request a quote / initiate a transaction
commerce.offer       — Make an offer / quote
commerce.accept      — Accept an offer
commerce.reject      — Decline an offer
```

### 3.2 Intent Payload Examples

#### schedule.meeting
```json
{
  "intent": "schedule.meeting",
  "payload": {
    "subject": "Dinner to discuss AI2AI protocol",
    "proposed_times": [
      "2026-02-10T19:00:00Z",
      "2026-02-11T19:00:00Z",
      "2026-02-12T19:00:00Z"
    ],
    "duration_minutes": 90,
    "location_preference": "restaurant near central London",
    "flexibility": "high",
    "notes": "Darren is vegetarian"
  }
}
```

#### schedule.group
```json
{
  "intent": "schedule.group",
  "payload": {
    "subject": "Team lunch",
    "proposed_times": ["2026-02-10T12:00:00Z", "2026-02-11T12:00:00Z"],
    "duration_minutes": 60,
    "location_preference": "somewhere central",
    "participants": [
      { "agent": "darren-assistant", "human": "Darren" },
      { "agent": "alex-assistant", "human": "Alex" },
      { "agent": "bob-assistant", "human": "Bob" }
    ]
  }
}
```

#### message.relay
```json
{
  "intent": "message.relay",
  "payload": {
    "message": "Hey Alex, loved your talk at the conference. Let's catch up soon.",
    "urgency": "low",
    "reply_requested": true
  }
}
```

#### commerce.request
```json
{
  "intent": "commerce.request",
  "payload": {
    "item": "Custom AI model training",
    "description": "Fine-tune a 7B model on our dataset",
    "quantity": 1,
    "budget": "5000",
    "currency": "GBP",
    "notes": "Need it by end of month"
  }
}
```

#### commerce.offer
```json
{
  "intent": "commerce.offer",
  "payload": {
    "item": "Custom AI model training",
    "offer": "Can do it for £4,500, delivery in 2 weeks",
    "price": 4500,
    "currency": "GBP",
    "terms": "50% upfront, 50% on delivery",
    "expires": "2026-02-14T23:59:59Z"
  }
}
```

---

## 4. Conversation Flow

### 4.1 The Handshake

Before any conversation, agents perform a handshake:

```
Agent A → Agent B:  PING  (here's who I am, here's what I can do)
Agent B → Agent A:  PING  (here's who I am, here's what I can do)
```

Handshake payload:
```json
{
  "type": "ping",
  "payload": {
    "capabilities": ["schedule.meeting", "message.relay", "commerce.request"],
    "languages": ["en"],
    "timezone": "Europe/London",
    "availability_hours": "09:00-22:00",
    "model_info": "qwen2:7b (local)",
    "protocol_versions": ["0.2"],
    "public_key": "ed25519-public-key-pem",
    "fingerprint": "abcd:1234:...",
    "x25519_public_key": "base64-x25519-public-key-der"
  }
}
```

The `x25519_public_key` field enables end-to-end payload encryption. If omitted, messages are sent signed-only (backward compatible with v0.1).

### 4.2 Example: Scheduling a Dinner

```
1. Darren tells his agent: "Set up dinner with Alex next week"

2. Darren's Agent → Alex's Agent:
   REQUEST schedule.meeting
   { proposed_times: [...], subject: "Dinner" }

3. Alex's Agent checks Alex's calendar, finds conflicts
   Alex's Agent → Alex: "Darren's AI wants to schedule dinner. 
   Tuesday or Thursday work. Want me to confirm?"

4. Alex: "Thursday works"

5. Alex's Agent → Darren's Agent:
   RESPONSE schedule.meeting
   { accepted_time: "2026-02-12T19:00:00Z", 
     counter_proposal: null,
     message: "Thursday at 7 works for Alex" }

6. Darren's Agent → Darren: "Alex confirmed Thursday at 7 for dinner"
   Darren: "Perfect"

7. Darren's Agent → Alex's Agent:
   CONFIRM schedule.meeting
   { confirmed_time: "2026-02-12T19:00:00Z" }

8. Both agents add to their respective calendars.
```

Total human effort: Two sentences each.

### 4.3 Example: Commerce Flow

```
1. Buyer's Agent → Seller's Agent:
   REQUEST commerce.request
   { item: "Widget", quantity: 100, budget: "5000 USD" }

2. Seller's Agent → Seller: "Someone wants 100 widgets. Budget $5000."
   Seller: "$45 per unit, minimum 50"

3. Seller's Agent → Buyer's Agent:
   RESPONSE commerce.offer
   { offer: "$45/unit, min 50", price: 45, currency: "USD" }

4. Buyer's Agent → Buyer: "Seller offers $45/unit. Accept?"
   Buyer: "Accept"

5. Buyer's Agent → Seller's Agent:
   CONFIRM commerce.accept
   { accepted: true }

Note: ALL commerce intents require human approval regardless of trust level.
```

### 4.4 Message Queuing

When the recipient agent is offline, messages are queued locally and retried with exponential backoff:

| Attempt | Delay |
|---------|-------|
| 1 | 1 minute |
| 2 | 5 minutes |
| 3 | 30 minutes |
| 4 | 2 hours |
| 5 | 12 hours |

After all retries are exhausted, the human is notified of delivery failure. Max retries are configurable per message.

---

## 5. Discovery & Transport

### 5.1 How Agents Find Each Other

**Method 1: Manual introduction**
- Human gives their agent an address: `https://alex-ai.local:18800/ai2ai`

**Method 2: DNS-based discovery**
- TXT record: `ai2ai=https://alex.example.com/ai2ai`
- SRV record: `_ai2ai._tcp.alexdomain.com`

**Method 3: .well-known convention**
- `https://example.com/.well-known/ai2ai.json`
```json
{
  "ai2ai": "0.2",
  "endpoint": "https://example.com:18800/ai2ai",
  "agent": "alex-assistant",
  "human": "Alex",
  "publicKey": "...",
  "fingerprint": "abcd:1234:...",
  "capabilities": ["schedule.meeting", "message.relay"],
  "timezone": "Europe/London"
}
```

**Method 4: mDNS/Bonjour (local network)**
- Service type: `_ai2ai._tcp.local`
- TXT records include port, human name, and capabilities
- Agents on the same LAN automatically discover each other

**Method 5: Decentralized registry (future)**
- DHT-based (like BitTorrent)
- ActivityPub-style federation
- Public key in social bios

### 5.2 Transport Options

| Transport | Use Case |
|-----------|----------|
| HTTPS POST | Default. Simple. Works everywhere. |
| WebSocket | Persistent connection for real-time negotiation |
| Local network (mDNS) | Agents on the same LAN discover each other |
| Peer-to-peer (WebRTC) | Direct connection, no server needed |
| Email | Fallback — agents can communicate via email headers |

---

## 6. Security

### 6.1 Authentication
- Ed25519 key pairs per agent
- Messages signed with sender's private key
- Public keys exchanged during handshake
- Key fingerprints for human verification (8 groups of 4 hex chars)
- Optional: human verifies fingerprint out-of-band (like Signal)

### 6.2 Encryption
- TLS for transport (HTTPS)
- **Payload encryption** (optional, end-to-end):
  - X25519 Diffie-Hellman key exchange
  - Ephemeral X25519 keypair per message (forward secrecy)
  - AES-256-GCM for symmetric encryption
  - HKDF-SHA256 for key derivation
  - Nonce: 12 random bytes per message
- X25519 public keys exchanged during handshake
- Falls back to signed-only if recipient's X25519 key is unknown
- **Encryption is optional** for backward compatibility with v0.1

### 6.3 Anti-Abuse
- Rate limiting per conversation partner (default: 20/min)
- Human approval required for:
  - First contact with unknown agent
  - **All commerce intents** (regardless of trust level)
  - Any financial commitment
  - Sharing personal information
  - Actions above a configurable threshold
- Agents can block other agents
- Conversation logs stored locally for audit
- Pending approvals auto-expire after 24 hours (configurable)

### 6.4 Prompt Injection Protection
- Agent messages are treated as **untrusted external content**
- Payloads are structured JSON, not free-text instructions
- Agents never execute raw text from other agents
- Intent handlers are sandboxed

---

## 7. Privacy

- **No central server sees any messages**
- **No metadata collection** — agents talk directly
- **Humans control what's shared** — agent asks before disclosing
- **Right to forget** — either party can request conversation deletion
- **Local-first** — all data stays on the node unless explicitly shared
- **End-to-end encryption** — payloads can be encrypted so only the recipient's agent can read them

---

## 8. Logging

All AI2AI activity is logged locally:

- **Incoming/outgoing messages** with timestamps and intent
- **Trust changes** (level changes, blocks/unblocks)
- **Delivery failures** and retry attempts
- **Errors** and exceptions

Logs are stored as structured JSONL in `logs/ai2ai-YYYY-MM-DD.log` with daily rotation. Old logs are automatically cleaned after 30 days (configurable).

Log entry format:
```json
{"ts":"2026-02-07T03:55:00.000Z","level":"INFO","cat":"OUT","msg":"→ request/schedule.meeting to alex-assistant","data":{...}}
```

---

## 9. Error Handling

### 9.1 Delivery Failures
- Queued to disk (`outbox/` directory) with exponential backoff retry
- Human notified after all retries exhausted
- Queue survives process restarts

### 9.2 Crypto Failures
- Decryption failure returns `{ status: "error", reason: "decryption_failed" }`
- Invalid signatures are rejected with `{ status: "rejected", reason: "invalid_signature" }`
- If encryption is unavailable, messages fall back to signed-only

### 9.3 Approval Timeouts
- Pending approvals expire after 24 hours (configurable)
- Expired approvals are auto-rejected
- Conversations expire after 7 days without activity

---

## 10. Implementation Roadmap

### Phase 1: MVP ✅
- [x] Basic message format (JSON envelope)
- [x] HTTPS POST transport
- [x] Ping/handshake
- [x] schedule.meeting intent
- [x] message.relay intent
- [x] Human approval flow (agent asks human via chat)

### Phase 2: Trust & Security ✅
- [x] Ed25519 signing and verification
- [x] Trust levels (none/known/trusted)
- [x] Conversation persistence
- [x] Rate limiting
- [x] Block list
- [x] X25519 payload encryption (AES-256-GCM)
- [x] Key fingerprints for human verification

### Phase 3: Resilience ✅
- [x] Message queuing with exponential backoff retry
- [x] Conversation state machine (proposed → negotiating → confirmed/rejected/expired)
- [x] Pending approval timeout and auto-cleanup
- [x] Conversation expiry
- [x] Structured logging with daily rotation
- [x] Error recovery and graceful degradation

### Phase 4: Commerce & Groups ✅
- [x] Commerce intents (request, offer, accept, reject)
- [x] Multi-agent group conversations
- [x] Group scheduling
- [x] OpenClaw skill integration with NL parsing

### Phase 5: Discovery ✅
- [x] mDNS/Bonjour for local network
- [x] DNS TXT record lookup
- [x] DNS SRV record lookup
- [x] .well-known/ai2ai.json convention
- [x] Unified discovery (try all methods)

### Phase 6: Ecosystem (Future)
- [ ] More intents (collaboration, social)
- [ ] Agent reputation system
- [ ] Reference implementations for non-OpenClaw runtimes
- [ ] ActivityPub bridge
- [ ] WebSocket transport
- [ ] WebRTC peer-to-peer

---

## 11. Why This Matters

Email gave humans a decentralized way to communicate.
The web gave humans a decentralized way to publish.
AI2AI gives **AI agents** a decentralized way to act on behalf of humans.

No company should own the protocol by which our digital representatives talk to each other. This should be open, simple, and free — like email was, before Big Tech complicated it.

**The protocol is the product.** The simpler it is, the more people build on it. Keep it JSON. Keep it human-readable. Keep it open.

---

## 12. FAQ

**Q: Why not just use existing APIs?**
A: APIs are machine-to-service. This is agent-to-agent. The agents negotiate in natural language within structured envelopes. It's a fundamentally different interaction model.

**Q: Does this need powerful models?**
A: No. A 7B model like qwen2 can handle structured JSON negotiation perfectly. That's the point — it should run on anyone's hardware for free.

**Q: What about bad actors?**
A: Human-in-the-loop by default. Your agent never commits to anything without your approval (until you explicitly trust the other party). Same security model as email — you can receive spam, but you don't have to open it. Commerce always requires approval.

**Q: How is this different from MCP/ACP?**
A: MCP connects agents to tools. ACP connects agents to services. AI2AI connects agents to *each other*, acting as representatives of humans. It's the social layer, not the tool layer.

**Q: Is encryption mandatory?**
A: No. Encryption is opt-in and requires both agents to exchange X25519 keys during handshake. Without it, messages are still signed (integrity/authenticity) but not confidential beyond TLS transport encryption.

---

*This protocol is released under MIT License. Build on it. Fork it. Make it better.*
*The lobster way. 🦞*
