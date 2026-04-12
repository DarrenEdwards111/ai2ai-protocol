# AI2AI × Paperclip Integration

## Summary

Paperclip and AI2AI solve different layers of the same system.

- **Paperclip** is the internal orchestration and company control plane.
- **AI2AI** is the external communication and trust protocol between agents, machines, and companies.

The best design is to use them together rather than forcing either one to do the other's job.

## Recommended Architecture

### 1. Paperclip = local company brain

Run Paperclip as the control plane on a machine or inside a company environment.

Paperclip manages:
- goals
- task queues
- org charts
- budgets
- recurring jobs
- audit trail
- governance

### 2. Executors = actual working agents

Paperclip should delegate real execution to the agents and runtimes that already do the work well.

Examples:
- OpenClaw
- Claude Code
- Codex
- Bash tools
- desktop runtime bridges

Paperclip should supervise them, not replace them.

### 3. AI2AI = external protocol bus

Use AI2AI for work that crosses boundaries:
- one agent asking another machine for help
- one company contacting another company
- a task crossing trust boundaries
- requests requiring human approval between agents

This gives a clean split:
- **internal orchestration** → Paperclip
- **external/inter-agent communication** → AI2AI

## Integration Patterns

## Option A, best near-term

**Paperclip task -> AI2AI request -> remote desktop/agent -> result -> Paperclip ticket**

Flow:
1. Paperclip creates a task.
2. An AI2AI adapter/plugin sends a request such as `dev.claude_task` with a machine-readable `commandEnvelope`.
3. A remote desktop bridge or remote agent obeys the structured command envelope.
4. The result comes back over AI2AI.
5. Paperclip updates the ticket and task state.

This is the simplest and cleanest first production path.

## Option B, stronger later

**AI2AI request -> local Paperclip task creation -> Paperclip delegates internally -> result -> AI2AI response**

Flow:
1. An incoming AI2AI task arrives.
2. A local bridge converts it into a Paperclip task.
3. Paperclip decides whether Claude, Codex, OpenClaw, bash, or another runtime should handle it.
4. Result flows back out over AI2AI.

This makes Paperclip the local operations kernel for agent work.

## Minimal Components

### Paperclip side
- AI2AI adapter/plugin
- task importer/exporter
- ticket update hook
- optional approval sync

### AI2AI side
- `dev.claude_task`
- `dev.codex_task`
- `dev.openclaw_task`
- machine-readable `commandEnvelope` payload convention for obeyable commands
- result/receipt messages
- trust and approval rules

### Desktop / runtime side
- receiver daemon
- worker runners
- per-runtime adapters
- output/result transport back over AI2AI

## Suggested Build Order

### Phase 1 — Desktop Claude bridge
Build a reliable desktop Claude bridge.

Deliverables:
- approval-gated `dev.claude_task`
- desktop receiver daemon
- desktop Claude worker
- AI2AI result return path

Status: partially implemented in this workspace.

### Phase 2 — Paperclip adapter
Build a Paperclip adapter that can:
- create outbound AI2AI requests from Paperclip tasks
- receive AI2AI responses and update Paperclip tickets
- track remote execution state in Paperclip

### Phase 3 — General executor framework
Generalize the bridge beyond Claude.

Add:
- `dev.codex_task`
- `dev.openclaw_task`
- executor registry / runtime selection
- common result schema

### Phase 4 — Company-to-company automation
Use Paperclip internally and AI2AI externally across multiple companies.

Examples:
- one company outsources coding or design work to another
- inter-company agent procurement
- trusted/approval-gated remote automation

## Why This Split Is Correct

This separation avoids architectural confusion.

- **Paperclip decides and tracks work**
- **AI2AI transports and negotiates work**
- **agents perform work**

That prevents:
- turning AI2AI into a workflow engine
- turning Paperclip into a protocol layer

## Product Positioning

A clean way to describe the stack:

> **Paperclip runs the company. AI2AI connects companies, agents, and remote executors.**

Or more operationally:

> **Paperclip is the operating system for agent companies. AI2AI is the communication protocol between them.**

## Recommended Repo Positioning

Paperclip should be presented in AI2AI as an **integration**, not as core protocol logic.

Recommended structure:
- `PAPERCLIP.md` or `docs/integrations/paperclip.md`
- README section under integrations
- later, an adapter package such as:
  - `ai2ai-paperclip`
  - or `integrations/paperclip/`

## Near-Term Next Steps

1. Stabilize the desktop Claude bridge.
2. Add a Paperclip adapter that emits AI2AI task requests.
3. Add result ingestion from AI2AI back into Paperclip.
4. Generalize runtime adapters.
5. Move to multi-company orchestration.
