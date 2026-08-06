# TDD Evidence — Local Walking Skeleton (file audit store + HTTP server)

**Branch:** foundation-phase-1
**Source plan:** journeys derived during this TDD run (continuation of `.claude/plans/jarvis-foundation.plan.md` Foundation phase).
**Goal:** make the Phase-1 orchestrator actually run end-to-end for $0 — no Supabase, no Google OAuth, no API key.

## User journeys

1. As the operator, I want every handled message persisted locally so I can see recent activity, with no cloud account.
2. As the operator, I want to POST a message to a running server and get the orchestrator's reply.
3. As the operator, I want malformed requests rejected, not crashed.

## TDD cycle — `fileAuditStore` (the tested logic core)

| Stage | Evidence |
|---|---|
| RED | `pnpm vitest run src/store/fileAudit.test.ts` → `Cannot find module './fileAudit.js'` (compile-time RED: test references missing impl). Commit `f5ca0e1`. |
| GREEN | Same command → 4/4 pass. Commit `9ce0395`. |

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | Missing file → `recent()` returns `[]`, no throw | `src/store/fileAudit.test.ts:returns an empty list when the file does not exist yet` | unit | PASS |
| 2 | Inserted row is persisted and returned | `...:persists an inserted row and returns it` | unit | PASS |
| 3 | `recent(n)` returns newest-first, capped at n | `...:returns rows newest-first and respects the limit` | unit | PASS |
| 4 | Rows survive reload (fresh store, same path) | `...:survives a reload` | unit | PASS |

## Full suite + coverage

`node node_modules/vitest/vitest.mjs run --coverage` → **13/13 pass**. `tsc --noEmit` exit 0.

```
All files         |   96.51 |    87.09 |    90.9 |   96.51
 orchestrator.ts  |      98 |    82.35 |     100 |      98
 db/audit.ts      |     100 |      100 |      75 |     100
 store/fileAudit  |   89.47 |    85.71 |     100 |   89.47  (uncovered 14-15)
```
All thresholds (80%) met. `server.ts` excluded from coverage per `vitest.config.ts` (integration glue, manually validated below).

## Manual validation — the skeleton walks

Server started on `PORT=3717` with `tsx src/server.ts`:

```
POST /message {"text":"what is on my calendar tomorrow?","channel":"web"}
  -> 200 {"reply":"(stub) I received: \"what is on my calendar tomorrow?\""}
POST /message {}                    -> 400 (empty text rejected)
GET  /audit?limit=5
  -> 200 {"rows":[{"ts":"2026-08-06T11:07:21.743Z","channel":"web",
          "user_msg":"what is on my calendar tomorrow?","tool_calls":[],
          "response":"(stub) ...","status":"ok","error":null}]}
audit file written to disk: True
```

Proves: HTTP → orchestrator loop → audit logged → persisted to disk → served back, with correct `AuditRow` shape. Model + calendar are stubs (ports); swap for real Anthropic/Google clients when keys exist — no other change here.

## Known gaps / deferred (intentional)

- `fileAudit.ts:14-15` — non-ENOENT filesystem-error rethrow path untested. Rare; a personal single-user skeleton. Ceiling noted in code.
- `insert` is read-modify-write the whole file (not concurrency-safe). Ceiling + upgrade path (JSONL/SQLite) noted in code comment.
- Real Anthropic `ModelClient` and Google `CalendarClient` adapters, Supabase `AuditStore`, and GateGuard decision — deferred until credentials are provisioned.
