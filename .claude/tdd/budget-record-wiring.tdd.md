# TDD Evidence — Wire `budget.record()` so dream caps enforce

**Date:** 2026-08-25
**Branch:** `feat/budget-record-wiring`
**Checkpoints:** `904a231` (RED, reproducer) → `742fdac` (GREEN, fix)

## Source plan

No `*.plan.md` — journeys derived during this run from PRD §8 (Cost & Safety
Guardrails: "Hard daily/monthly USD cap set **before** any autonomous loop
exists") and the stale `// ponytail:` note in `src/server.ts` that flagged
`budget.record()` as unwired.

## Problem (root cause)

The nightly dreamer (`runDreamer`) is the sole holder of a `BudgetGuard` and the
autonomous loop PRD §8 caps. It called `budget.check()` at the start of a run but
**never recorded spend**, because `ModelTurn` carried no token usage. So the
budget store stayed empty, `check()` always allowed, and the daily/monthly caps
never enforced — a live safety hole, not a missing feature.

## User journeys

1. As the operator, I want each nightly dream call's spend metered against my USD
   caps, so that a runaway autonomous loop actually stops at the cap.
2. As the operator running with no API key (the $0 stub path), I want dreaming to
   record no spend, so that the free default stays free.
3. As a maintainer, I want the real Anthropic adapter to report token usage, so
   that cost metering has real numbers to record.

## Task report

| Behavior | Validation command | RED | GREEN | Guaranteed by |
|---|---|---|---|---|
| Dreamer records spend per model call when a budget + usage are present | `npx vitest run src/dream/dreamer.test.ts` | `records` length 0, expected 3 | 3 records, each `usd === costUsd(...)`, `model` tagged | budget caps accumulate across runs → `check()` denies at cap |
| Dreamer records nothing when turns carry no usage ($0 stub path) | same | passed pre-fix (guard test) | still passes | free default stays free |
| Anthropic adapter parses token usage into `ModelTurn.usage` | `npx vitest run src/model/anthropic.test.ts` | `turn.usage` undefined | `{ model, inputTokens, outputTokens }` | real spend numbers exist to record |

### RED excerpt (`904a231`)
```
FAIL src/dream/dreamer.test.ts > records spend ... expected 0 to be 3
FAIL src/model/anthropic.test.ts > parses token usage ... expected undefined to deeply equal {…}
Test Files 2 failed | Tests 2 failed | 12 passed (14)
```

### GREEN excerpt (`742fdac`)
```
✓ src/dream/dreamer.test.ts (9 tests)
✓ src/model/anthropic.test.ts (5 tests)
Full suite: Test Files 28 passed (28) | Tests 197 passed (197)
typecheck: tsc --noEmit — clean
```

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Each dream model call's cost is recorded into the budget | `dreamer.test.ts:records spend (cost of each model call) into the budget when turns carry usage` | unit | PASS |
| 2 | Usage-free turns record nothing (preserves $0 stub path) | `dreamer.test.ts:records nothing when turns carry no usage` | unit | PASS |
| 3 | Anthropic adapter maps API `usage` → `ModelTurn.usage` tagged with the model | `anthropic.test.ts:parses token usage into ModelTurn.usage` | unit | PASS |

## Coverage & known gaps

Touched files (from `vitest --coverage` on the two changed test files):
`dreamer.ts` 98.76% stmts, `anthropic.ts` 95.12% stmts — both >80%. `budget.ts`'s
guard is covered by `budget.test.ts` in the full run (28 files, 197 tests, all
passing).

Intentional ceilings (marked `// ponytail:` in code):
- **Per-run overrun not stopped.** Spend is recorded *after* each call, so a
  single night's run isn't halted mid-flight; the cap bites at the *next* run's
  `check()`. Correct for a daily cap; add a mid-run `check()` between calls only
  if per-run overrun ever matters.
- **Only the autonomous dream loop is metered.** The interactive `/message` loop
  isn't, since caps guard unattended spend (PRD 8), not human-in-the-loop turns.

## Merge evidence

If squashed, preserve: RED `904a231` (reproducer, 2 failing) → GREEN `742fdac`
(fix, full suite 197 passing + typecheck clean).
