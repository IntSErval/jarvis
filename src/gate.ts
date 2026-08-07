// GateGuard: the single least-privilege enforcement point for tool calls
// (PRD 5.2 / 8). The orchestrator asks the gate before dispatching any tool,
// so an un-permitted call never reaches the calendar. Injectable so a
// deployment can tighten or widen policy without touching the loop.

export interface GateDecision {
  allow: boolean;
  /** Human-readable reason when denied — recorded in the audit log. */
  reason?: string;
}

export interface Gate {
  check(call: { name: string; args: unknown }): GateDecision;
}

/** Deny-by-default gate: only tools in `allowed` may run. */
export function allowlistGate(allowed: readonly string[]): Gate {
  const set = new Set(allowed);
  return {
    check: ({ name }) =>
      set.has(name) ? { allow: true } : { allow: false, reason: `tool not permitted: ${name}` },
  };
}
