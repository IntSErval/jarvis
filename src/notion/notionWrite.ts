// Notion WRITE surface, kept in its own file so the read NotionClient stays
// provably write-free (PRD 5.2/5.3 least privilege). A createPage here only ever
// runs after a human approves the parked approval — never inside the model loop.
//
// ponytail: createPage forwards args straight through as the Notion create-page
// body ({ parent, properties, children? }) — the model builds a valid body and a
// human reviews it before approving. Add a friendly {parent,title} translator
// here if raw bodies prove error-prone.
// ponytail: ~15 lines of auth/fetch boilerplate mirror notion.ts rather than
// share a helper — not worth a shared module for one write. Extract if a second
// writer appears.

type FetchFn = typeof fetch;

interface Config {
  token: string;
  fetchFn?: FetchFn;
}

export interface NotionWriter {
  createPage(args: unknown): Promise<unknown>;
}

const API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

export function notionWriter(config: Config): NotionWriter {
  const { token, fetchFn = fetch } = config;

  return {
    createPage: async (args: unknown) => {
      const res = await fetchFn(`${API_BASE}/pages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args ?? {}),
      });
      if (!res.ok) throw new Error(`notion createPage failed: ${res.status} ${await res.text()}`);
      return res.json();
    },
  };
}
