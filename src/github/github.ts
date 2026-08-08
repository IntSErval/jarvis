// Real GithubClient backed by the GitHub REST API v3, read-only. Same shape as
// the calendar adapter: plain fetch, no octokit SDK, and only GETs — no write
// methods exist here, enforcing least privilege (PRD 5.2) at the adapter.
//
// Auth: a personal access token sent as a Bearer credential. No OAuth refresh
// dance (simpler than Google) — GitHub PATs are long-lived.

type FetchFn = typeof fetch;

interface Config {
  token: string;
  /** Default repo owner; overridable per call via args.owner. */
  owner?: string;
  /** Default repo name; overridable per call via args.repo. */
  repo?: string;
  fetchFn?: FetchFn;
}

/** Read-only GitHub surface — least privilege (PRD 5.2). No write methods. */
export interface GithubClient {
  listIssues(args: unknown): Promise<unknown>;
  getIssue(args: unknown): Promise<unknown>;
  getFile(args: unknown): Promise<unknown>;
}

const API_BASE = "https://api.github.com";

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

/** Encode a repo file path, per segment, so slashes stay as path separators. */
function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function githubClient(config: Config): GithubClient {
  const { token, owner: defaultOwner, repo: defaultRepo, fetchFn = fetch } = config;

  /** Pull owner/repo (arg overrides config default) and return the rest. */
  function resolveRepo(args: unknown): { owner: string; repo: string; rest: Record<string, unknown> } {
    const { owner = defaultOwner, repo = defaultRepo, ...rest } = (args ?? {}) as {
      owner?: string;
      repo?: string;
      [k: string]: unknown;
    };
    if (!owner || !repo) throw new Error("github: owner and repo are required");
    return { owner, repo, rest };
  }

  async function get(path: string, query: Record<string, unknown> = {}): Promise<unknown> {
    const res = await fetchFn(`${API_BASE}${path}${toQuery(query)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "jarvis", // GitHub rejects requests without a User-Agent.
      },
    });
    if (!res.ok) throw new Error(`github request failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

  // async so synchronous validation throws surface as rejected promises.
  return {
    listIssues: async (args: unknown) => {
      const { owner, repo, rest } = resolveRepo(args);
      return get(`/repos/${owner}/${repo}/issues`, rest);
    },
    getIssue: async (args: unknown) => {
      const { owner, repo, rest } = resolveRepo(args);
      const { number, ...query } = rest as { number?: number; [k: string]: unknown };
      if (number === undefined || number === null) throw new Error("github getIssue: number is required");
      return get(`/repos/${owner}/${repo}/issues/${number}`, query);
    },
    getFile: async (args: unknown) => {
      const { owner, repo, rest } = resolveRepo(args);
      const { path, ...query } = rest as { path?: string; [k: string]: unknown };
      if (!path) throw new Error("github getFile: path is required");
      return get(`/repos/${owner}/${repo}/contents/${encodePath(path)}`, query);
    },
  };
}
