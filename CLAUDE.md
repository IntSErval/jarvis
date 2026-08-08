# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Jarvis — a personal AI orchestrator. **Foundation (Phase 1):** a message loop
that lets a Claude model answer over a **read-only** Google Calendar, with every
exchange written to an audit log surfaced on a single-page dashboard.

TypeScript, ESM (`"type": "module"`), Node built-in `http` — **no web framework
and no runtime dependencies** (only devDeps: vitest, tsx, typescript). Keep it
that way unless a few lines genuinely can't.

## Commands

```bash
npm test                 # vitest run — full suite
npm run test:watch       # vitest watch
npm run test:coverage    # coverage (target 80%+)
npm run typecheck        # tsc --noEmit — strict, must stay clean
npm run dev              # run server.ts with tsx --watch, loads .env if present
npx vitest run src/gate.test.ts          # single test file
npx vitest run -t "denies unlisted tool" # single test by name
```

Type checking is separate from tests (esbuild/tsx don't type-check). Run
`npm run typecheck` before considering a change done — `strict` +
`noUncheckedIndexedAccess` are on.

## Architecture: ports & adapters

The core logic depends only on **injected interfaces (ports)**; concrete
implementations (adapters) are chosen in `src/server.ts` at startup. This is
what makes the orchestrator unit-testable with no live services.

**The loop** (`src/orchestrator.ts`, `runOrchestrator`):
`user message → model.turn() → for each tool call: gate.check() → dispatch to
calendar → feed result back → repeat` up to `maxHops` (default 4), then log the
whole exchange via `logAudit` and return the reply. Errors degrade gracefully
(canned message) but are still audited with `status: "error"`.

**Ports and their adapters:**

| Port (interface) | Real adapter | Free fallback (default when no creds) |
|---|---|---|
| `ModelClient` | `src/model/anthropic.ts` (Anthropic Messages API via `fetch`) | `stubModel` in server.ts (echoes input) |
| `CalendarClient` | `src/calendar/google.ts` (Calendar API v3, read-only, via `fetch`) | `stubCalendar` (returns empty) |
| `AuditStore` | `src/store/supabaseAudit.ts` (PostgREST via `fetch`) | `src/store/fileAudit.ts` (one JSON file) |
| `Gate` | `allowlistGate` in `src/gate.ts` | — (always active, deny-by-default) |

`server.ts` picks real vs. fallback purely from env presence
(`ANTHROPIC_API_KEY`; `SUPABASE_URL`+`SUPABASE_SERVICE_KEY`; the three
`GOOGLE_OAUTH_*` vars). This means the
whole app runs at **$0 with no credentials** — that's intentional; preserve it.
Adapters use plain `fetch`, no vendor SDKs, no native build step.

**GateGuard** (`src/gate.ts`) is the *single* least-privilege enforcement point.
The orchestrator consults it before every tool dispatch, so an un-permitted tool
never reaches the calendar. Default policy = allowlist of the read-only calendar
tools (`CALENDAR_TOOLS`). Calendar access is read-only by design (PRD 5.2) —
never add write methods to `CalendarClient`.

**Audit** (`src/db/audit.ts`): `buildAuditRow` is a pure normalizer (defaults +
timestamp); `makeAuditLogger(store)` binds it to a store and is the dep the
orchestrator receives. `AuditStore` has just `insert` / `recent`.

**HTTP surface** (`src/server.ts`): `GET /` (dashboard HTML from
`src/dashboard.ts`), `POST /message {text, channel}`, `GET /audit?limit=N`.

## Conventions

- **TDD.** Every module has a co-located `*.test.ts`. Write/adjust the test
  first (red), then implement (green). Commits follow that rhythm.
- Adding a new capability = new **adapter behind an existing port**, wired in
  `server.ts` with an env-gated fallback — don't reach into the loop.
- Deliberate simplifications are marked with `// ponytail:` comments naming the
  ceiling and upgrade path (e.g. file store rewrites the whole file per insert).
  Read them as intent before "fixing" them.
- Supabase: the `audit_log` table must exist first — run `src/db/schema.sql` in
  the Supabase SQL editor. Worker uses the `service_role` key (bypasses RLS).

## Security

`.env` is gitignored and holds real secrets; `.env.example` is the committed
template and **must contain only placeholders**. If you see real keys in
`.env.example`, that's a leak — scrub it and the keys need rotating.
