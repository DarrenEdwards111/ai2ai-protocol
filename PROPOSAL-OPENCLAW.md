# AI2AI — Proposal for OpenClaw Integration

**To:** Peter Steinberger / OpenClaw team
**From:** Darren
**Date:** February 7, 2026
**Subject:** Agent-to-Agent Communication Protocol for OpenClaw

---

## TL;DR

I've built a working protocol that lets OpenClaw agents talk to each other — negotiating meetings, relaying messages, and transacting on behalf of their humans. Two agents, two Telegram bots, live demo running. 146 tests passing. I'd like to explore making this an official part of OpenClaw.

---

## The Gap

OpenClaw is brilliant at connecting a human to their AI. But right now, every agent is an island. My agent can't talk to your agent. If I want to schedule dinner with you, my AI can't reach out to your AI — I still have to text you manually.

That's the gap AI2AI fills.

---

## What I Built

### The Protocol
A simple JSON-based protocol for agent-to-agent communication:

```json
{
  "ai2ai": "0.1",
  "from": { "agent": "darren-assistant", "human": "Darren" },
  "to": { "agent": "alex-assistant", "human": "Alex" },
  "type": "request",
  "intent": "schedule.meeting",
  "payload": {
    "subject": "Dinner",
    "proposed_times": ["2026-02-12T19:00:00Z"],
    "duration_minutes": 90
  }
}
```

### Design Principles
- **Human-in-the-loop** — Agents never commit without human approval
- **Works with any model** — Tested on qwen2:7b (free, local). No Opus required.
- **Privacy-first** — No central server. Agents talk directly. Ed25519 signed, X25519 encrypted.
- **Simple** — If a 7B model can handle the JSON, it's simple enough.
- **OpenClaw-native** — Built as a skill, uses OpenClaw's messaging, memory, and tool infrastructure.

### What's Working
- ✅ Full protocol spec (v0.1)
- ✅ 11 intent types (scheduling, messaging, commerce, info, introductions, group scheduling)
- ✅ Ed25519 message signing
- ✅ X25519 end-to-end payload encryption
- ✅ Trust levels (none → known → trusted)
- ✅ Message queuing with exponential backoff retry
- ✅ Network discovery (DNS, mDNS, well-known)
- ✅ Conversation state machine
- ✅ Rate limiting, blocking, anti-abuse
- ✅ 146 tests, all passing
- ✅ Live demo: two OpenClaw agents negotiating via two Telegram bots

---

## The Demo

Here's what it looks like in practice:

**Darren (via Telegram):** "Schedule dinner with Alex next Thursday"

**Darren's Agent → Alex's Agent:**
```
REQUEST schedule.meeting
{ subject: "Dinner", proposed_times: [Thu 7pm, Thu 7:30pm, Thu 8pm] }
```

**Alex sees on their Telegram:**
```
📅 Meeting Request from Darren's AI
Subject: Dinner
1. Thu 7pm  2. Thu 7:30pm  3. Thu 8pm
Reply with a number to accept.
```

**Alex:** "1"

**Alex's Agent → Darren's Agent:**
```
RESPONSE schedule.meeting
{ accepted_time: "Thu 7pm" }
```

**Darren sees:** "Alex confirmed Thursday at 7. Added to calendar."

**Total human effort:** Two sentences. The agents handled everything else.

---

## How It Fits Into OpenClaw

### As a Skill (Minimum Viable)
Drop-in skill that any OpenClaw user can install:
```
~/.openclaw/workspace/skills/ai2ai/
```
- Agent reads SKILL.md, learns to use the bridge CLI
- HTTP server runs alongside the gateway
- Pending messages forwarded via existing Telegram/WhatsApp/etc.

### As a Core Feature (The Vision)
Deeper integration into OpenClaw itself:

1. **`openclaw ai2ai` CLI** — manage contacts, send messages, check pending
2. **Gateway-level routing** — incoming AI2AI messages routed like channel messages
3. **Native intent handling** — agent system prompt includes AI2AI awareness
4. **Inline buttons** — Telegram/Discord buttons for quick approval
5. **Heartbeat integration** — check for pending AI2AI messages during heartbeats
6. **Multi-agent aware** — agents in the same gateway can talk to each other directly
7. **Config-driven** — `openclaw.json` includes AI2AI endpoint, port, identity

### Example Config
```json5
{
  ai2ai: {
    enabled: true,
    port: 18800,
    identity: {
      agentName: "darren-assistant",
      humanName: "Darren"
    },
    discovery: {
      mdns: true,
      wellKnown: true
    },
    trust: {
      defaultLevel: "none",
      autoApproveKnown: ["schedule", "message"]
    }
  }
}
```

---

## Why This Matters for OpenClaw

1. **Network effects.** Right now, each OpenClaw install is independent. AI2AI makes them part of a network. More users = more valuable for everyone.

2. **Killer feature.** No other personal AI platform has agent-to-agent communication. This would be an OpenClaw exclusive (at first).

3. **Moltbook synergy.** Moltbook is the public square for agents. AI2AI is the private channel. They complement each other perfectly — discover on Moltbook, negotiate via AI2AI.

4. **Local model friendly.** The entire protocol works on qwen2:7b. Free, private, no API costs. That aligns perfectly with OpenClaw's philosophy.

5. **Community excitement.** "My AI scheduled dinner with your AI" is the demo that goes viral. It's the most tangible proof that personal AI agents are real.

---

## What I'm Proposing

### Option A: Community Skill
I publish AI2AI as an open source OpenClaw skill on ClawhHub. Anyone can install it. OpenClaw team reviews/endorses if they like it. No core changes needed.

### Option B: Collaborative Integration
We work together to integrate AI2AI into OpenClaw core. I contribute the protocol and code, OpenClaw team handles the gateway-level integration. Shared credit.

### Option C: Official Feature
OpenClaw adopts AI2AI as a first-party feature. I join or advise. Protocol becomes part of the standard OpenClaw experience.

I'm open to any of these. The goal is the same: give every OpenClaw agent the ability to talk to every other OpenClaw agent.

---

## About Me

I'm Darren. I built this in one night because I believe AI agents talking to each other is the next logical step — and nobody else was building the protocol. 

The code is MIT licensed. I'm not trying to gatekeep. I want this to exist in the world, and OpenClaw is the best platform to make it happen.

---

## Links

- Protocol spec: [included in repo]
- Reference implementation: [included in repo]
- Test suite: 146 tests, all passing
- Live demo: Two OpenClaw agents on two Telegram bots, negotiating in real-time

---

*Happy to do a live demo, walk through the code, or jump on a call. Whatever works.*

🦞
