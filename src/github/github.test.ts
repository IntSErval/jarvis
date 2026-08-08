import { describe, it, expect, vi } from "vitest";
import { githubClient } from "./github.js";

const CONFIG = { token: "ghp_test", owner: "octocat", repo: "hello" };

// Mock fetch: every GitHub API call returns the configured body/status.
function router(opts: { status?: number; body?: unknown } = {}) {
  const status = opts.status ?? 200;
  const body = opts.body ?? [];
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    return new Response(JSON.stringify(body), { status });
  });
}

describe("githubClient", () => {
  it("listIssues GETs the repo issues with a Bearer token + required GitHub headers (read-only)", async () => {
    const fetchFn = router({ body: [{ number: 1, title: "bug" }] });
    const out = await githubClient({ ...CONFIG, fetchFn }).listIssues({ state: "open" });

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(init!.method ?? "GET").toBe("GET");
    expect(String(url)).toContain("https://api.github.com/repos/octocat/hello/issues");
    expect(String(url)).toContain("state=open");
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ghp_test");
    expect(headers.Accept).toContain("github");
    expect(headers["User-Agent"]).toBeTruthy(); // GitHub rejects requests without one
    expect(out).toEqual([{ number: 1, title: "bug" }]);
  });

  it("getIssue GETs a single issue by number", async () => {
    const fetchFn = router({ body: { number: 42 } });
    const out = await githubClient({ ...CONFIG, fetchFn }).getIssue({ number: 42 });

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(init!.method ?? "GET").toBe("GET");
    expect(String(url)).toContain("/repos/octocat/hello/issues/42");
    expect(out).toEqual({ number: 42 });
  });

  it("getFile GETs repo file contents, encoding each path segment but keeping slashes", async () => {
    const fetchFn = router({ body: { type: "file", path: "src/a b.ts" } });
    await githubClient({ ...CONFIG, fetchFn }).getFile({ path: "src/a b.ts" });

    const [url] = fetchFn.mock.calls[0]!;
    expect(String(url)).toContain("/repos/octocat/hello/contents/src/a%20b.ts");
  });

  it("honours owner/repo from args, overriding the config defaults", async () => {
    const fetchFn = router();
    await githubClient({ ...CONFIG, fetchFn }).listIssues({ owner: "other", repo: "proj" });
    expect(String(fetchFn.mock.calls[0]![0])).toContain("/repos/other/proj/issues");
  });

  it("throws when owner/repo is missing and no default is configured", async () => {
    const fetchFn = router();
    await expect(
      githubClient({ token: "t", fetchFn }).listIssues({}),
    ).rejects.toThrow(/owner|repo/i);
  });

  it("throws when getIssue is called without a number", async () => {
    const fetchFn = router();
    await expect(githubClient({ ...CONFIG, fetchFn }).getIssue({})).rejects.toThrow(/number/i);
  });

  it("throws when getFile is called without a path", async () => {
    const fetchFn = router();
    await expect(githubClient({ ...CONFIG, fetchFn }).getFile({})).rejects.toThrow(/path/i);
  });

  it("throws when the GitHub API returns a non-2xx status", async () => {
    const fetchFn = router({ status: 404, body: { message: "Not Found" } });
    await expect(githubClient({ ...CONFIG, fetchFn }).listIssues({})).rejects.toThrow(/github|404/i);
  });
});
