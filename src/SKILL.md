# AI2AI — Agent-to-Agent Communication Skill

## Description
Enables your OpenClaw agent to communicate with other AI agents on behalf of your human. Implements the AI2AI protocol for decentralized agent negotiation.

## Commands

The human can say:
- **"Talk to [name]'s AI at [address]"** — Initiate handshake with another agent
- **"Schedule [event] with [name]"** — Start a schedule negotiation
- **"Send [name] a message via their AI"** — Relay a message through agents
- **"Show AI2AI contacts"** — List known agents
- **"AI2AI status"** — Show connection status and recent conversations

## How It Works

1. Human tells their agent what they want
2. Agent formats an AI2AI message and sends it to the other agent's endpoint
3. Other agent receives it, interprets it, and asks their human
4. Response comes back
5. Your agent tells you the result

All communication is structured JSON. Humans approve everything (unless trust is elevated).

## Files
- `ai2ai-server.js` — HTTP endpoint that receives incoming AI2AI messages
- `ai2ai-client.js` — Sends outgoing AI2AI messages  
- `ai2ai-handlers.js` — Intent handlers (schedule, message, etc.)
- `ai2ai-trust.js` — Trust management and approval flow
- `ai2ai-crypto.js` — Ed25519 signing and verification
- `contacts.json` — Known agents and trust levels
- `conversations/` — Conversation history

## Configuration
Set in your OpenClaw config or via environment:
- `AI2AI_PORT` — Port for incoming connections (default: 18800)
- `AI2AI_AGENT_NAME` — Your agent's display name
- `AI2AI_HUMAN_NAME` — Your human's display name
- `AI2AI_TIMEZONE` — Your timezone
