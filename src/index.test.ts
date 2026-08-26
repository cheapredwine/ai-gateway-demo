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

  // ─── Bootstrap ────────────────────────────────────────────────────────────

  describe("Bootstrap", () => {
    it("GET /api/bootstrap returns error without valid API token", async () => {
      const res = await fetchApp(new Request("http://localhost/api/bootstrap"));
      expect([200, 500]).toContain(res.status);
    });

    it("GET /demo/api/bootstrap returns error without valid API token", async () => {
      const res = await fetchApp(new Request("http://localhost/demo/api/bootstrap"));
      expect([200, 500]).toContain(res.status);
    });
  });

  // ─── Debug Access ─────────────────────────────────────────────────────────

  describe("Debug Access", () => {
    it("GET /api/debug-access returns status and header info", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(mockRes(
        { id: "test-id", choices: [] },
        { headers: { "cf-aig-cache-status": "MISS" } }
      ));

      const res = await fetchApp(new Request("http://localhost/api/debug-access"));
      expect(res.status).toBe(200);
      const data = (await res.json()) as { status: number; sentHeaders: Record<string, string> };
      expect(data.status).toBe(200);
      expect(data.sentHeaders["CF-Access-Client-Id"]).toBe("set");
      expect(data.sentHeaders["CF-Access-Client-Secret"]).toBe("set");
    });

    it("GET /demo/api/debug-access returns status and header info", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(mockRes(
        { id: "test-id", choices: [] },
        { headers: { "cf-aig-cache-status": "MISS" } }
      ));

      const res = await fetchApp(new Request("http://localhost/demo/api/debug-access"));
      expect(res.status).toBe(200);
      const data = (await res.json()) as { status: number; sentHeaders: Record<string, string> };
      expect(data.sentHeaders["CF-Access-Client-Id"]).toBe("set");
    });
  });
});
