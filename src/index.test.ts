import { describe, it, expect, vi, beforeEach } from "vitest";

const originalFetch = globalThis.fetch;

const kvStore = new Map<string, string>();
const mockKV = {
  get: async (key: string) => kvStore.get(key) ?? null,
  put: async (key: string, value: string) => { kvStore.set(key, value); },
};

const mockEnv = {
  SETTINGS: mockKV as unknown as KVNamespace,
  CLOUDFLARE_API_TOKEN: "fake-token",
  CLOUDFLARE_ACCOUNT_ID: "fake-account",
  GATEWAY_NAME: "demo-gateway",
  GATEWAY_ID: "demo-gateway",
  CF_ACCESS_CLIENT_ID: "fake-access-id",
  CF_ACCESS_CLIENT_SECRET: "fake-access-secret",
};

import app from "./index";

const createCtx = () => ({
  waitUntil: async () => {},
  passThroughOnException: () => {},
  props: {} as any,
});

const fetchApp = (req: Request) => app.fetch(req, mockEnv as any, createCtx());

function mockRes(data: any, opts: { status?: number; headers?: Record<string, string> } = {}) {
  const status = opts.status ?? 200;
  const body = JSON.stringify(data);
  return {
    ok: status < 400,
    status,
    headers: new Headers(opts.headers),
    text: async () => body,
    json: async () => data,
  } as unknown as Response;
}

describe("AI Gateway Demo", () => {
  beforeEach(() => {
    kvStore.clear();
    globalThis.fetch = originalFetch;
  });

  // ─── HTML UI ─────────────────────────────────────────────────────────────

  describe("HTML UI", () => {
    it("GET / returns HTML with gateway name", async () => {
      const res = await fetchApp(new Request("http://localhost/"));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      const text = await res.text();
      expect(text).toContain("AI Gateway");
      expect(text).toContain("demo-gateway");
    });

    it("GET /demo returns same HTML", async () => {
      const res = await fetchApp(new Request("http://localhost/demo"));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      const text = await res.text();
      expect(text).toContain("AI Gateway");
      expect(text).toContain("demo-gateway");
    });

    it("GET /demo/ returns same HTML", async () => {
      const res = await fetchApp(new Request("http://localhost/demo/"));
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("AI Gateway");
    });

    it("HTML at /demo includes gateway mode detection", async () => {
      const res = await fetchApp(new Request("http://localhost/demo"));
      const text = await res.text();
      expect(text).toContain("onGateway");
      expect(text).toContain("/compat/chat/completions");
    });

    it("HTML at / does not include gateway-only code path", async () => {
      const res = await fetchApp(new Request("http://localhost/"));
      const text = await res.text();
      expect(text).toContain("onGateway");
    });

    it("HTML includes session ID input and newSessionId function", async () => {
      const res = await fetchApp(new Request("http://localhost/"));
      const text = await res.text();
      expect(text).toContain('id="sessionId"');
      expect(text).toContain("newSessionId()");
      expect(text).toContain("generateSessionId()");
    });

    it("HTML includes session_id in buildMetadata", async () => {
      const res = await fetchApp(new Request("http://localhost/"));
      const text = await res.text();
      expect(text).toContain("session_id");
    });

    it("HTML logout URL is derived from GATEWAY_NAME, not hardcoded", async () => {
      for (const path of ["/", "/demo"]) {
        const res = await fetchApp(new Request(`http://localhost${path}`));
        const text = await res.text();
        expect(text).toContain("https://demo-gateway/cdn-cgi/access/logout");
        expect(text).not.toContain("ai-gw.jsherron.com");
      }
    });

    it("GET /demo/logout redirects to GATEWAY_NAME access logout", async () => {
      const res = await fetchApp(new Request("http://localhost/demo/logout"));
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("https://demo-gateway/cdn-cgi/access/logout");
    });

    it("does not set wildcard CORS headers (same-origin app)", async () => {
      const res = await fetchApp(new Request("http://localhost/"));
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
      const apiRes = await fetchApp(new Request("http://localhost/api/costs"));
      expect(apiRes.headers.get("access-control-allow-origin")).toBeNull();
    });

    it("client log() renders messages as text, not innerHTML (XSS-safe)", async () => {
      const res = await fetchApp(new Request("http://localhost/demo"));
      const text = await res.text();
      expect(text).not.toContain("el.innerHTML +=");
      expect(text).not.toContain('el.innerHTML = `[${time}');
      expect(text).toContain("textContent");
    });

    it("generateSessionId uses crypto.getRandomValues, not Math.random", async () => {
      const res = await fetchApp(new Request("http://localhost/demo"));
      const text = await res.text();
      expect(text).toContain("crypto.getRandomValues");
      expect(text).not.toContain("Math.random()");
    });

    it("sendChat fires bursts in parallel (Promise.all), not sequential loop", async () => {
      const res = await fetchApp(new Request("http://localhost/demo"));
      const text = await res.text();
      expect(text).not.toContain("for (let i = 0; i < count; i++)");
      expect(text).toContain("Promise.all");
    });
  });

  // ─── Custom Costs ────────────────────────────────────────────────────────

  describe("Custom Costs", () => {
    it("GET /api/costs returns empty initially", async () => {
      const res = await fetchApp(new Request("http://localhost/api/costs"));
      expect(res.status).toBe(200);
      const data = (await res.json()) as { ok: boolean; costs: unknown };
      expect(data.ok).toBe(true);
      expect(data.costs).toBeNull();
    });

    it("POST /api/costs saves costs to KV", async () => {
      const postRes = await fetchApp(new Request("http://localhost/api/costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ per_token_in: 0.000001, per_token_out: 0.000002 }),
      }));
      expect(postRes.status).toBe(200);
      const postData = (await postRes.json()) as { ok: boolean };
      expect(postData.ok).toBe(true);

      const getRes = await fetchApp(new Request("http://localhost/api/costs"));
      const getData = (await getRes.json()) as { costs: Record<string, number> };
      expect(getData.costs).toEqual({ per_token_in: 0.000001, per_token_out: 0.000002 });
    });

    it("GET /demo/api/costs returns empty initially", async () => {
      const res = await fetchApp(new Request("http://localhost/demo/api/costs"));
      expect(res.status).toBe(200);
      const data = (await res.json()) as { ok: boolean; costs: unknown };
      expect(data.ok).toBe(true);
      expect(data.costs).toBeNull();
    });

    it("POST /demo/api/costs saves costs to KV", async () => {
      const postRes = await fetchApp(new Request("http://localhost/demo/api/costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ per_token_in: 0.000003, per_token_out: 0.000004 }),
      }));
      expect(postRes.status).toBe(200);

      const getRes = await fetchApp(new Request("http://localhost/demo/api/costs"));
      const getData = (await getRes.json()) as { costs: Record<string, number> };
      expect(getData.costs).toEqual({ per_token_in: 0.000003, per_token_out: 0.000004 });
    });

    it("overwrites high costs with low costs on re-save", async () => {
      // Save high costs first
      await fetchApp(new Request("http://localhost/api/costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ per_token_in: 0.01, per_token_out: 0.05 }),
      }));

      let getRes = await fetchApp(new Request("http://localhost/api/costs"));
      let getData = (await getRes.json()) as { costs: Record<string, number> };
      expect(getData.costs).toEqual({ per_token_in: 0.01, per_token_out: 0.05 });

      // Overwrite with low costs
      await fetchApp(new Request("http://localhost/api/costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ per_token_in: 0.000001, per_token_out: 0.000002 }),
      }));

      getRes = await fetchApp(new Request("http://localhost/api/costs"));
      getData = (await getRes.json()) as { costs: Record<string, number> };
      expect(getData.costs).toEqual({ per_token_in: 0.000001, per_token_out: 0.000002 });
    });

    it("HTML includes setPreset calling saveCosts", async () => {
      const res = await fetchApp(new Request("http://localhost/"));
      const text = await res.text();
      expect(text).toContain("setPreset");
      // setPreset should call saveCosts() to persist to KV
      const presetMatch = text.match(/function setPreset\([^)]*\)\s*\{[^}]*\}/);
      expect(presetMatch).toBeTruthy();
      expect(presetMatch![0]).toContain("saveCosts()");
    });

    it("HTML does not double-prefix cost with $", async () => {
      const res = await fetchApp(new Request("http://localhost/"));
      const text = await res.text();
      // Client should use data.cost directly, not "$" + data.cost
      expect(text).not.toContain('"$" + data.cost');
      expect(text).toContain("data.cost ||");
    });

    it("POST /api/costs rejects negative numbers", async () => {
      const res = await fetchApp(new Request("http://localhost/api/costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ per_token_in: -1, per_token_out: 0.000002 }),
      }));
      expect(res.status).toBe(400);
    });

    it("POST /api/costs rejects non-numeric values", async () => {
      const res = await fetchApp(new Request("http://localhost/demo/api/costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ per_token_in: "free", per_token_out: 0.000002 }),
      }));
      expect(res.status).toBe(400);
    });

    it("POST /api/costs rejects missing fields", async () => {
      const res = await fetchApp(new Request("http://localhost/api/costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ per_token_in: 0.000001 }),
      }));
      expect(res.status).toBe(400);
    });

    it("POST /api/costs still accepts valid zero", async () => {
      const res = await fetchApp(new Request("http://localhost/api/costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ per_token_in: 0, per_token_out: 0 }),
      }));
      expect(res.status).toBe(200);
    });

    it("GET /api/costs tolerates corrupt KV JSON", async () => {
      kvStore.set("custom_costs", "not-json{{{");
      const res = await fetchApp(new Request("http://localhost/api/costs"));
      expect(res.status).toBe(200);
      const data = (await res.json()) as { ok: boolean; costs: unknown };
      expect(data.ok).toBe(true);
      expect(data.costs).toBeNull();
    });

    it("chat tolerates corrupt KV custom_costs (no custom cost header sent)", async () => {
      kvStore.set("custom_costs", "not-json{{{");
      const mockFetch = vi.fn().mockResolvedValue(mockRes({
        model: "@cf/meta/llama-3.1-8b-instruct-fast",
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        choices: [{ message: { content: "Hi" } }],
      }));
      globalThis.fetch = mockFetch;

      const res = await fetchApp(new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "@cf/meta/llama-3.1-8b-instruct-fast", prompt: "Hello" }),
      }));
      expect(res.status).toBe(200);
      const callArgs = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
      expect(callArgs[1].headers["cf-aig-custom-cost"]).toBeUndefined();
    });
  });

  // ─── Chat (Worker proxy mode) ─────────────────────────────────────────────

  describe("Chat (Worker proxy)", () => {
    it("returns upstream response when fetch succeeds", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(mockRes({
        model: "@cf/meta/llama-3.1-8b-instruct-fast",
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        choices: [{ message: { content: "Hello back" } }],
      }, { headers: { "cf-aig-cache-status": "MISS" } }));

      const res = await fetchApp(new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "@cf/meta/llama-3.1-8b-instruct-fast", prompt: "Hello" }),
      }));
      expect(res.status).toBe(200);
      const data = (await res.json()) as { ok: boolean; cacheStatus: string; estimatedCost: number | undefined };
      expect(data.ok).toBe(true);
      expect(data.cacheStatus).toBe("MISS");
      expect(data.estimatedCost).toBeUndefined();
    });

    it("returns 429 when upstream is rate limited", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(mockRes(
        { error: { message: "Rate limited" } },
        { status: 429 }
      ));

      const res = await fetchApp(new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "@cf/meta/llama-3.1-8b-instruct-fast", prompt: "Hello" }),
      }));
      expect(res.status).toBe(429);
      const data = (await res.json()) as { ok: boolean; status: number };
      expect(data.ok).toBe(false);
      expect(data.status).toBe(429);
    });

    it("uses KV custom costs when no headers provided", async () => {
      kvStore.set("custom_costs", JSON.stringify({ per_token_in: 0.00001, per_token_out: 0.00003 }));
      const mockFetch = vi.fn().mockResolvedValue(mockRes({
        model: "@cf/meta/llama-3.1-8b-instruct-fast",
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        choices: [{ message: { content: "Hi" } }],
      }));
      globalThis.fetch = mockFetch;

      const res = await fetchApp(new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "@cf/meta/llama-3.1-8b-instruct-fast", prompt: "Hello" }),
      }));

      expect(res.status).toBe(200);
      const data = (await res.json()) as { estimatedCost: number };
      expect(data.estimatedCost).toBeCloseTo(0.0007, 6);
      const callArgs = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
      expect(callArgs[1].headers["cf-aig-custom-cost"]).toBe('{"per_token_in":0.00001,"per_token_out":0.00003}');
    });

    it("applies custom cost headers from client", async () => {
      const mockFetch = vi.fn().mockResolvedValue(mockRes({
        model: "@cf/meta/llama-3.1-8b-instruct-fast",
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        choices: [{ message: { content: "Hi" } }],
      }));
      globalThis.fetch = mockFetch;

      await fetchApp(new Request("http://localhost/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-custom-cost-in": "0.00001",
          "x-custom-cost-out": "0.00003",
        },
        body: JSON.stringify({ model: "@cf/meta/llama-3.1-8b-instruct-fast", prompt: "Hello" }),
      }));

      const callArgs = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
      expect(callArgs[1].headers["cf-aig-custom-cost"]).toBe('{"per_token_in":0.00001,"per_token_out":0.00003}');
    });

    it("applies cache and metadata parameters", async () => {
      const mockFetch = vi.fn().mockResolvedValue(mockRes({
        model: "@cf/meta/llama-3.1-8b-instruct-fast",
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        choices: [{ message: { content: "Hi" } }],
      }, { headers: { "cf-aig-cache-status": "HIT" } }));
      globalThis.fetch = mockFetch;

      const res = await fetchApp(new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "@cf/meta/llama-3.1-8b-instruct-fast",
          prompt: "Hello",
          cache: { ttl: 300, key: "test-key" },
          metadata: { team: "demo" },
        }),
      }));

      expect(res.status).toBe(200);
      const callArgs = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
      expect(callArgs[1].headers["cf-aig-cache-ttl"]).toBe("300");
      expect(callArgs[1].headers["cf-aig-cache-key"]).toBe("test-key");
      expect(callArgs[1].headers["cf-aig-metadata"]).toBe('{"team":"demo"}');
    });

    it("passes session_id in cf-aig-metadata to upstream", async () => {
      const mockFetch = vi.fn().mockResolvedValue(mockRes({
        model: "@cf/meta/llama-3.1-8b-instruct-fast",
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        choices: [{ message: { content: "Hi" } }],
      }));
      globalThis.fetch = mockFetch;

      await fetchApp(new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "@cf/meta/llama-3.1-8b-instruct-fast",
          prompt: "Hello",
          metadata: { session_id: "sess-abc123", team: "demo" },
        }),
      }));

      const callArgs = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
      const meta = JSON.parse(callArgs[1].headers["cf-aig-metadata"]);
      expect(meta.session_id).toBe("sess-abc123");
      expect(meta.team).toBe("demo");
    });

    it("rejects metadata with reserved cf. keys", async () => {
      const res = await fetchApp(new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "@cf/meta/llama-3.1-8b-instruct-fast",
          prompt: "Hello",
          metadata: { "cf.user_id": "spoof" },
        }),
      }));
      expect(res.status).toBe(400);
    });

    it("rejects metadata with more than 5 keys", async () => {
      const res = await fetchApp(new Request("http://localhost/demo/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "@cf/meta/llama-3.1-8b-instruct-fast",
          prompt: "Hello",
          metadata: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 },
        }),
      }));
      expect(res.status).toBe(400);
    });

    it("rejects metadata with object values", async () => {
      const res = await fetchApp(new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "@cf/meta/llama-3.1-8b-instruct-fast",
          prompt: "Hello",
          metadata: { nested: { bad: true } },
        }),
      }));
      expect(res.status).toBe(400);
    });

    it("skips cache when skip flag is set", async () => {
      const mockFetch = vi.fn().mockResolvedValue(mockRes({
        model: "@cf/meta/llama-3.1-8b-instruct-fast",
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        choices: [{ message: { content: "Hi" } }],
      }));
      globalThis.fetch = mockFetch;

      await fetchApp(new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "@cf/meta/llama-3.1-8b-instruct-fast",
          prompt: "Hello",
          cache: { ttl: 300, skip: true },
        }),
      }));

      const callArgs = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
      expect(callArgs[1].headers["cf-aig-skip-cache"]).toBe("true");
      expect(callArgs[1].headers["cf-aig-cache-ttl"]).toBeUndefined();
    });

    it("sends service token headers to upstream", async () => {
      const mockFetch = vi.fn().mockResolvedValue(mockRes({
        model: "@cf/meta/llama-3.1-8b-instruct-fast",
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        choices: [{ message: { content: "Hi" } }],
      }));
      globalThis.fetch = mockFetch;

      await fetchApp(new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "@cf/meta/llama-3.1-8b-instruct-fast", prompt: "Hello" }),
      }));

      const callArgs = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
      expect(callArgs[1].headers["CF-Access-Client-Id"]).toBe("fake-access-id");
      expect(callArgs[1].headers["CF-Access-Client-Secret"]).toBe("fake-access-secret");
    });

    it("prefixes model with workers-ai/", async () => {
      const mockFetch = vi.fn().mockResolvedValue(mockRes({
        model: "@cf/meta/llama-3.1-8b-instruct-fast",
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        choices: [{ message: { content: "Hi" } }],
      }));
      globalThis.fetch = mockFetch;

      await fetchApp(new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "@cf/meta/llama-3.1-8b-instruct-fast", prompt: "Hello" }),
      }));

      const callArgs = mockFetch.mock.calls[0] as [string, { body: string }];
      const sentBody = JSON.parse(callArgs[1].body);
      expect(sentBody.model).toBe("workers-ai/@cf/meta/llama-3.1-8b-instruct-fast");
    });

    it("chat upstream fetch carries an AbortSignal timeout", async () => {
      const mockFetch = vi.fn().mockResolvedValue(mockRes({
        model: "@cf/meta/llama-3.1-8b-instruct-fast",
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        choices: [{ message: { content: "Hi" } }],
      }));
      globalThis.fetch = mockFetch;

      await fetchApp(new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "@cf/meta/llama-3.1-8b-instruct-fast", prompt: "Hello" }),
      }));

      const callArgs = mockFetch.mock.calls[0] as [string, { signal?: AbortSignal }];
      expect(callArgs[1].signal).toBeInstanceOf(AbortSignal);
    });

    it("Cloudflare API calls carry an AbortSignal timeout", async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
        const method = opts?.method ?? "GET";
        if (method === "PUT") {
          return Promise.resolve(mockRes({ result: {}, success: true }));
        }
        if (url.includes("/spend-limits")) {
          return Promise.resolve(mockRes({ result: [], success: true }));
        }
        return Promise.resolve(mockRes({}));
      });

      await fetchApp(new Request("http://localhost/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rateLimit: { enabled: true, limit: 100, interval: 60, technique: "fixed" },
          spendLimit: { enabled: false, budget: 1, window: "1d", scope: "global" },
        }),
      }));

      const putCall = (globalThis.fetch as any).mock.calls.find(
        ([, o]: [unknown, any]) => o?.method === "PUT"
      ) as [string, { signal?: AbortSignal }];
      expect(putCall[1].signal).toBeInstanceOf(AbortSignal);
    });
  });

  // ─── Chat (/demo/api proxy) ───────────────────────────────────────────────

  describe("Chat (/demo/api proxy)", () => {
    it("/demo/api/chat returns upstream response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(mockRes({
        model: "@cf/meta/llama-3.1-8b-instruct-fast",
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        choices: [{ message: { content: "Hello back" } }],
      }, { headers: { "cf-aig-cache-status": "MISS" } }));

      const res = await fetchApp(new Request("http://localhost/demo/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "@cf/meta/llama-3.1-8b-instruct-fast", prompt: "Hello" }),
      }));
      expect(res.status).toBe(200);
      const data = (await res.json()) as { ok: boolean; cacheStatus: string };
      expect(data.ok).toBe(true);
      expect(data.cacheStatus).toBe("MISS");
    });

    it("/demo/api/chat sends service token headers", async () => {
      const mockFetch = vi.fn().mockResolvedValue(mockRes({
        model: "@cf/meta/llama-3.1-8b-instruct-fast",
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
        choices: [{ message: { content: "Hi" } }],
      }));
      globalThis.fetch = mockFetch;

      await fetchApp(new Request("http://localhost/demo/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "@cf/meta/llama-3.1-8b-instruct-fast", prompt: "Hello" }),
      }));

      const callArgs = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
      expect(callArgs[1].headers["CF-Access-Client-Id"]).toBe("fake-access-id");
      expect(callArgs[1].headers["CF-Access-Client-Secret"]).toBe("fake-access-secret");
    });

    it("/demo/api/chat applies cache headers", async () => {
      const mockFetch = vi.fn().mockResolvedValue(mockRes({
        model: "@cf/meta/llama-3.1-8b-instruct-fast",
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
        choices: [{ message: { content: "Hi" } }],
      }));
      globalThis.fetch = mockFetch;

      await fetchApp(new Request("http://localhost/demo/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "@cf/meta/llama-3.1-8b-instruct-fast",
          prompt: "Hello",
          cache: { ttl: 600, key: "demo-key" },
          metadata: { env: "test" },
        }),
      }));

      const callArgs = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
      expect(callArgs[1].headers["cf-aig-cache-ttl"]).toBe("600");
      expect(callArgs[1].headers["cf-aig-cache-key"]).toBe("demo-key");
      expect(callArgs[1].headers["cf-aig-metadata"]).toBe('{"env":"test"}');
    });
  });

  // ─── Gateway Settings ─────────────────────────────────────────────────────

  describe("Gateway Settings", () => {
    it("POST /api/settings returns error without valid API token", async () => {
      const res = await fetchApp(new Request("http://localhost/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rateLimit: { enabled: false, limit: 100, interval: 60, technique: "fixed" },
          spendLimit: { enabled: false, budget: 1, window: "1d", scope: "global" },
        }),
      }));
      expect([500, 502]).toContain(res.status);
    });

    it("POST /demo/api/settings returns error without valid API token", async () => {
      const res = await fetchApp(new Request("http://localhost/demo/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rateLimit: { enabled: false, limit: 100, interval: 60, technique: "fixed" },
          spendLimit: { enabled: false, budget: 1, window: "1d", scope: "global" },
        }),
      }));
      expect([500, 502]).toContain(res.status);
    });

    it("reports warnings when spend-limit cleanup fails", async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
        const method = opts?.method ?? "GET";
        if (method === "PUT") {
          return Promise.resolve(mockRes({ result: {}, success: true }));
        }
        if (url.includes("/spend-limits") && method === "GET") {
          return Promise.resolve(mockRes({ result: [{ id: "rule-1" }, { id: "rule-2" }], success: true }));
        }
        if (url.includes("/spend-limits") && method === "DELETE") {
          return Promise.resolve(mockRes({ success: false, errors: [{ message: "boom" }] }, { status: 500 }));
        }
        return Promise.resolve(mockRes({}));
      });

      const res = await fetchApp(new Request("http://localhost/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rateLimit: { enabled: false, limit: 100, interval: 60, technique: "fixed" },
          spendLimit: { enabled: false, budget: 1, window: "1d", scope: "global" },
        }),
      }));
      expect(res.status).toBe(200);
      const data = (await res.json()) as { ok: boolean; warnings?: string[] };
      expect(data.ok).toBe(true);
      expect(data.warnings?.length).toBeGreaterThan(0);
    });

    it("deletes all existing spend-limit rules in parallel with no warnings on success", async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
        const method = opts?.method ?? "GET";
        if (method === "PUT") {
          return Promise.resolve(mockRes({ result: {}, success: true }));
        }
        if (url.includes("/spend-limits") && method === "GET") {
          return Promise.resolve(mockRes({ result: [{ id: "rule-1" }, { id: "rule-2" }], success: true }));
        }
        if (url.includes("/spend-limits") && method === "DELETE") {
          return Promise.resolve(mockRes({ result: { id: "deleted" }, success: true }));
        }
        return Promise.resolve(mockRes({}));
      });

      const res = await fetchApp(new Request("http://localhost/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rateLimit: { enabled: false, limit: 100, interval: 60, technique: "fixed" },
          spendLimit: { enabled: false, budget: 1, window: "1d", scope: "global" },
        }),
      }));
      expect(res.status).toBe(200);
      const data = (await res.json()) as { ok: boolean; warnings?: string[] };
      expect(data.ok).toBe(true);
      expect(data.warnings ?? []).toHaveLength(0);
      const deletes = (globalThis.fetch as any).mock.calls.filter(
        ([, o]: [unknown, any]) => o?.method === "DELETE"
      );
      expect(deletes).toHaveLength(2);
    });

    it("omits rate_limiting_technique when disabling rate limiting", async () => {
      let putBody: any;
      globalThis.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
        const method = opts?.method ?? "GET";
        if (method === "PUT") {
          putBody = JSON.parse(opts.body);
          return Promise.resolve(mockRes({ result: {}, success: true }));
        }
        if (url.includes("/spend-limits")) {
          return Promise.resolve(mockRes({ result: [], success: true }));
        }
        return Promise.resolve(mockRes({}));
      });

      const res = await fetchApp(new Request("http://localhost/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rateLimit: { enabled: false, limit: 100, interval: 60, technique: "sliding" },
          spendLimit: { enabled: false, budget: 1, window: "1d", scope: "global" },
        }),
      }));
      expect(res.status).toBe(200);
      expect(putBody.rate_limiting_limit).toBe(0);
      expect(putBody.rate_limiting_interval).toBe(0);
      expect(putBody).not.toHaveProperty("rate_limiting_technique");
    });

    it("sends rate_limiting_technique when enabling rate limiting", async () => {
      let putBody: any;
      globalThis.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
        const method = opts?.method ?? "GET";
        if (method === "PUT") {
          putBody = JSON.parse(opts.body);
          return Promise.resolve(mockRes({ result: {}, success: true }));
        }
        if (url.includes("/spend-limits")) {
          return Promise.resolve(mockRes({ result: [], success: true }));
        }
        return Promise.resolve(mockRes({}));
      });

      const res = await fetchApp(new Request("http://localhost/demo/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rateLimit: { enabled: true, limit: 100, interval: 60, technique: "fixed" },
          spendLimit: { enabled: false, budget: 1, window: "1d", scope: "global" },
        }),
      }));
      expect(res.status).toBe(200);
      expect(putBody.rate_limiting_limit).toBe(100);
      expect(putBody.rate_limiting_technique).toBe("fixed");
    });
  });

  // ─── Stats ────────────────────────────────────────────────────────────────

  describe("Stats", () => {
    it("GET /api/stats returns error without valid API token", async () => {
      const res = await fetchApp(new Request("http://localhost/api/stats"));
      expect([200, 500]).toContain(res.status);
    });

    it("GET /demo/api/stats returns error without valid API token", async () => {
      const res = await fetchApp(new Request("http://localhost/demo/api/stats"));
      expect([200, 500]).toContain(res.status);
    });

    it("returns aggregated requests, tokens, and cost from GraphQL", async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/ai-gateway/gateways/")) {
          return Promise.resolve(mockRes({
            result: {
              id: "demo-gateway",
              cache_ttl: 0,
              rate_limiting_limit: 50,
              rate_limiting_interval: 60,
            },
            success: true,
          }));
        }
        if (url.includes("/graphql")) {
          return Promise.resolve(mockRes({
            data: {
              viewer: {
                accounts: [{
                  aiGatewayRequestsAdaptiveGroups: [
                    {
                      count: 5,
                      sum: { tokensIn: 220, tokensOut: 217, cost: 13.05 },
                      dimensions: { model: "@cf/meta/llama-3.1-8b-instruct-fast", gateway: "demo-gateway" },
                    },
                    {
                      count: 11,
                      sum: { tokensIn: 3397, tokensOut: 33, cost: 0.0016 },
                      dimensions: { model: "@cf/meta/llama-guard-3-8b", gateway: "demo-gateway" },
                    },
                  ],
                }],
              },
            },
          }));
        }
        return Promise.resolve(mockRes({}));
      });

      const res = await fetchApp(new Request("http://localhost/api/stats"));
      expect(res.status).toBe(200);
      const data = (await res.json()) as { ok: boolean; requests: number; tokens: number; cost: string };
      expect(data.ok).toBe(true);
      expect(data.requests).toBe(16);
      expect(data.tokens).toBe(3867);
      expect(data.cost).toBe("$13.0516");
    });

    it("uses correct GraphQL field names (tokensIn/tokensOut, not responseTokens/promptTokens)", async () => {
      let graphqlBody = "";
      globalThis.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
        if (url.includes("/ai-gateway/gateways/")) {
          return Promise.resolve(mockRes({ result: {}, success: true }));
        }
        if (url.includes("/graphql")) {
          graphqlBody = opts.body;
          return Promise.resolve(mockRes({
            data: { viewer: { accounts: [{ aiGatewayRequestsAdaptiveGroups: [] }] } },
          }));
        }
        return Promise.resolve(mockRes({}));
      });

      await fetchApp(new Request("http://localhost/api/stats"));

      const parsed = JSON.parse(graphqlBody);
      expect(parsed.query).toContain("tokensIn");
      expect(parsed.query).toContain("tokensOut");
      expect(parsed.query).not.toContain("responseTokens");
      expect(parsed.query).not.toContain("promptTokens");
    });

    it("returns dashes when GraphQL has no data", async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/ai-gateway/gateways/")) {
          return Promise.resolve(mockRes({ result: {}, success: true }));
        }
        if (url.includes("/graphql")) {
          return Promise.resolve(mockRes({
            data: { viewer: { accounts: [{ aiGatewayRequestsAdaptiveGroups: [] }] } },
          }));
        }
        return Promise.resolve(mockRes({}));
      });

      const res = await fetchApp(new Request("http://localhost/api/stats"));
      expect(res.status).toBe(200);
      const data = (await res.json()) as { ok: boolean; requests: string; tokens: string; cost: string };
      expect(data.ok).toBe(true);
      expect(data.requests).toBe("-");
      expect(data.tokens).toBe("-");
      expect(data.cost).toBe("-");
    });

    it("returns gateway config fields (cacheTTL, rlLimit, rlInterval)", async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/ai-gateway/gateways/")) {
          return Promise.resolve(mockRes({
            result: {
              id: "demo-gateway",
              cache_ttl: 300,
              rate_limiting_limit: 100,
              rate_limiting_interval: 60,
            },
            success: true,
          }));
        }
        if (url.includes("/graphql")) {
          return Promise.resolve(mockRes({
            data: { viewer: { accounts: [{ aiGatewayRequestsAdaptiveGroups: [] }] } },
          }));
        }
        return Promise.resolve(mockRes({}));
      });

      const res = await fetchApp(new Request("http://localhost/api/stats"));
      const data = (await res.json()) as { cacheTTL: number; rlLimit: number; rlInterval: number };
      expect(data.cacheTTL).toBe(300);
      expect(data.rlLimit).toBe(100);
      expect(data.rlInterval).toBe(60);
    });

    it("spendLimit is On when spend-limit rules exist (from rules API, not config)", async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/spend-limits")) {
          return Promise.resolve(mockRes({ result: [{ id: "rule-1", budget: 1 }], success: true }));
        }
        if (url.includes("/ai-gateway/gateways/")) {
          return Promise.resolve(mockRes({ result: {}, success: true }));
        }
        if (url.includes("/graphql")) {
          return Promise.resolve(mockRes({
            data: { viewer: { accounts: [{ aiGatewayRequestsAdaptiveGroups: [] }] } },
          }));
        }
        return Promise.resolve(mockRes({}));
      });

      const res = await fetchApp(new Request("http://localhost/api/stats"));
      const data = (await res.json()) as { ok: boolean; spendLimit: string };
      expect(data.spendLimit).toBe("On");
    });

    it("spendLimit is Off when no spend-limit rules exist", async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/spend-limits")) {
          return Promise.resolve(mockRes({ result: [], success: true }));
        }
        if (url.includes("/ai-gateway/gateways/")) {
          return Promise.resolve(mockRes({ result: {}, success: true }));
        }
        if (url.includes("/graphql")) {
          return Promise.resolve(mockRes({
            data: { viewer: { accounts: [{ aiGatewayRequestsAdaptiveGroups: [] }] } },
          }));
        }
        return Promise.resolve(mockRes({}));
      });

      const res = await fetchApp(new Request("http://localhost/demo/api/stats"));
      const data = (await res.json()) as { ok: boolean; spendLimit: string };
      expect(data.spendLimit).toBe("Off");
    });

    it("does not report rateLimited from nonexistent gateway config field", async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/spend-limits")) {
          return Promise.resolve(mockRes({ result: [], success: true }));
        }
        if (url.includes("/ai-gateway/gateways/")) {
          return Promise.resolve(mockRes({ result: {}, success: true }));
        }
        if (url.includes("/graphql")) {
          return Promise.resolve(mockRes({
            data: { viewer: { accounts: [{ aiGatewayRequestsAdaptiveGroups: [] }] } },
          }));
        }
        return Promise.resolve(mockRes({}));
      });

      const res = await fetchApp(new Request("http://localhost/api/stats"));
      const data = (await res.json()) as { ok: boolean; rateLimited?: unknown };
      expect(data.ok).toBe(true);
      expect(data).not.toHaveProperty("rateLimited");
    });

    it("GET /api/stats returns 500 when upstream fetch rejects", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("upstream down"));
      const res = await fetchApp(new Request("http://localhost/api/stats"));
      expect(res.status).toBe(500);
      const data = (await res.json()) as { ok: boolean; error: string };
      expect(data.ok).toBe(false);
      expect(data.error).toContain("upstream down");
    });

    it("GET /demo/api/stats returns 500 when upstream fetch rejects", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("upstream down"));
      const res = await fetchApp(new Request("http://localhost/demo/api/stats"));
      expect(res.status).toBe(500);
    });

    it("/demo/api/stats returns same data", async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/ai-gateway/gateways/")) {
          return Promise.resolve(mockRes({ result: { cache_ttl: 0 }, success: true }));
        }
        if (url.includes("/graphql")) {
          return Promise.resolve(mockRes({
            data: { viewer: { accounts: [{
              aiGatewayRequestsAdaptiveGroups: [
                { count: 3, sum: { tokensIn: 100, tokensOut: 50, cost: 1.5 }, dimensions: {} },
              ],
            }] } },
          }));
        }
        return Promise.resolve(mockRes({}));
      });

      const res = await fetchApp(new Request("http://localhost/demo/api/stats"));
      expect(res.status).toBe(200);
      const data = (await res.json()) as { ok: boolean; requests: number; tokens: number; cost: string };
      expect(data.ok).toBe(true);
      expect(data.requests).toBe(3);
      expect(data.tokens).toBe(150);
      expect(data.cost).toBe("$1.5000");
    });
  });

  // ─── Bootstrap (admin-gated) ──────────────────────────────────────────────

  describe("Bootstrap (admin-gated)", () => {
    it("GET /api/bootstrap returns 401 without auth", async () => {
      const res = await fetchApp(new Request("http://localhost/api/bootstrap"));
      expect(res.status).toBe(401);
    });

    it("GET /demo/api/bootstrap returns 500 when upstream fetch rejects", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("upstream down"));
      const res = await fetchApp(new Request("http://localhost/demo/api/bootstrap", {
        headers: { "Authorization": "Bearer fake-token" },
      }));
      expect(res.status).toBe(500);
      const data = (await res.json()) as { ok: boolean; error: string };
      expect(data.ok).toBe(false);
      expect(data.error).toContain("upstream down");
    });

    it("GET /demo/api/bootstrap returns 401 without auth", async () => {
      const res = await fetchApp(new Request("http://localhost/demo/api/bootstrap"));
      expect(res.status).toBe(401);
    });

    it("GET /api/bootstrap returns 401 with wrong token", async () => {
      const res = await fetchApp(new Request("http://localhost/api/bootstrap", {
        headers: { "Authorization": "Bearer wrong-token" },
      }));
      expect(res.status).toBe(401);
    });

    it("GET /api/bootstrap returns gateway with correct token", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(mockRes({ result: { id: "demo-gateway" }, success: true }));
      const res = await fetchApp(new Request("http://localhost/api/bootstrap", {
        headers: { "Authorization": "Bearer fake-token" },
      }));
      expect(res.status).toBe(200);
      const data = (await res.json()) as { ok: boolean; created: boolean };
      expect(data.ok).toBe(true);
      expect(data.created).toBe(false);
    });

    it("GET /demo/api/bootstrap creates gateway with correct token when missing", async () => {
      const mockFetch = vi.fn().mockImplementation((url: string, opts: any) => {
        if (opts?.method === "POST") {
          return Promise.resolve(mockRes({ result: { id: "demo-gateway" }, success: true }));
        }
        return Promise.resolve({ ok: false, status: 404, text: async () => "not found", json: async () => ({}) } as unknown as Response);
      });
      globalThis.fetch = mockFetch;

      const res = await fetchApp(new Request("http://localhost/demo/api/bootstrap", {
        headers: { "Authorization": "Bearer fake-token" },
      }));
      expect(res.status).toBe(200);
      const data = (await res.json()) as { ok: boolean; created: boolean };
      expect(data.created).toBe(true);
    });
  });

  // ─── Debug Access (removed) ───────────────────────────────────────────────

  describe("Debug Access (removed)", () => {
    it("GET /api/debug-access returns 404", async () => {
      const res = await fetchApp(new Request("http://localhost/api/debug-access"));
      expect(res.status).toBe(404);
    });

    it("GET /demo/api/debug-access returns 404", async () => {
      const res = await fetchApp(new Request("http://localhost/demo/api/debug-access"));
      expect(res.status).toBe(404);
    });
  });
});
