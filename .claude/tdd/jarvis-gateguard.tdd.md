# TDD Evidence — GateGuard (tool-permission gate)

**Date:** 2026-08-07
**Branch:** foundation-phase-1
**Source plan:** none — journeys derived during this TDD run (Foundation Phase 1, PRD 5.2 least-privilege / PRD 8 tool guards).

## User journeys

1. Tool calls are checked against a permission policy before executing — an un-permitted tool never touches the calendar.
2. The default policy allows only the read-only calendar tools (`list_events`, `get_event`).
3. A denied call is recorded in the audit log with a clear reason and the user gets a graceful reply.
4. A custom gate can be injected so a deployment tightens/widens policy without touching the loop.

## Task report

- **Built:** `src/gate.ts` — `Gate` port + `allowlistGate(allowed)` (deny-by-default). Wired into `src/orchestrator.ts` as an optional `gate` dep (default = allowlist of `CALENDAR_TOOLS`), consulted before every `dispatchTool`. Denials are pushed to `tool_calls` with an `error` and finish the run as `status: "error"` with the graceful message.
- **RED:** `npx vitest run src/gate.test.ts src/orchestrator.test.ts` → `2 failed`, `Cannot find module './gate.js'` — compile-time RED, intended missing implementation. Commit `57c7339`.
- **GREEN:** `npx tsc --noEmit` clean + `npx vitest run` → `17 passed (17)`. Commit `df4e939`.
- **Guaranteed:** an un-permitted tool call is refused before dispatch, audited with a reason, and answered gracefully; default policy is read-only calendar only; policy is injectable.

## Test specification

| # | What is guaranteed | Test | Type | Result | Evidence |
|---|--------------------|------|------|--------|----------|
| 1 | Allowlisted tool is permitted | `src/gate.test.ts:allows a tool on the allowlist` | unit | PASS | `vitest run` |
| 2 | Non-allowlisted tool denied, reason names the tool | `src/gate.test.ts:denies a tool not on the allowlist` | unit | PASS | `vitest run` |
| 3 | Empty allowlist denies everything (deny-by-default) | `src/gate.test.ts:denies every tool when the allowlist is empty` | unit | PASS | `vitest run` |
| 4 | Gate-denied known tool is not dispatched; audited error; graceful reply | `src/orchestrator.test.ts:refuses a known tool denied by an injected gate` | integration | PASS | `vitest run` |
| 5 | Unknown tool still refused under default policy (regression) | `src/orchestrator.test.ts:refuses an unknown/unpermitted tool` | integration | PASS | `vitest run` |

## Coverage and known gaps

`npx vitest run --coverage`: `gate.ts` 100/100/100/100; `orchestrator.ts` 96.49% stmts (uncovered 70,72 — `dispatchTool` default-throw branch, now defense-in-depth behind the gate); all files 96% stmts / 84.21% branch — above the 80% threshold.

**Intentional gap:** `dispatchTool`'s `unknown tool` throw is unreachable under the default gate (the allowlist rejects unknown names first) but retained as a second layer. Not separately unit-tested.

## Merge evidence

RED `57c7339` → GREEN `df4e939`. No refactor commit (implementation was already minimal). Both checkpoints on `foundation-phase-1`, reachable from HEAD.
