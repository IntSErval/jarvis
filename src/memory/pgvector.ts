// Hosted MemoryStore backed by Supabase (PostgREST) + pgvector. Same fetch
// idiom as supabaseAudit.ts: no @supabase/supabase-js dependency, no native
// build step. Requires the `memories` table + match_memories() function (see
// db/memory.sql). Wired into the orchestrator loop (auto-remember + proactive
// recall) when Supabase creds are present; absent creds => memory stays off.

import type { Embedder, MemoryStore } from "./store.js";

type FetchFn = typeof fetch;

interface Config {
  url: string;
  serviceKey: string;
  embed: Embedder;
  fetchFn?: FetchFn;
  defaultK?: number;
}

export function pgvectorMemory(config: Config): MemoryStore {
  const { url, serviceKey, embed, fetchFn = fetch, defaultK = 8 } = config;
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };

  return {
    remember: async ({ content, metadata }) => {
      const embedding = await embed.embed(content);
      const res = await fetchFn(`${url}/rest/v1/memories`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=minimal" },
        // ponytail: sending embedding as a raw JSON array. PostgREST may require
        // pgvector columns as a bracketed string ("[0.1,0.2,...]") instead — if
        // live inserts reject the array, switch to `[${embedding.join(",")}]`.
        body: JSON.stringify({ content, embedding, metadata: metadata ?? {} }),
      });
      if (!res.ok) throw new Error(`memory insert failed: ${res.status} ${await res.text()}`);
    },
    recall: async (query, k = defaultK) => {
      const embedding = await embed.embed(query);
      const res = await fetchFn(`${url}/rest/v1/rpc/match_memories`, {
        method: "POST",
        headers,
        body: JSON.stringify({ query_embedding: embedding, match_count: k }),
      });
      if (!res.ok) throw new Error(`memory recall failed: ${res.status} ${await res.text()}`);
      return res.json();
    },
    // ponytail: bounded scan (default 200 newest) — a full-table dump would grow
    // unbounded. Raise the cap or page if the dreamer ever needs more than the
    // recent window for density scoring.
    scan: async (limit = 200) => {
      const query = `select=content,embedding,metadata,created_at&order=created_at.desc&limit=${limit}`;
      const res = await fetchFn(`${url}/rest/v1/memories?${query}`, { headers });
      if (!res.ok) throw new Error(`memory scan failed: ${res.status} ${await res.text()}`);
      return res.json();
    },
  };
}
