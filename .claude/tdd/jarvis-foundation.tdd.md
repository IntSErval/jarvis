# TDD Evidence — Jarvis Foundation (Phase 1)

**Source plan:** [`.claude/plans/jarvis-foundation.plan.md`](../plans/jarvis-foundation.plan.md)
**Branch:** `foundation-phase-1`
**Date:** 2026-08-06
**Scope built this cycle:** the testable logic core only — the orchestrator loop
(`runOrchestrator`) and the audit-row normalizer (`buildAuditRow` / `makeAuditLogger`).
Integration glue (Google OAuth, live Supabase, model API, `server.ts`, dashboard,
deploy) is **not** in this cycle — it needs live credentials and is validated
manually per the plan.

## User Journeys (from plan Task 3)
1. As the user, I ask a plain question, so Jarvis answers and logs the exchange.
2. As the user, I ask about my calendar, so Jarvis calls the **read-only** calendar
   tool, answers from the result, and records the tool call.
3. As the user, when the calendar is unreachable, Jarvis degrades gracefully and
   the failure is logged (not a crash).
4. As the user, I am protected from a hallucinated/unpermitted tool — Jarvis refuses
   it and never touches the calendar (least privilege, PRD §5.2).
5. As the operator, a runaway model↔tool loop is bounded (max-hop guard, PRD §8).

## Task Report
- **buildAuditRow / makeAuditLogger** — pure normalizer + store-bound logger.
  - Validation: `pnpm test` → `src/db/audit.test.ts` (3 tests).
  - RED: `Error: not implemented` at `audit.ts:43` (commit `a1f1817`).
  - GREEN: 3/3 pass (commit `11f27a3`).
  - Guarantees: ISO-8601 timestamp stamped; `tool_calls`/`status`/`error` defaults
    applied; provided error metadata preserved; logger inserts the normalized row.
- **runOrchestrator** — message → model → read-only calendar → response, logged.
  - Validation: `pnpm test` → `src/orchestrator.test.ts` (6 tests).
  - RED: `Error: not implemented` at `orchestrator.ts:62` (commit `a1f1817`).
  - GREEN: 6/6 pass (commit `11f27a3`).
  - Guarantees: see spec table.

## Test Specification
| # | What is guaranteed | Test | Type | Result | Evidence |
|---|--------------------|------|------|--------|----------|
| 1 | Empty-tool turn returns the model's text and logs one `ok` row | `orchestrator.test.ts:returns the model's answer...` | unit | PASS | `pnpm test` |
| 2 | Calendar tool call runs, result feeds back, and is recorded | `orchestrator.test.ts:runs a calendar tool call...` | unit | PASS | `pnpm test` |
| 3 | Tool failure → `status=error`, error captured on row + tool record, graceful reply | `orchestrator.test.ts:catches a tool failure...` | unit | PASS | `pnpm test` |
| 4 | Unknown/unpermitted tool refused; calendar never called | `orchestrator.test.ts:refuses an unknown/unpermitted tool...` | unit | PASS | `pnpm test` |
| 5 | Model failure → graceful reply + `error` logged | `orchestrator.test.ts:catches a model failure...` | unit | PASS | `pnpm test` |
| 6 | Max-hop limit stops the loop (calls tool exactly N times) | `orchestrator.test.ts:stops at the max-hop limit...` | unit | PASS | `pnpm test` |
| 7 | Audit row gets ISO-8601 ts + defaults | `audit.test.ts:stamps an ISO-8601 timestamp...` | unit | PASS | `pnpm test` |
| 8 | Provided tool_calls/error metadata preserved | `audit.test.ts:preserves provided tool_calls...` | unit | PASS | `pnpm test` |
| 9 | Logger inserts a normalized row into the store | `audit.test.ts:makeAuditLogger inserts...` | unit | PASS | `pnpm test` |

## Coverage
`pnpm test:coverage` (v8), thresholds 80% all metrics — **PASS**:

```
File              | % Stmts | % Branch | % Funcs | % Lines
All files         |    98.5 |     87.5 |   85.71 |    98.5
 orchestrator.ts  |      98 |    82.35 |     100 |      98   (uncovered: L66 double-log edge)
 db/audit.ts      |     100 |      100 |      75 |     100
```

## Known Gaps (intentional, next phases)
- **Integration untested here (needs live creds):** Google Calendar OAuth client,
  Supabase adapter, `server.ts` HTTP endpoint, dashboard. Excluded from coverage in
  `vitest.config.ts`; validated manually per plan Tasks 2/4/5.
- `audit.ts` funcs 75% = `makeAuditLogger` is covered, but v8 counts the arrow it
  returns; behavior is asserted by test #9.
- `orchestrator.ts:66` (outer catch re-log when `logAudit` itself throws) is an
  unreached defensive edge — left in deliberately, not worth a test.

## Merge Evidence (for squash)
RED `a1f1817` (9 reproducers, `not implemented`) → GREEN `11f27a3` (9/9 pass, tsc
clean, coverage ≥80%). No refactor commit — implementation was already minimal.
