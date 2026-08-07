// Real ModelClient backed by the Anthropic Messages API. Same port as the stub,
// so swapping it in is a one-line change in server.ts. Plain fetch, no SDK.
//
// ponytail: multi-turn tool round-trips aren't fully mapped yet — the
// orchestrator's Message type stores an assistant tool call as content:"" +
// toolCallId and drops the tool name/input, so the assistant `tool_use` block
// can't be faithfully reconstructed before a `tool_result`. The no-tool path
// and first-turn tool_use parsing are correct; full tool loops need the
// orchestrator Message shape to carry tool name/args (follow-up, and it's
// blocked on a working calendar token anyway).

import type { Message, ModelClient, ModelTurn, ModelToolCall, ToolSpec } from "../orchestrator.js";

type FetchFn = typeof fetch;

interface Opts {
  model?: string;
  maxTokens?: number;
  fetchFn?: FetchFn;
}

interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

function toApiMessage(m: Message): { role: "user" | "assistant"; content: unknown[] } {
  if (m.role === "tool") {
    return { role: "user", content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }] };
  }
  return { role: m.role, content: [{ type: "text", text: m.content }] };
}

export function anthropicModel(apiKey: string, opts: Opts = {}): ModelClient {
  const { model = "claude-sonnet-5", maxTokens = 1024, fetchFn = fetch } = opts;

  return {
    turn: async (messages: Message[], tools: ToolSpec[]): Promise<ModelTurn> => {
      const res = await fetchFn("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages: messages.map(toApiMessage),
          tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: { type: "object" } })),
        }),
      });
      if (!res.ok) throw new Error(`anthropic request failed: ${res.status} ${await res.text()}`);

      const body = (await res.json()) as { content?: ContentBlock[] };
      const blocks = body.content ?? [];
      const text = blocks
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("");
      const toolCalls: ModelToolCall[] = blocks
        .filter((b) => b.type === "tool_use")
        .map((b) => ({ id: b.id ?? "", name: b.name ?? "", args: b.input }));
      return { toolCalls, text };
    },
  };
}
