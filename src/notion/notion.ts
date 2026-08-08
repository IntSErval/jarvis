// Real NotionClient backed by the Notion REST API, read-only. Same shape as
// the GitHub adapter: plain fetch, no @notionhq/client SDK, and only
// GETs/search — no create/update/delete/append/patch methods exist here,
// enforcing least privilege (PRD 5.2/5.3) at the adapter.
//
// Auth: an integration token sent as a Bearer credential. No OAuth refresh
// dance (simpler than Google) — Notion integration tokens are long-lived.

type FetchFn = typeof fetch;

interface Config {
  token: string;
  fetchFn?: FetchFn;
}

/** Read-only Notion surface — least privilege (PRD 5.2/5.3). No write methods. */
export interface NotionClient {
  search(args: unknown): Promise<unknown>;
  getPage(args: unknown): Promise<unknown>;
  getBlockChildren(args: unknown): Promise<unknown>;
}

const API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

/** Turn leftover args into a URL query string (skips non-scalars). */
function toQuery(args: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      params.set(k, String(v));
    }
  }
  const q = params.toString();
  return q ? `?${q}` : "";
}

export function notionClient(config: Config): NotionClient {
  const { token, fetchFn = fetch } = config;

  function headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      ...extra,
    };
  }

  async function handle(res: Response): Promise<unknown> {
    if (!res.ok) throw new Error(`notion request failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async function get(path: string, query: Record<string, unknown> = {}): Promise<unknown> {
    const res = await fetchFn(`${API_BASE}${path}${toQuery(query)}`, {
      method: "GET",
      headers: headers(),
    });
    return handle(res);
  }

  async function post(path: string, body: unknown): Promise<unknown> {
    const res = await fetchFn(`${API_BASE}${path}`, {
      method: "POST",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    return handle(res);
  }

  // async so synchronous validation throws surface as rejected promises.
  return {
    search: async (args: unknown) => post("/search", args ?? {}),
    getPage: async (args: unknown) => {
      const { page_id, ...query } = (args ?? {}) as { page_id?: string; [k: string]: unknown };
      if (!page_id) throw new Error("notion getPage: page_id is required");
      return get(`/pages/${page_id}`, query);
    },
    getBlockChildren: async (args: unknown) => {
      const { block_id, ...query } = (args ?? {}) as { block_id?: string; [k: string]: unknown };
      if (!block_id) throw new Error("notion getBlockChildren: block_id is required");
      return get(`/blocks/${block_id}/children`, query);
    },
  };
}
