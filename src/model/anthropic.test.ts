import { describe, it, expect, vi } from "vitest";
import { anthropicModel } from "./anthropic.js";
import { CALENDAR_TOOLS, type Message } from "../orchestrator.js";

function reply(body: unknown) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status: 200 }),
  );
}

const userMsg: Message[] = [{ role: "user", content: "hello" }];

describe("anthropicModel", () => {
  it("POSTs to the Messages API with auth + version headers and maps user text + tools", async () => {
    const fetchFn = reply({ content: [{ type: "text", text: "hi there" }] });
    await anthropicModel("sk-test", { fetchFn }).turn(userMsg, CALENDAR_TOOLS);

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
    const headers = init!.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-test");
    expect(headers["anthropic-version"]).toBeTruthy();
    const sent = JSON.parse(init!.body as string);
    expect(sent.model).toMatch(/claude/);
    expect(sent.messages).toEqual([{ role: "user", content: [{ type: "text", text: "hello" }] }]);
    expect(sent.tools.map((t: { name: string }) => t.name)).toEqual(["list_events", "get_event"]);
  });

  it("maps a text-only response to a done turn (no tool calls)", async () => {
    const fetchFn = reply({ content: [{ type: "text", text: "It's sunny." }] });
    const turn = await anthropicModel("sk-test", { fetchFn }).turn(userMsg, CALENDAR_TOOLS);
    expect(turn).toEqual({ toolCalls: [], text: "It's sunny." });
  });

  it("maps tool_use response blocks into ModelTurn.toolCalls", async () => {
    const fetchFn = reply({
      content: [
        { type: "text", text: "" },
        { type: "tool_use", id: "toolu_1", name: "list_events", input: { day: "tomorrow" } },
      ],
    });
    const turn = await anthropicModel("sk-test", { fetchFn }).turn(userMsg, CALENDAR_TOOLS);
    expect(turn.toolCalls).toEqual([{ id: "toolu_1", name: "list_events", args: { day: "tomorrow" } }]);
  });

  it("parses token usage into ModelTurn.usage (tagged with the call's model)", async () => {
    const fetchFn = reply({ content: [{ type: "text", text: "hi" }], usage: { input_tokens: 12, output_tokens: 7 } });
    const turn = await anthropicModel("sk-test", { fetchFn, model: "claude-opus-4-8" }).turn(userMsg, CALENDAR_TOOLS);
    expect(turn.usage).toEqual({ model: "claude-opus-4-8", inputTokens: 12, outputTokens: 7 });
  });

  it("throws when the API returns a non-2xx status", async () => {
    const fetchFn = vi.fn(async () => new Response("bad", { status: 400 }));
    await expect(anthropicModel("sk-test", { fetchFn }).turn(userMsg, CALENDAR_TOOLS)).rejects.toThrow(
      /400|anthropic/i,
    );
  });
});
