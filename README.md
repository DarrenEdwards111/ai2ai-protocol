# 🦞 AI2AI — The Open Protocol for Agent-to-Agent Communication

> Your AI talks to my AI. They negotiate. We approve. Done.

AI2AI is a simple, open protocol that lets personal AI assistants communicate and negotiate on behalf of their humans. No central server. No company in the middle. Just your agent talking to mine.

**Built for [OpenClaw](https://github.com/openclaw/openclaw).** Works with any AI agent framework.

---

## 🎬 Demo

[![AI2AI Demo](https://img.youtube.com/vi/aWgKDb742ds/maxresdefault.jpg)](https://www.youtube.com/watch?v=aWgKDb742ds)

▶️ **[Watch the demo](https://www.youtube.com/watch?v=aWgKDb742ds)** — Two AI agents negotiating dinner on Telegram, end to end.

---

## ✨ What It Does

```
Darren: "Schedule dinner with Alex next Thursday"

Darren's Agent ──→ Alex's Agent:  REQUEST schedule.meeting
                                  { subject: "Dinner", times: [Thu 7pm, 7:30, 8pm] }

Alex's Agent ──→ Alex (Telegram): "Darren's AI wants dinner Thursday. Pick a time."
Alex: "1"

Alex's Agent ──→ Darren's Agent:  RESPONSE schedule.meeting  
                                  { accepted_time: "Thu 7pm" }

Darren's Agent ──→ Darren:        "Alex confirmed Thursday at 7. ✅"
```

**Human effort:** Two sentences total.
**AI effort:** Full negotiation, calendar check, confirmation.
**Cost:** $0 with local models (qwen2:7b), or pennies with cloud APIs (Claude, GPT, Gemini).

---

## 🧠 Design Principles

- **Human-in-the-loop** — Agents never commit without human approval
- **Any model** — Works on local 7B models (free, private) or cloud APIs like Claude, GPT, and Gemini. The protocol doesn't care what's behind the agent — just that it speaks JSON.
- **Privacy-first** — No central server. Ed25519 signed. X25519 encrypted.
- **Simple** — JSON envelopes any LLM can handle
- **Decentralised** — Your agent, your server, your rules
- **Transport agnostic** — HTTP, WebSocket, P2P, whatever works

---

## 🚀 Quick Start

### Option 1: CLI (Recommended)

Get up and running in 30 seconds. Zero dependencies — just Node.js 18+.

```bash
# Clone the repo
git clone https://github.com/DarrenEdwards111/ai2ai-protocol.git
cd ai2ai-protocol/cli

# Run the setup wizard
node bin/ai2ai.js init
```

The wizard walks you through everything:

```
🦞 Welcome to AI2AI Setup!

👤 What's your name? Darren
🤖 Agent name? (darren-assistant)
🌐 Port? (18800)
📱 Telegram integration? (y/n) y
🔑 Bot token: ****

🔐 Generating Ed25519 keypair...
💾 Config saved to ~/.ai2ai/config.json
🔑 Keys saved to ~/.ai2ai/keys/

✅ You're ready! Run 'ai2ai start' to go online.
```

Then start your server and connect with other agents:

```bash
# Start your AI2AI server
node bin/ai2ai.js start

# Connect to a friend's agent
node bin/ai2ai.js connect http://friend.example.com:18800/ai2ai

# Send them a dinner request
node bin/ai2ai.js send alex "dinner next Thursday?"

# Check incoming messages
node bin/ai2ai.js pending

# Accept a request
node bin/ai2ai.js approve 1 "Thursday works!"
```

**All CLI commands:**

| Command | What it does |
|---------|-------------|
| `ai2ai init` | Interactive setup wizard — name, keys, Telegram |
| `ai2ai start` | Start your AI2AI server |
| `ai2ai connect <endpoint>` | Connect to another agent & exchange keys |
| `ai2ai send <contact> <msg>` | Send a message or meeting request |
| `ai2ai pending` | View incoming messages awaiting approval |
| `ai2ai approve <id> [reply]` | Approve a pending request |
| `ai2ai reject <id>` | Decline a pending request |
| `ai2ai contacts` | List all known agents |
| `ai2ai status` | Show your server & agent info |

### Option 2: OpenClaw Skill

If you're already running [OpenClaw](https://github.com/openclaw/openclaw):

```bash
# Copy the skill to your workspace
cp -r src/ ~/.openclaw/workspace/skills/ai2ai/

# Start the AI2AI server
node ~/.openclaw/workspace/skills/ai2ai/ai2ai-server.js
```

### Start Talking

```bash
# Ping another agent
node ai2ai-bridge.js --agent darren --action ping --endpoint http://friend:18800/ai2ai

# Send a meeting request
node ai2ai-bridge.js --agent darren --action schedule \
  --to alex-assistant \
  --subject "Dinner" \
  --times "2026-02-12T19:00:00Z,2026-02-13T19:00:00Z"

# Check pending messages
node ai2ai-bridge.js --agent darren --action pending

# Approve a request
node ai2ai-bridge.js --agent darren --action approve --id <message-id> --reply "1"
```

### Run the Demo

Watch two agents negotiate a dinner meeting in real-time:

```bash
node demo-two-agents.js
```

---

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

MIT — Build on it. Fork it. Make it better.

---

## 🌍 The Vision

Email gave humans a decentralised way to communicate.
The web gave humans a decentralised way to publish.
**AI2AI gives AI agents a decentralised way to act on behalf of humans.**

No company should own the protocol by which our digital representatives talk to each other.

The protocol is the product. The simpler it is, the more people build on it.

**Built in one night. Open forever. 🦞**
