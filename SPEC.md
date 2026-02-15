# AI2AI Protocol Specification v1.0

## Overview

AI2AI is an open protocol for agent-to-agent communication. It enables AI assistants to communicate, negotiate, and coordinate on behalf of their human operators.

## Message Envelope

Every AI2AI message is a JSON object with this structure:

```json
{
  "ai2ai": "1.0",
  "id": "uuid-v4",
  "nonce": "hex-string-32",
  "timestamp": "2026-02-15T12:00:00.000Z",
  "expiresAt": "2026-02-16T12:00:00.000Z",
  "from": {
    "agent": "sender-agent-id",
    "human": "Sender Name"
  },
  "to": {
    "agent": "recipient-agent-id"
  },
  "conversation": "uuid-v4",
  "type": "message|request|response|confirm|reject|receipt|ping",
  "intent": "schedule.meeting|message.relay|...",
  "payload": { },
  "requires_human_approval": true,
  "signature": "base64-ed25519-signature"
}
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `ai2ai` | string | Protocol version ("1.0") |
| `id` | string | Unique message ID (UUID v4) |
| `timestamp` | string | ISO 8601 timestamp |
| `from` | object | Sender identity |
| `from.agent` | string | Sender's agent ID |
| `to` | object | Recipient identity |
| `to.agent` | string | Recipient's agent ID |
| `type` | string | Message type |
| `payload` | object | Message content |
| `signature` | string | Ed25519 signature (base64) |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `nonce` | string | Unique nonce for replay prevention |
| `expiresAt` | string | Message expiry time (ISO 8601) |
| `conversation` | string | Conversation thread ID |
| `intent` | string | Request intent type |
| `requires_human_approval` | boolean | Whether human must approve |
| `from.human` | string | Human operator name |
| `participants` | array | Group conversation participants |

## Message Types

### `ping`
Handshake / discovery. Returns agent capabilities and public keys.

### `message`
One-way message delivery (like sending a text).

### `request`
Request requiring a response. Must include `intent` field.

### `response`
Reply to a request. Continues the conversation.

### `confirm`
Acceptance of a proposal. Terminal state.

### `reject`
Rejection of a proposal. Terminal state.

### `receipt`
Delivery receipt. Payload contains:
```json
{
  "messageId": "original-message-uuid",
  "status": "sent|delivered|read",
  "timestamp": "2026-02-15T12:00:01.000Z"
}
```

## Intent Types

### Scheduling
- `schedule.meeting` — Request a meeting time
- `schedule.call` — Request a call
- `schedule.group` — Group scheduling (multiple participants)

### Communication
- `message.relay` — Relay a message to the human
- `info.request` — Ask a question
- `info.share` — Share information (no response needed)

### Social
- `social.introduction` — Introduce two people

### Commerce
- `commerce.request` — Request a quote (always requires approval)
- `commerce.offer` — Make an offer (always requires approval)
- `commerce.accept` — Accept an offer
- `commerce.reject` — Reject an offer

### System
- `key_rotation` — Announce new public key

## Security Model

### Signing
All messages are signed with Ed25519. The signature covers:
```json
{
  "id": "...",
  "timestamp": "...",
  "from": { ... },
  "to": { ... },
  "conversation": "...",
  "type": "...",
  "intent": "...",
  "payload": { ... }
}
```

Signature = `Ed25519.sign(JSON.stringify(above), privateKey)` → base64

### Encryption (Optional)
Payload encryption uses X25519 ECDH + AES-256-GCM:

1. Sender generates ephemeral X25519 keypair
2. ECDH: `ephemeralPrivate × recipientPublic → sharedSecret`
3. HKDF-SHA256 derives AES key from shared secret
4. AES-256-GCM encrypts the payload

Encrypted payload:
```json
{
  "_encrypted": true,
  "ephemeralPub": "base64-spki-der",
  "nonce": "base64-12-bytes",
  "ciphertext": "base64",
  "tag": "base64-16-bytes"
}
```

### Replay Prevention
- Each message includes a `nonce` field
- Recipients track seen nonces and reject duplicates
- Messages include `timestamp` and optional `expiresAt`
- Expired messages (default: older than 24h) are rejected

### Trust Levels
- **none** — Unknown agent; human approves everything
- **known** — Previously interacted; human approves actions
- **trusted** — Auto-approve routine tasks

Commerce intents ALWAYS require human approval regardless of trust.

### Rate Limiting
- Default: 20 messages per minute per agent
- Configurable per-agent and per-endpoint

## Discovery Mechanisms

### 1. Registry (Primary)
Central registry server with REST API:

- `POST /agents` — Register agent
- `GET /agents` — Search agents (query params: `capability`, `name`)
- `GET /agents/:id` — Resolve agent by ID
- `DELETE /agents/:id` — Deregister
- `POST /agents/:id/heartbeat` — Keepalive

### 2. DNS TXT Record
Add a TXT record: `_ai2ai.yourdomain.com` with value `endpoint=https://your-endpoint/ai2ai`

### 3. DNS SRV Record
Add SRV record: `_ai2ai._tcp.yourdomain.com`

### 4. Well-Known URL
Serve `/.well-known/ai2ai.json`:
```json
{
  "ai2ai": "1.0",
  "endpoint": "https://example.com/ai2ai",
  "agent": "my-agent",
  "human": "My Name",
  "publicKey": "...",
  "capabilities": ["schedule.meeting", "message.relay"]
}
```

### 5. mDNS/Bonjour (Local Network)
Multicast on `224.0.0.251:5353` with service type `_ai2ai._tcp.local`

## Conversation State Machine

```
proposed → negotiating → confirmed
                       → rejected
                       → expired
```

Valid transitions:
- `proposed` → `negotiating`, `confirmed`, `rejected`, `expired`
- `negotiating` → `confirmed`, `rejected`, `expired`
- `confirmed`, `rejected`, `expired` → (terminal)

## Error Codes

| Status | Reason | Description |
|--------|--------|-------------|
| 200 | `ok` | Message accepted |
| 200 | `pending_approval` | Awaiting human approval |
| 200 | `duplicate` | Message already processed |
| 400 | `invalid_envelope` | Missing required fields |
| 400 | `message_expired` | Message timestamp too old |
| 400 | `replay_detected` | Nonce already used |
| 403 | `blocked` | Agent is blocked |
| 403 | `invalid_signature` | Signature verification failed |
| 429 | `rate_limited` | Too many requests |
| 500 | `internal_error` | Server error |

## Versioning

- Protocol version is in the `ai2ai` field of every envelope
- v1.0 is backwards-compatible with v0.1 message format
- Agents SHOULD accept messages with unknown fields (forward compatibility)
- Agents MUST reject messages with unsupported protocol versions

## Transport

- HTTP/HTTPS POST to the agent's endpoint (default: `/ai2ai`)
- Content-Type: `application/json`
- Max payload size: 100KB
- Timeout: 30 seconds (configurable)
- Header `X-AI2AI-Version` indicates protocol version
