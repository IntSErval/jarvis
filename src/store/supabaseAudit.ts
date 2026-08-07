// Hosted AuditStore backed by Supabase (PostgREST). Same port as fileAuditStore,
// so the orchestrator/server don't change — just swap which store is injected.
// Plain fetch against the REST API: no @supabase/supabase-js dependency, no
// native build step. Requires the `audit_log` table (see db/schema.sql).

import type { AuditRow, AuditStore } from "../db/audit.js";

type FetchFn = typeof fetch;

export function supabaseAuditStore(url: string, serviceKey: string, fetchFn: FetchFn = fetch): AuditStore {
  const endpoint = `${url}/rest/v1/audit_log`;
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };

  return {
    insert: async (row: AuditRow) => {
      const res = await fetchFn(endpoint, {
        method: "POST",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify(row),
      });
      if (!res.ok) throw new Error(`supabase insert failed: ${res.status} ${await res.text()}`);
    },
    recent: async (limit: number) => {
      const res = await fetchFn(`${endpoint}?select=*&order=ts.desc&limit=${limit}`, { headers });
      if (!res.ok) throw new Error(`supabase recent failed: ${res.status} ${await res.text()}`);
      return (await res.json()) as AuditRow[];
    },
  };
}
