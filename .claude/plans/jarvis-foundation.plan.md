# Plan: Jarvis — Foundation (Phase 1)

**Source PRD**: `prd.md`
**Selected Milestone**: Build Order · Phase 1 — Foundation
**Complexity**: Medium

## Summary
Stand up the thinnest end-to-end walking skeleton: a user message reaches an
always-on orchestrator, which calls a **read-only Google Calendar MCP tool**,
returns a response, and logs the whole exchange to Supabase for the dashboard to
show. Everything else in the PRD (Gmail/Notion/GitHub, memory/pgvector, routines,
dreaming, skill-learning, messaging, swarm) is deferred to later phases. Goal is
proving the loop, not building the product.

## Scope (ponytail — what Foundation is NOT)
- No pgvector / memory / Obsidian yet (Phase 2).
- No routines, cron, or messaging gateway (Phase 3).
- No dreaming / skill-learning (Phase 4) — and per PRD §8 the hard USD cap only
  has to exist *before* those autonomous loops, so it's not a Phase 1 blocker.
- No agent swarm (Phase 5).
- Calendar is **read-only** (`list_events` / `get_event` only). No event writes.
- Dashboard is a single page: an audit-log feed + a text box to send a message.
  Not the full §6 feature set.

## Patterns to Mirror
| Category | Source | Pattern |
|---|---|---|
| Naming | — | **Greenfield repo — no existing code.** Establish conventions here; mirror them in Phase 2. |
| Errors | — | None exist yet. Proposal: throw typed errors at tool boundary, catch at orchestrator, log failure to audit table, return a plain-text apology. |
| Tests | — | None exist yet. Proposal: `vitest` for the orchestrator loop + tool-call parsing. One test that the loop logs an audit row. |

## Open Decisions (need answers before/while building)
| # | Question | Recommendation |
|---|---|---|
| 1 | Always-on worker host (PRD §10, TBD) | **Railway** — simplest always-on Node worker + cron. Develop locally first; deploy at end of phase. |
| 2 | Route Phase-1 model calls through OmniRoute now, or call the model directly? | **Defer OmniRoute** to Phase 2 when there's >1 route to manage. Foundation makes one model call; a direct SDK call is fewer moving parts. `// ponytail: direct call, swap in OmniRoute gateway when routing/fallback/budget actually needed` |
| 3 | Repo shape — Next.js app + worker in one repo? | **Monorepo, two apps** (`apps/web` Vercel, `apps/worker` Railway) sharing `packages/db` (Supabase client + types). Keeps the audit schema in one place. |

## Files to Change
| File | Action | Why |
|---|---|---|
| `package.json`, `pnpm-workspace.yaml` | CREATE | Monorepo root, two apps + shared db package |
| `packages/db/schema.sql` | CREATE | `audit_log` table (id, ts, direction, channel, user_msg, tool_calls jsonb, response, status, error) |
| `packages/db/client.ts` | CREATE | Supabase client + typed `logAudit()` helper |
| `apps/worker/orchestrator.ts` | CREATE | Receive message → model call → optional calendar tool call → response → `logAudit()` |
| `apps/worker/mcp/calendar.ts` | CREATE | Read-only Google Calendar MCP client wrapper (`list_events`, `get_event`) |
| `apps/worker/server.ts` | CREATE | Minimal HTTP endpoint (`POST /message`) the dashboard calls; keeps process always-on |
| `apps/web/app/page.tsx` | CREATE | One page: message box (POSTs to worker) + audit-log feed (reads Supabase) |
| `apps/web/app/api/audit/route.ts` | CREATE | Reads recent `audit_log` rows for the feed |
| `.env.example` | CREATE | Supabase URL/key, Google OAuth creds, model API key |
| `apps/worker/orchestrator.test.ts` | CREATE | Loop logs an audit row; tool-call is parsed and dispatched |

## Tasks
### Task 1: Monorepo + Supabase audit schema
- **Action**: pnpm workspace with `apps/web`, `apps/worker`, `packages/db`. Create `audit_log` table in Supabase and a typed `logAudit()`/`getRecentAudit()` in `packages/db`.
- **Mirror**: n/a (greenfield) — set the convention.
- **Validate**: Supabase shows `audit_log`; `logAudit()` inserts a row from a script.

### Task 2: Read-only Calendar MCP wrapper
- **Action**: Wire Google Calendar via MCP, expose only `list_events`/`get_event`. OAuth for the single user.
- **Mirror**: n/a — establishes the "each capability gets only the tools it needs" pattern (PRD §5.2).
- **Validate**: `list_events` returns this week's real events from the command line.

### Task 3: Orchestrator loop
- **Action**: `POST /message` → one model call with the calendar tool exposed → if the model calls a tool, run it and feed result back → final text response → `logAudit()` records message, tool_calls, response, status.
- **Mirror**: Task 1's `logAudit()`; Task 2's calendar client.
- **Validate**: `curl -X POST /message -d '{"text":"whats on my calendar tomorrow?"}'` returns a real answer AND writes one audit row with the tool call captured.

### Task 4: Minimal dashboard
- **Action**: Single Next.js page — send box (POST to worker) + audit feed (reads `audit_log`). No particle animation yet (PRD §5.7 is polish, defer).
- **Mirror**: Task 1's `getRecentAudit()`.
- **Validate**: Type a calendar question in the browser, see the answer and a new audit-feed row appear.

### Task 5: Deploy the split
- **Action**: Web → Vercel, worker → Railway (Decision #1), Supabase already hosted. Wire env vars.
- **Validate**: Send a message from the deployed dashboard with the local machine off; loop still completes (proves "always available", PRD §2).

## Validation
```bash
# from repo root (Windows/PowerShell dev env per PRD §9)
pnpm install
pnpm --filter @jarvis/worker test          # Task 3 loop test
pnpm --filter @jarvis/worker dev            # start worker
curl -X POST http://localhost:8080/message -H "content-type: application/json" -d '{"text":"what is on my calendar tomorrow?"}'
# expect: real calendar answer + one new row in audit_log
pnpm --filter @jarvis/web dev              # dashboard shows the row
```

## Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| Google OAuth setup friction (consent screen, scopes) | High | Use a single test user + `calendar.readonly` scope; do this first, it gates everything |
| Worker host choice churns (§10 TBD) | Medium | Build host-agnostic (plain Node HTTP + env config); Railway is swappable for Fly/Render later |
| Scope creep into Phase 2 (memory, more MCPs) | Medium | Hard stop: Foundation = calendar read-only + audit log + one page. Nothing else. |
| Vercel serverless can't hold the orchestrator | Low (already designed around) | Orchestrator lives on the always-on worker by design (PRD §4); Vercel only serves UI + audit read |

## Acceptance
- [ ] All tasks complete
- [ ] Validation passes — browser message → real calendar answer → audit row visible
- [ ] Deployed loop works with the dev machine off
- [ ] Calendar access is read-only (no write scopes granted)
- [ ] Conventions established here are documented for Phase 2 to mirror
