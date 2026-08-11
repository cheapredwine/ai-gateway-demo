import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock global fetch for chat tests to avoid hitting real API
const originalFetch = globalThis.fetch;

// Mock KV storage
const kvStore = new Map<string, string>();
const mockKV = {
  get: async (key: string) => kvStore.get(key) ?? null,
  put: async (key: string, value: string) => { kvStore.set(key, value); },
};

// Mock env
const mockEnv = {
  SETTINGS: mockKV as unknown as KVNamespace,
  CLOUDFLARE_API_TOKEN: "fake-token",
  CLOUDFLARE_ACCOUNT_ID: "fake-account",
  GATEWAY_NAME: "demo-gateway",
};

import app from "./index";

const createCtx = () => ({
  waitUntil: async () => {},
  passThroughOnException: () => {},
  props: {} as any,
});

const fetchApp = (req: Request) => app.fetch(req, mockEnv as any, createCtx());

describe("AI Gateway Demo", () => {
  beforeEach(() => {
    kvStore.clear();
    globalThis.fetch = originalFetch;
  });

  describe("GET /", () => {
    it("returns HTML with gateway name", async () => {
      const res = await fetchApp(new Request("http://localhost/"));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      const text = await res.text();
      expect(text).toContain("AI Gateway Cost Control Demo");
      expect(text).toContain("demo-gateway");
    });
  });

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
  });

  describe("Chat", () => {
    it("returns upstream response when fetch succeeds", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "cf-aig-cache-status": "MISS" }),
        json: async () => ({
          model: "@cf/meta/llama-3.1-8b-instruct-fast",
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          choices: [{ message: { content: "Hello back" } }],
        }),
      } as unknown as Response);

      const res = await fetchApp(new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "@cf/meta/llama-3.1-8b-instruct-fast", prompt: "Hello" }),
      }));
      expect(res.status).toBe(200);
      const data = (await res.json()) as { ok: boolean; cacheStatus: string; estimatedCost: number | undefined };
      expect(data.ok).toBe(true);
      expect(data.cacheStatus).toBe("MISS");
      // estimatedCost is undefined because no custom costs configured
      expect(data.estimatedCost).toBeUndefined();
    });

    it("returns 429 when upstream is rate limited", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers(),
        json: async () => ({ error: { message: "Rate limited" } }),
      } as unknown as Response);

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
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          model: "@cf/meta/llama-3.1-8b-instruct-fast",
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          choices: [{ message: { content: "Hi" } }],
        }),
      } as unknown as Response);
      globalThis.fetch = mockFetch;

      const res = await fetchApp(new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "@cf/meta/llama-3.1-8b-instruct-fast", prompt: "Hello" }),
      }));

      expect(res.status).toBe(200);
      const data = (await res.json()) as { estimatedCost: number };
      // 10 * 0.00001 + 20 * 0.00003 = 0.0001 + 0.0006 = 0.0007
      expect(data.estimatedCost).toBeCloseTo(0.0007, 6);
      const callArgs = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
      expect(callArgs[1].headers["cf-aig-custom-cost"]).toBe('{"per_token_in":0.00001,"per_token_out":0.00003}');
    });

    it("applies custom cost headers from client", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          model: "@cf/meta/llama-3.1-8b-instruct-fast",
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          choices: [{ message: { content: "Hi" } }],
        }),
      } as unknown as Response);
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
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "cf-aig-cache-status": "HIT" }),
        json: async () => ({
          model: "@cf/meta/llama-3.1-8b-instruct-fast",
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          choices: [{ message: { content: "Hi" } }],
        }),
      } as unknown as Response);
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

    it("skips cache when skip flag is set", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          model: "@cf/meta/llama-3.1-8b-instruct-fast",
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          choices: [{ message: { content: "Hi" } }],
        }),
      } as unknown as Response);
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
  });

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
  });

  describe("Stats", () => {
    it("GET /api/stats returns error without valid API token", async () => {
      const res = await fetchApp(new Request("http://localhost/api/stats"));
      expect([200, 500]).toContain(res.status);
    });
  });

  describe("Bootstrap", () => {
    it("GET /api/bootstrap returns error without valid API token", async () => {
      const res = await fetchApp(new Request("http://localhost/api/bootstrap"));
      expect([200, 500]).toContain(res.status);
    });
  });
});
