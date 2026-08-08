// Minimal 5-field cron matcher for routine scheduling: minute hour dom month dow.
// Uses LOCAL server time (Date getters), not UTC.

type FieldSpec = { kind: "any" } | { kind: "list"; values: number[] } | { kind: "step"; n: number };

function parseField(token: string, expr: string): FieldSpec {
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
    return Number(p);
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

  const [minute, hour, dom, month, dow] = fields as [string, string, string, string, string];
  const specs = [minute, hour, dom, month, dow].map((f) => parseField(f, expr));

  const values = [at.getMinutes(), at.getHours(), at.getDate(), at.getMonth() + 1, at.getDay()];

  // ponytail: AND across dom & dow; standard cron ORs those two — fine for our routines
  return specs.every((spec, i) => fieldMatches(spec, values[i]!));
}
