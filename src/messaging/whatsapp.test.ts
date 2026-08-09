import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import { whatsappClient, parseInboundMessage, verifyWebhook, verifySignature } from "./whatsapp.js";

const CONFIG = { token: "wa_test", phoneNumberId: "123456" };

function router(opts: { status?: number; body?: unknown } = {}) {
  const status = opts.status ?? 200;
  const body = opts.body ?? { messages: [{ id: "wamid.1" }] };
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    return new Response(JSON.stringify(body), { status });
  });
}

describe("whatsappClient.sendText", () => {
  it("POSTs a text message with Bearer token to the Cloud API", async () => {
    const fetchFn = router();
    await whatsappClient({ ...CONFIG, fetchFn }).sendText("15550001111", "hello");

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(init!.method).toBe("POST");
    expect(String(url)).toBe("https://graph.facebook.com/v21.0/123456/messages");
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer wa_test");
    expect(headers["Content-Type"]).toContain("application/json");
    expect(JSON.parse(init!.body as string)).toEqual({
      messaging_product: "whatsapp",
      to: "15550001111",
      type: "text",
      text: { body: "hello" },
    });
  });

  it("throws on a non-2xx response", async () => {
    const fetchFn = router({ status: 401, body: { error: "bad token" } });
    await expect(whatsappClient({ ...CONFIG, fetchFn }).sendText("1", "x")).rejects.toThrow(/whatsapp|401/i);
  });
});

describe("parseInboundMessage", () => {
  const textWebhook = {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [{ from: "15550001111", type: "text", text: { body: "hi jarvis" } }],
            },
          },
        ],
      },
    ],
  };

  it("digs out the first text message's from + body", () => {
    expect(parseInboundMessage(textWebhook)).toEqual({ from: "15550001111", text: "hi jarvis" });
  });

  it("returns null for a status callback (no messages)", () => {
    const statusWebhook = { entry: [{ changes: [{ value: { statuses: [{ status: "delivered" }] } }] }] };
    expect(parseInboundMessage(statusWebhook)).toBeNull();
  });

  it("returns null for a non-text message (e.g. image)", () => {
    const imageWebhook = {
      entry: [{ changes: [{ value: { messages: [{ from: "1", type: "image", image: {} }] } }] }],
    };
    expect(parseInboundMessage(imageWebhook)).toBeNull();
  });

  it("returns null for garbage input", () => {
    expect(parseInboundMessage(null)).toBeNull();
    expect(parseInboundMessage({})).toBeNull();
    expect(parseInboundMessage("nope")).toBeNull();
  });
});

describe("verifyWebhook", () => {
  it("echoes the challenge when mode=subscribe and token matches", () => {
    expect(verifyWebhook({ mode: "subscribe", token: "secret", challenge: "42" }, "secret")).toBe("42");
  });

  it("returns null on a wrong token", () => {
    expect(verifyWebhook({ mode: "subscribe", token: "wrong", challenge: "42" }, "secret")).toBeNull();
  });

  it("returns null when mode is not subscribe", () => {
    expect(verifyWebhook({ mode: "unsubscribe", token: "secret", challenge: "42" }, "secret")).toBeNull();
  });
});

describe("verifySignature", () => {
  const secret = "app_secret";
  const raw = '{"hello":"world"}';
  const good = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");

  it("accepts a correctly-signed body", () => {
    expect(verifySignature(raw, good, secret)).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifySignature(raw + " ", good, secret)).toBe(false);
  });

  it("rejects a missing or malformed signature header", () => {
    expect(verifySignature(raw, undefined, secret)).toBe(false);
    expect(verifySignature(raw, "garbage", secret)).toBe(false);
  });
});
