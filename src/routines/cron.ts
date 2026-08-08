// Minimal 5-field cron matcher for routine scheduling: minute hour dom month dow.
// Uses LOCAL server time (Date getters), not UTC.

type FieldSpec = { kind: "any" } | { kind: "list"; values: number[] } | { kind: "step"; n: number };

// Valid value ranges per field: minute, hour, day-of-month, month, day-of-week.
const RANGES: ReadonlyArray<readonly [number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 6],
];

function parseField(token: string, expr: string, range: readonly [number, number]): FieldSpec {
  if (token === "*") return { kind: "any" };

  const stepMatch = /^\*\/(\d+)$/.exec(token);
  if (stepMatch) {
    const n = Number(stepMatch[1]);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`cron: invalid expression: ${expr}`);
    return { kind: "step", n };
  }

  const parts = token.split(",");
  const values = parts.map((p) => {
    if (!/^\d+$/.test(p)) throw new Error(`cron: invalid expression: ${expr}`);
    const v = Number(p);
    if (v < range[0] || v > range[1]) throw new Error(`cron: invalid expression: ${expr}`);
    return v;
  });
  return { kind: "list", values };
}

function fieldMatches(spec: FieldSpec, value: number): boolean {
  switch (spec.kind) {
    case "any":
      return true;
    case "step":
      // ponytail: simple modulo step, not range-anchored cron stepping
      return value % spec.n === 0;
    case "list":
      return spec.values.includes(value);
  }
}

export function cronMatches(expr: string, at: Date): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`cron: invalid expression: ${expr}`);

  const specs = fields.map((f, i) => parseField(f, expr, RANGES[i]!));

  const values = [at.getMinutes(), at.getHours(), at.getDate(), at.getMonth() + 1, at.getDay()];

  // ponytail: AND across dom & dow; standard cron ORs those two — fine for our routines
  return specs.every((spec, i) => fieldMatches(spec, values[i]!));
}
