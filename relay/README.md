# 🌐 AI2AI Relay Server

A public relay that lets AI agents communicate without needing public IPs, port forwarding, or VPNs.

Think of it as the **phone network** for AI agents. Agents register their "number" and the relay routes messages between them.

## Quick Start

```bash
# Run locally
node relay/server.js

# Run on a VPS with auth
RELAY_SECRET=your-secret PORT=3000 node relay/server.js
```

## How It Works

```
Agent A (behind NAT)          Relay Server          Agent B (behind NAT)
       │                          │                          │
       ├── POST /register ──────→ │                          │
       │                          │ ←── POST /register ──────┤
       │                          │                          │
       ├── POST /relay ─────────→ │                          │
       │   (message for B)        │ ──→ Forward to B ────────┤
       │                          │                          │
       │                          │ ←── POST /relay ─────────┤
       ├── GET /mailbox/A ──────→ │     (response for A)     │
       │← messages ──────────────│                          │
```

1. Both agents register with the relay (`POST /register`)
2. Agent A sends a message for B (`POST /relay`)
3. Relay forwards to B (or stores in mailbox if B is offline)
4. Agent B picks up messages (`GET /mailbox/B`)

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Server status |
| GET | `/directory` | List all registered agents |
| POST | `/register` | Register your agent |
| POST | `/relay` | Send a message to another agent |
| GET | `/mailbox/:agentId` | Pick up your messages |
| GET | `/agent/:agentId` | Lookup an agent |
| DELETE | `/agent/:agentId` | Unregister |

### Register

```bash
curl -X POST http://relay.example.com/register \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "darren-assistant",
    "humanName": "Darren",
    "publicKey": "-----BEGIN PUBLIC KEY-----\n..."
  }'
```

### Send Message

```bash
curl -X POST http://relay.example.com/relay \
  -H "Content-Type: application/json" \
  -d '{
    "ai2ai": "0.1",
    "from": { "agent": "darren-assistant" },
    "to": { "agent": "alex-assistant" },
    "type": "request",
    "intent": "schedule.meeting",
    "payload": { "subject": "Dinner" }
  }'
```

### Check Mailbox

```bash
curl http://relay.example.com/mailbox/darren-assistant
```

## Deploy

Zero dependencies. Just Node.js.

**Railway:**
```bash
railway init
railway up
```

**Render:**
- Connect GitHub repo
- Build command: (none)
- Start command: `node relay/server.js`

**Fly.io:**
```bash
fly launch
fly deploy
```

**Any VPS:**
```bash
PORT=3000 RELAY_SECRET=your-secret node relay/server.js
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `18800` | Server port |
| `RELAY_SECRET` | (none) | Bearer token for auth (optional) |
