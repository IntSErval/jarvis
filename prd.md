# Jarvis — Personal AI Assistant
### Product Requirements Document

**Status:** Planning → Foundation phase
**Repo:** `jarvis-dashboard`

---

## 1. Overview

A personal AI assistant in the spirit of Iron Man's JARVIS: a single orchestrator that can act across the user's calendar, email, notes, and code, holds persistent memory tied to the user's Obsidian vault ("second brain"), runs on its own schedule independent of any one device, and grows its own capabilities over time.

**Persona:** Named Jarvis. Assistant voice is modeled on **Adam Smasher** (Cyberpunk 2077 / Cyberpunk: Edgerunners).

> Note: cloning a specific copyrighted character's voice — especially one tied to a named voice actor's performance — carries IP/licensing exposure if this ever ships beyond personal use. Fine to build and use privately with a soundalike/style-matched TTS voice; worth a licensing check before any public or commercial (Croc Studios) release.

## 2. Goals

- Single point of contact across calendar, email, notes, and code via MCP
- Always available — not dependent on a personal machine being on
- Learns the user's notes and history well enough to act as a real second brain
- Gets smarter over time: surfaces its own ideas (dreaming) and builds its own skills (closed-loop learning) from real usage, not speculative design
- Reachable from wherever the user already is (messaging platforms), not just a dashboard

## 3. Non-Goals (for now)

- A full agent swarm — deferred until a single orchestrator hits a real capability wall
- Full bidirectional Obsidian sync — starts read-only
- Support for every messaging platform at once — one platform first, prove the adapter pattern
- Voice cloning / TTS output — persona is defined now, implementation comes later

## 4. Architecture

**Layer stack, top to bottom:**

1. **Interfaces** — web dashboard, multi-platform messaging gateway, later voice
2. **Orchestrator (Master Agent)** — intent routing, task decomposition, delegates to tools/skills
3. **Agent swarm** *(future)* — specialized agents split off only where the single orchestrator proves insufficient
4. **Memory & knowledge graph** — persistent memory + Obsidian-synced KG, shared substrate all logic reads/writes
5. **LLM gateway** — [OmniRoute](https://github.com/diegosouzapw/OmniRoute); all model calls route through here for cost control, fallback, and usage tracking (not a task orchestrator — it's routing/gateway infrastructure)
6. **Integrations (MCP servers)** — Google Calendar, Gmail, Notion, GitHub
7. **Infra** — hosting, scheduler (cron), job queue

**Hosting split:**

| Component | Host | Why |
|---|---|---|
| Dashboard, auth, API routes | Vercel (Next.js) | User-facing, request/response, fine for serverless |
| Postgres + pgvector | Supabase | Shared backend both sides read/write |
| Orchestrator, agent logic, cron jobs, messaging listeners | Always-on worker (Railway / Fly.io / Render / small VPS — **TBD**) | Long-running/background processes; Vercel serverless functions time out and hold no persistent state |

## 5. Core Features

### 5.1 Automation & Routines / Cowork
- **Routines** — scheduled or event-triggered playbooks (e.g. "every morning: check calendar, summarize new email, surface relevant notes, propose a day plan")
- **Cowork** — ad hoc, user-initiated multi-step tasks handled in one delegated pass
- Declarative config per routine: trigger → steps (tool/agent calls) → output channel

### 5.2 MCP Integrations
- **Calendar** — first integration, proves the full loop end to end
- **Gmail, Notion, GitHub** — added after the loop is validated
- Each capability gets access to only the tools it needs — smaller blast radius, smaller prompts
- Every new integration starts **read-only**; write access added only after explicit approval

### 5.3 Memory & Knowledge Graph (Obsidian "second brain")
- **Live access**: Obsidian Local REST API (+ MCP wrapper) for direct read/write through Obsidian, preserving its native link graph
- **Indexed recall**: periodic job parses vault `.md` files + `[[wikilinks]]` + frontmatter into Supabase (nodes/edges table + pgvector embeddings) for semantic search
- Retrieval is always RAG-style — top 5–10 relevant chunks, never a full-context dump
- Starts read-only; write-back considered later

### 5.4 Dreaming
- Nightly job: orchestrator samples recent memory + vault notes (weighted toward low-connection-density / decaying items) and generates candidate connections, contradictions, or follow-ups
- Output is a structured **dream log**: idea, source notes, confidence, category (idea / reminder / contradiction / question)
- Surfaced on the dashboard as a **Dream Journal** — accept promotes it to a task/note, dismiss lets it decay
- Structurally: fan out to a panel of agents proposing candidates, one judge/synthesis pass picks the best few (maps onto OmniRoute's `fusion` strategy)
- Hard cap on ideas/day and token budget
- **Built last** — needs real memory data to be worth building

### 5.5 Closed-Loop Skill Learning
- Observe: log every task and how it was solved
- Detect: cluster repeated task patterns
- Draft: auto-generate a skill definition (prompt template + tool sequence)
- Approve: human review gate before anything goes live
- Deploy: added to the orchestrator's callable skill set
- Monitor: track success rate, revise or retire underperforming skills
- **Built after real usage data exists**, not speculatively

### 5.6 Multi-Platform Messaging Gateway
- Normalizes messages from multiple platforms (start with one: TBD) into one internal event format, routes to the orchestrator, formats replies back per-platform
- Runs on the always-on worker (needs persistent connections/webhooks)
- Decide early: one consistent Jarvis voice across platforms, or platform-specific personas

### 5.7 Dashboard UI
- Built around a particle animation exported (Three.js format) from the [Casberry AI Particle Simulator](https://particles.casberry.in/), extended with custom behaviors via Casberry's AI Guide prompt + its per-particle control API
- Loaded client-side only (Next.js SSR constraint)

## 6. Dashboard Feature Set

- API usage cost / tokens remaining (via OmniRoute's usage tracking)
- Knowledge graph view
- Agent/swarm live view — what's active right now
- Dream Journal feed
- Skill library — auto-created skills, usage stats, approve/retire controls
- Routine/automation builder + run history (success/fail, logs)
- Messaging inbox — unified view across connected platforms
- Memory explorer — searchable timeline, manual edit/delete
- Budget guardrails — daily/monthly spend caps, pre-limit alerts
- Connector manager — connect/disconnect MCP servers, view granted scopes
- Audit log — every consequential action taken on the user's behalf
- System health — worker uptime, queue depth, error rates

## 7. Build Order

1. **Foundation** — hosting split finalized, Calendar MCP working end to end (message → orchestrator → tool call → response, logged for dashboard)
2. **Core loop** — add Gmail, Notion, GitHub; Postgres+pgvector memory; read-only Obsidian sync
3. **Routines & messaging** — cron-triggered routines; one messaging platform
4. **Intelligence layers** — dreaming, closed-loop skill learning
5. **Swarm** — split into specialized agents only where a real capability wall is hit

## 8. Cost & Safety Guardrails

- RAG-style memory retrieval only, never full-context dumps
- Cheap/fast model for classification-type steps, strong model reserved for real reasoning (OmniRoute routing)
- Hard daily/monthly USD cap set **before** any autonomous loop (dreaming, skill learning) exists
- Strict max-hop count on any agent-to-agent handoff to prevent loops
- Read-only-first on every new integration; write access is opt-in and reviewed
- Human-approval gate in front of any irreversible action (send email, create event, push code)
- Small pinned eval set to catch regressions once skill generation / dreaming run autonomously

## 9. Tech Stack Summary

| Layer | Choice |
|---|---|
| Frontend/dashboard | Next.js on Vercel |
| Database | Supabase (Postgres + pgvector) |
| Background worker | Railway / Fly.io / Render / VPS — **TBD** |
| LLM gateway | OmniRoute |
| Orchestration pattern | Master Agent (extends the existing Agentic Context Hub pattern) |
| Integrations | MCP — Google Calendar, Gmail, Notion, GitHub |
| Knowledge base | Obsidian vault via Local REST API + periodic re-index |
| Dashboard visuals | Casberry AI Particle Simulator (Three.js export) |
| Dev environment | Windows / PowerShell |

## 10. Open Questions

- [ ] Always-on worker host: Railway vs. Fly.io vs. Render vs. VPS
- [ ] First messaging platform to integrate
- [ ] Whether/how to formally fold Agentic Context Hub's existing Master Agent code into this repo, vs. treating it as reference only
- [ ] Voice/TTS implementation approach and licensing check for the Adam Smasher-style persona
