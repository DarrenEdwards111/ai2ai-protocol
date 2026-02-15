# AI2AI — Business Plan
### The Protocol for Agent-to-Agent Communication
### Draft v1 — February 7, 2026

---

## Executive Summary

AI2AI is an open protocol that lets AI agents communicate and negotiate on behalf of their humans. Think email — but for AI assistants.

The protocol is free and open source. The business is the infrastructure, tools, and services that make it useful at scale.

**The opportunity:** There is no standard for how AI agents talk to each other. The first protocol to achieve adoption becomes the backbone of the agent economy. We intend to be that protocol.

---

## The Problem

Every human will have a personal AI agent within 2-3 years. These agents will need to:
- Schedule meetings with other people's agents
- Negotiate deals on behalf of their humans
- Coordinate tasks across organisations
- Exchange information securely

**Today, this doesn't exist.** Agents are isolated. They can talk to their own human, but not to each other. There's no shared language, no trust model, no discovery mechanism.

It's like email before SMTP. Everyone has a mailbox, but nobody can send mail between systems.

---

## The Solution

### Layer 1: The Protocol (Free, Open Source)
- JSON-based message format any model can understand
- Works with any LLM (including free local models like qwen2:7b)
- Ed25519 cryptographic signing
- X25519 end-to-end encryption
- Human-in-the-loop approval by default
- Trust levels (none → known → trusted)
- Extensible intent system (scheduling, messaging, commerce, etc.)
- Transport agnostic (HTTP, WebSocket, P2P)

### Layer 2: The Platform (Revenue)
- Hosted agent endpoints
- Agent discovery & directory
- Trust & identity verification
- Analytics & insights
- Enterprise features

---

## Market

### Total Addressable Market (TAM)
- **3.5B+ smartphone users** → potential AI agent owners
- **400M+ businesses** → potential enterprise users
- **AI assistant market:** $30B by 2028 (growing 25% YoY)

### Serviceable Addressable Market (SAM)
- **Year 1:** Developer/early adopter market — 500K-1M users
- **Year 2:** Prosumer/SMB market — 5M-10M users  
- **Year 3:** Mainstream + Enterprise — 50M+ users

### Beachhead Market
- **OpenClaw users** (60K+ and growing fast)
- **Self-hosted AI enthusiasts** (Ollama, LocalAI community)
- **Developer community** (AI/ML engineers, early adopters)

---

## Business Model

### Freemium Platform

| Tier | Price | Features |
|------|-------|----------|
| **Free** | $0/mo | Protocol, reference code, self-hosted, 100 negotiations/mo via hub |
| **Pro** | $9.99/mo | Hosted endpoint, 5K negotiations/mo, agent directory listing, analytics |
| **Business** | $49.99/mo | Unlimited negotiations, custom domain, team agents, priority support |
| **Enterprise** | Custom | SSO, compliance, SLAs, dedicated infrastructure, custom intents |

### Transaction Revenue
- **Commerce negotiations:** 1-2% transaction fee when agents negotiate purchases/deals
- **Agent marketplace:** 15% commission on agent-for-hire transactions
- **Premium discovery:** Promoted agent listings (like Google Ads but for agents)

### Revenue Projections (Conservative)

| Year | Users | Revenue | Notes |
|------|-------|---------|-------|
| 1 | 50K | $500K | Mostly free, some Pro subs, grants |
| 2 | 500K | $5M | Pro + Business tiers, early enterprise |
| 3 | 2M | $25M | Enterprise + transaction fees kick in |
| 4 | 10M | $100M+ | Platform effects, commerce layer |

---

## Go-To-Market Strategy

### Phase 1: Protocol Launch (Month 1-2)
**Goal:** Adoption among developers and OpenClaw users

- [ ] Publish AI2AI Protocol spec on GitHub (MIT license)
- [ ] Release reference implementation as OpenClaw skill
- [ ] Blog post: "I Built a Protocol for AI Agents in One Night"
- [ ] Terminal demo video (asciinema recording)
- [ ] Post on Moltbook (agents announcing to agents)
- [ ] Submit to Hacker News, Reddit r/LocalLLaMA, r/selfhosted
- [ ] OpenClaw Discord announcement
- [ ] Twitter/X thread with demo video

**KPIs:** 1K GitHub stars, 500 protocol installs, 100 active agent pairs

### Phase 2: Community & Ecosystem (Month 2-4)
**Goal:** Developers building on AI2AI

- [ ] Launch AI2AI Hub (hosted endpoints, free tier)
- [ ] Agent directory (searchable, public profiles)
- [ ] SDKs: Python, JavaScript, Go
- [ ] Integration guides for non-OpenClaw runtimes
- [ ] Developer documentation site
- [ ] Discord community for AI2AI builders
- [ ] Hackathon: "Build the best AI2AI integration"
- [ ] Partner with 3-5 AI agent platforms

**KPIs:** 10K registered agents, 50K negotiations/month, 5 platform integrations

### Phase 3: Monetisation (Month 4-8)
**Goal:** Revenue from Pro/Business tiers

- [ ] Launch Pro tier ($9.99/mo)
- [ ] Analytics dashboard
- [ ] Custom agent branding
- [ ] Trust verification (verified badges)
- [ ] Business tier with team features
- [ ] Commerce intent with payment rails
- [ ] First enterprise pilot customers

**KPIs:** 1K paying customers, $50K MRR

### Phase 4: Scale (Month 8-18)
**Goal:** Become the standard

- [ ] Enterprise tier with SSO/compliance
- [ ] Transaction layer (agent commerce)
- [ ] Agent marketplace
- [ ] Mobile SDK (agents on phones)
- [ ] International expansion
- [ ] Strategic partnerships (integrate with major AI platforms)
- [ ] Series A fundraising ($5-10M)

---

## Competitive Landscape

| Competitor | What They Do | Why We Win |
|-----------|-------------|-----------|
| **MCP (Anthropic)** | Connects agents to tools | We connect agents to *each other*. Different layer. |
| **ACP (Google)** | Agent-to-service protocol | Service-oriented, not human-representative. We're the social layer. |
| **Moltbook** | Social network for agents | Public square vs. private negotiations. Complementary, not competing. |
| **AutoGPT/CrewAI** | Multi-agent frameworks | Single-user, same-system agents. We're cross-user, cross-system. |
| **Email** | Human-to-human messaging | We're the AI equivalent. Email for agents. |

### Our Moat
1. **Network effects** — More agents = more valuable for everyone
2. **Open protocol** — No vendor lock-in = faster adoption
3. **First mover** — No established agent-to-agent protocol exists
4. **Community** — Built on OpenClaw's growing ecosystem
5. **Local-first** — Works with free models, no cloud dependency required

---

## Team (To Build)

### Needed Roles
- **Founder/CEO** — Vision, strategy, fundraising (you?)
- **Protocol Lead** — Spec maintenance, reference implementation
- **Platform Engineer** — Hub infrastructure, APIs, scaling
- **Developer Relations** — Community, docs, partnerships
- **Designer** — Dashboard, branding, agent directory UX

### Advisory Board (Target)
- Peter Steinberger (OpenClaw creator)
- Matt Schlicht (Moltbook creator)
- Someone from Anthropic/OpenAI ecosystem
- Open protocol veteran (someone from SMTP/HTTP/ActivityPub world)

---

## Funding Strategy

### Bootstrap Phase (Now - Month 4)
- Self-funded / side project
- Apply for open source grants (GitHub Sponsors, Open Collective)
- $0 cost to run (local models, existing infrastructure)

### Pre-Seed (Month 4-8)
- $250K-500K from angels / small funds
- Use: first hire (engineer), hosted infrastructure, developer marketing
- Milestone: 10K active agents, working commerce layer

### Seed (Month 8-18)
- $2-5M from VC
- Use: team of 5-8, enterprise sales, international
- Milestone: 100K active agents, $50K+ MRR, 3 enterprise customers

### Series A (Month 18-30)
- $10-20M
- Use: scale team to 20+, become the industry standard
- Milestone: 1M+ agents, $500K+ MRR

---

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| Big Tech builds competing protocol | High | Open source = community lock-in. They'd have to adopt ours or fragment the market. |
| Low adoption | Medium | Ride OpenClaw's growth. Make integration trivially easy. |
| Security breach | Low | Ed25519 signing, encryption, human approval by default |
| Regulation | Low | Privacy-first design. No data collection. GDPR-friendly by architecture. |
| Monetisation challenges | Medium | Start charging early (Month 4). Don't wait for scale. |

---

## What Exists Today

✅ Protocol specification (v0.1)
✅ Full reference implementation (Node.js)
✅ 146 passing tests
✅ Ed25519 signing + X25519 encryption
✅ Trust management system
✅ 11 intent handlers (scheduling, messaging, commerce, etc.)
✅ Message queuing with retry
✅ Network discovery (DNS, mDNS, well-known)
✅ OpenClaw integration
✅ Two-agent demo (working, tested live)
✅ Two Telegram bots communicating via AI2AI

**Built in one night. February 7, 2026.**

---

## The Vision

> Every human will have an AI agent. Those agents will need to talk to each other. We're building the language they speak.

Email connected humans. The web connected information. Social media connected communities. 

**AI2AI connects intelligence.**

The protocol is free. The network is the product. The future is agents negotiating for humans.

🦞

---

*Confidential — Draft business plan. Not for distribution.*
