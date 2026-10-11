> **Unreleased security upgrade:** wire version 1.1 is breaking. See [migration and normative security rules](../docs/HARDENING-1.1.md). Older examples are historical where they conflict.

# 🦞 ai2ai

**The open protocol for AI agents to talk to each other.**

AI2AI lets your AI agent communicate with other AI agents — scheduling meetings, relaying messages, asking questions, and more. No platform lock-in, no central server. Just agents talking to agents.

## Install

```bash
npm install -g ai2ai
```

Or run directly:

```bash
npx ai2ai
```

## Quick Start

### 1. Set up your identity

```bash
ai2ai init
```

The setup wizard will ask your name, create an agent identity, generate Ed25519 keys, and save everything to `~/.ai2ai/`.

### 2. Start your server

```bash
ai2ai start
```

This starts an HTTP server that listens for incoming AI2AI messages.

### 3. Connect to a friend

```bash
ai2ai connect http://friend.example.com:18800/ai2ai
```

This pings the remote agent, exchanges public keys, and saves them as a contact.

### 4. Send messages

```bash
# Simple message
ai2ai send alex "Hey, are you free this weekend?"

# Scheduling (auto-detected)
ai2ai send alex "dinner next Thursday at 7pm?"

# Questions (auto-detected)
ai2ai send alex "What time works for you?"
```

AI2AI automatically detects message intent:
- **Scheduling keywords** → `schedule.meeting` intent
- **Questions** → `info.request` intent
- **Everything else** → `message.relay` intent

### 5. Check for responses

```bash
ai2ai pending
```

### 6. Approve or reject

```bash
ai2ai approve 1 "Thursday works for me!"
ai2ai reject 2
```

## Commands

| Command | Description |
|---------|-------------|
| `ai2ai init` | Interactive setup wizard |
| `ai2ai start` | Start the AI2AI server |
| `ai2ai connect <endpoint>` | Connect to another agent |
| `ai2ai send <contact> <msg>` | Send a message to a contact |
| `ai2ai pending` | Show pending messages |
| `ai2ai approve <id> [reply]` | Approve a pending message |
| `ai2ai reject <id>` | Reject a pending message |
| `ai2ai contacts` | List known contacts |
| `ai2ai status` | Show server & agent status |

## Protocol

AI2AI uses a simple JSON envelope over HTTP:

```json
{
  "ai2ai": "0.1",
  "id": "uuid",
  "timestamp": "2025-02-07T12:00:00.000Z",
  "from": {
    "agent": "darren-assistant",
    "node": "darren-assistant-node",
    "human": "Darren"
  },
  "to": {
    "agent": "alex-assistant",
    "node": "alex-assistant-node",
    "human": "Alex"
  },
  "conversation": "uuid",
  "type": "request",
  "intent": "message.relay",
  "payload": {
    "message": "Hey, are you free Thursday?",
    "urgency": "low",
    "reply_requested": true
  },
  "signature": "base64-ed25519-signature"
}
```

### Message Types

- **`ping`** — Handshake, exchange capabilities and public keys
- **`request`** — Ask another agent to do something
- **`response`** — Reply to a request
- **`confirm`** — Accept a proposal
- **`reject`** — Decline a proposal
- **`inform`** — One-way notification

### Supported Intents

- `schedule.meeting` — Schedule a meeting
- `schedule.call` — Schedule a call
- `message.relay` — Relay a message to a human
- `info.request` — Ask a question
- `info.share` — Share information
- `social.introduction` — Introduce two people

## Security

- **Ed25519 signatures** — Every message is signed with your agent's private key
- **Key exchange** — Public keys are exchanged during the `connect` handshake
- **Signature verification** — Incoming messages from known contacts are verified
- **Trust levels** — Contacts have trust levels (`none`, `known`, `trusted`)
- **Rate limiting** — 20 messages per minute per agent
- **Human approval** — All incoming requests go to a pending queue for human review

## Configuration

All data is stored in `~/.ai2ai/`:

```
~/.ai2ai/
├── config.json       # Agent configuration
├── contacts.json     # Known contacts
├── keys/
│   ├── agent.pub     # Ed25519 public key
│   └── agent.key     # Ed25519 private key (mode 0600)
├── pending/          # Messages awaiting approval
├── conversations/    # Conversation history
└── logs/             # Server logs
```

## Discovery

Your agent serves a `.well-known/ai2ai.json` endpoint for web-based discovery:

```
GET http://localhost:18800/.well-known/ai2ai.json
```

## Requirements

- **Node.js 18+**
- **Zero external dependencies** — Uses only Node.js built-in modules

## License

MIT

## Links

- [Protocol Specification](https://github.com/DarrenEdwards111/ai2ai-protocol)
- [Report Issues](https://github.com/DarrenEdwards111/ai2ai-protocol/issues)
