import { describe, it, expect, vi, beforeEach } from "vitest";

const originalFetch = globalThis.fetch;

// Mocked at the module level because src/index.ts -> src/auth.ts imports
// "jose" for Access-JWT verification. Defaults to *rejecting* every call
// (fail closed) so a test that forgets to configure this mock can't
// accidentally make isValidAccessRequest() return true and bypass the
// admin gate it's supposed to be testing.
const mockJwtVerify = vi.fn().mockRejectedValue(new Error("not mocked — fails closed by default"));
vi.mock("jose", () => ({
  jwtVerify: (...args: unknown[]) => mockJwtVerify(...args),
  createRemoteJWKSet: () => "mock-jwks-fn",
}));

const kvStore = new Map<string, string>();
const mockKV = {
  get: async (key: string) => kvStore.get(key) ?? null,
  put: async (key: string, value: string) => {
    kvStore.set(key, value);
  },
};

const mockEnv = {
  SETTINGS: mockKV as unknown as KVNamespace,
  CLOUDFLARE_API_TOKEN: "fake-token",
  CLOUDFLARE_ACCOUNT_ID: "fake-account",
  GATEWAY_NAME: "demo-gateway",
  GATEWAY_ID: "demo-gateway",
  CF_ACCESS_CLIENT_ID: "fake-access-id",
  CF_ACCESS_CLIENT_SECRET: "fake-access-secret",
  CF_ACCESS_TEAM_DOMAIN: "https://fake-team.cloudflareaccess.com",
  CF_ACCESS_AUD: "fake-aud-tag",
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
    mockJwtVerify.mockReset().mockRejectedValue(new Error("not mocked — fails closed by default"));
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

    it("gateway-mode branch sends the user's cache key but no auto-generated one", async () => {
      // Regression history: an autoCacheKey was added believing the default
      // key included the rotating Access credential — disproven by the
      // full-history log scan (75 browser HITs historically, default-key
      // path) and by browser console tests (explicit keys MISS forever on
      // IdP sessions regardless). The autoCacheKey was removed; the UI
      // forwards only a user-provided cache key again (September behavior).
      const text = await (await fetchApp(new Request("http://localhost/"))).text();
      expect(text).not.toContain("function autoCacheKey");
      expect(text).not.toContain("autoCacheKey(model, prompt)");
      expect(text).toContain('if (cacheKey) headers["cf-aig-cache-key"] = cacheKey;');
      expect(text).not.toContain('"cf-aig-authorization"');
    });

    it("does not embed GATEWAY_RUN_TOKEN in the public workers.dev page", async () => {
      // The run credential may only appear on the Access-protected /demo
      // page; the public workers.dev page must never carry it.
      const text = await (await fetchApp(new Request("http://localhost/"))).text();
      expect(text).not.toContain("gatewayRunToken");
    });

    it("cookie-names debug endpoint returns names only, never values", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(mockRes({}));
      const res = await fetchApp(
        new Request("http://localhost/api/cookie-names", {
          headers: {
            Cookie:
              "CF_Authorization=secretvalue1; CF_AppSession=secretvalue2; __cf_bm=secretvalue3",
          },
        }),
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as { ok: boolean; cookieNames: string[] };
      expect(data.ok).toBe(true);
      expect(data.cookieNames).toEqual(["CF_Authorization", "CF_AppSession", "__cf_bm"]);
      const text = JSON.stringify(data);
      expect(text).not.toContain("secretvalue");
    });

    it("cookie-fingerprints endpoint hashes values (rotation detectable, values never exposed)", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(mockRes({}));
      const res = await fetchApp(
        new Request("http://localhost/api/cookie-fingerprints", {
          headers: {
            Cookie:
              "CF_Authorization=secretvalue1; CF_AppSession=secretvalue2; __cf_bm=secretvalue3",
          },
        }),
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        ok: boolean;
        fingerprints: Array<{ name: string; hash: string }>;
      };
      expect(data.ok).toBe(true);
      expect(data.fingerprints.map((f) => f.name)).toEqual([
        "CF_Authorization",
        "CF_AppSession",
        "__cf_bm",
      ]);
      // hashes are fixed-width hex, differ across values, and never contain
      // the raw value or a full digest
      expect(data.fingerprints.every((f) => /^[0-9a-f]{12}$/.test(f.hash))).toBe(true);
      expect(data.fingerprints[0].hash).not.toBe(data.fingerprints[1].hash);
      const text = JSON.stringify(data);
      expect(text).not.toContain("secretvalue");
    });

    it("emits an explicit per-send cache result for BOTH outcomes in both modes", async () => {
      // Regression: on MISS the UI emitted nothing beyond the buried OK-line
      // status, so gateway-mode users (who can never HIT without a run
      // token) saw "no cache result shown". Contract: with caching enabled,
      // every successful send logs exactly one result line — HIT (green ⚡),
      // MISS (neutral ○), or unknown (warn) — in both chat paths.
      const text = await (await fetchApp(new Request("http://localhost/"))).text();
      expect(text).toContain("cache HIT — served from cache");
      expect(text).toContain("cache MISS — fetched from provider");
      expect(text).toContain("cache status unknown");
      expect((text.match(/cache HIT — served from cache/g) ?? []).length).toBe(2); // gateway + worker branches
      expect((text.match(/cache MISS — fetched from provider/g) ?? []).length).toBe(2);
    });

    it("no GATEWAY_RUN_TOKEN mechanism remains (workaround removed as disproven)", async () => {
      // The cf-aig-authorization workaround was proven ineffective in the
      // browser (real token in that header: MISS x3 on an IdP session —
      // the header is ignored for cache keying). The whole mechanism was
      // removed; nothing may reference it.
      const text = await (await fetchApp(new Request("http://localhost/"))).text();
      expect(text).not.toContain("GATEWAY_RUN_TOKEN");
      expect(text).not.toContain('"cf-aig-authorization"');
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
      expect(text).not.toContain("el.innerHTML = `[${time}");
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
      const postRes = await fetchApp(
        new Request("http://localhost/api/costs", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer fake-token" },
          body: JSON.stringify({ per_token_in: 0.000001, per_token_out: 0.000002 }),
        }),
      );
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
      const postRes = await fetchApp(
        new Request("http://localhost/demo/api/costs", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer fake-token" },
          body: JSON.stringify({ per_token_in: 0.000003, per_token_out: 0.000004 }),
        }),
      );
      expect(postRes.status).toBe(200);

      const getRes = await fetchApp(new Request("http://localhost/demo/api/costs"));
      const getData = (await getRes.json()) as { costs: Record<string, number> };
      expect(getData.costs).toEqual({ per_token_in: 0.000003, per_token_out: 0.000004 });
    });

    it("overwrites high costs with low costs on re-save", async () => {
      // Save high costs first
      await fetchApp(
        new Request("http://localhost/api/costs", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer fake-token" },
          body: JSON.stringify({ per_token_in: 0.01, per_token_out: 0.05 }),
        }),
      );

      let getRes = await fetchApp(new Request("http://localhost/api/costs"));
      let getData = (await getRes.json()) as { costs: Record<string, number> };
      expect(getData.costs).toEqual({ per_token_in: 0.01, per_token_out: 0.05 });

      // Overwrite with low costs
      await fetchApp(
        new Request("http://localhost/api/costs", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer fake-token" },
          body: JSON.stringify({ per_token_in: 0.000001, per_token_out: 0.000002 }),
        }),
      );

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
      const res = await fetchApp(
        new Request("http://localhost/api/costs", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer fake-token" },
          body: JSON.stringify({ per_token_in: -1, per_token_out: 0.000002 }),
        }),
      );
      expect(res.status).toBe(400);
    });

    it("POST /api/costs rejects non-numeric values", async () => {
      const res = await fetchApp(
        new Request("http://localhost/demo/api/costs", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer fake-token" },
          body: JSON.stringify({ per_token_in: "free", per_token_out: 0.000002 }),
        }),
      );
      expect(res.status).toBe(400);
    });

    it("POST /api/costs rejects missing fields", async () => {
      const res = await fetchApp(
        new Request("http://localhost/api/costs", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer fake-token" },
          body: JSON.stringify({ per_token_in: 0.000001 }),
        }),
      );
      expect(res.status).toBe(400);
    });

    it("POST /api/costs still accepts valid zero", async () => {
      const res = await fetchApp(
        new Request("http://localhost/api/costs", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer fake-token" },
          body: JSON.stringify({ per_token_in: 0, per_token_out: 0 }),
        }),
      );
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
      const mockFetch = vi.fn().mockResolvedValue(
        mockRes({
          model: "@cf/meta/llama-3.1-8b-instruct-fp8",
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          choices: [{ message: { content: "Hi" } }],
        }),
      );
      globalThis.fetch = mockFetch;

      const res = await fetchApp(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "@cf/meta/llama-3.1-8b-instruct-fp8", prompt: "Hello" }),
        }),
      );
      expect(res.status).toBe(200);
      const callArgs = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
      expect(callArgs[1].headers["cf-aig-custom-cost"]).toBeUndefined();
    });
  });

  // ─── Chat (Worker proxy mode) ─────────────────────────────────────────────

  describe("Chat (Worker proxy)", () => {
    it("returns upstream response when fetch succeeds", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mockRes(
          {
            model: "@cf/meta/llama-3.1-8b-instruct-fp8",
            usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
            choices: [{ message: { content: "Hello back" } }],
          },
          { headers: { "cf-aig-cache-status": "MISS" } },
        ),
      );

      const res = await fetchApp(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "@cf/meta/llama-3.1-8b-instruct-fp8", prompt: "Hello" }),
        }),
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        ok: boolean;
        cacheStatus: string;
        estimatedCost: number | undefined;
      };
      expect(data.ok).toBe(true);
      expect(data.cacheStatus).toBe("MISS");
      expect(data.estimatedCost).toBeUndefined();
    });

    it("includes guardrails activity from the gateway logs when Llama Guard evaluations ran", async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/compat/chat/completions")) {
          return Promise.resolve(
            mockRes({
              model: "@cf/meta/llama-3.2-3b-instruct",
              usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
              choices: [{ message: { content: "Hello back" } }],
            }),
          );
        }
        // Gateway logs API — one llama-guard evaluation entry for this request
        // plus one older/other entry that must be excluded.
        return Promise.resolve(
          mockRes({
            result: [
              {
                request_type: "llama-guard",
                created_at: new Date().toISOString(),
                duration: 1200,
                tokens_in: 240,
              },
              {
                request_type: "llama-guard",
                created_at: new Date(Date.now() - 60_000).toISOString(), // too old
                duration: 999,
                tokens_in: 1,
              },
              {
                request_type: "provider",
                created_at: new Date().toISOString(),
                duration: 700,
              },
            ],
            success: true,
          }),
        );
      });

      const res = await fetchApp(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "@cf/meta/llama-3.2-3b-instruct", prompt: "Hello" }),
        }),
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        ok: boolean;
        guardrails?: { evaluations: number; totalMs: number; entries: Array<{ duration: number }> };
      };
      expect(data.ok).toBe(true);
      expect(data.guardrails).toBeDefined();
      expect(data.guardrails!.evaluations).toBe(1);
      expect(data.guardrails!.totalMs).toBe(1200);
      expect(data.guardrails!.entries).toHaveLength(1);
    });

    it("omits guardrails activity when the logs lookup fails (never fails the chat)", async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/compat/chat/completions")) {
          return Promise.resolve(
            mockRes({
              model: "@cf/meta/llama-3.2-3b-instruct",
              usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
              choices: [{ message: { content: "Hello back" } }],
            }),
          );
        }
        return Promise.reject(new Error("logs API down"));
      });

      const res = await fetchApp(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "@cf/meta/llama-3.2-3b-instruct", prompt: "Hello" }),
        }),
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as { ok: boolean; guardrails: unknown };
      expect(data.ok).toBe(true);
      expect(data.guardrails).toBeUndefined();
    });

    it("returns 429 when upstream is rate limited", async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(mockRes({ error: { message: "Rate limited" } }, { status: 429 }));

      const res = await fetchApp(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "@cf/meta/llama-3.1-8b-instruct-fp8", prompt: "Hello" }),
        }),
      );
      expect(res.status).toBe(429);
      const data = (await res.json()) as { ok: boolean; status: number };
      expect(data.ok).toBe(false);
      expect(data.status).toBe(429);
    });

    it("uses KV custom costs when no headers provided", async () => {
      kvStore.set(
        "custom_costs",
        JSON.stringify({ per_token_in: 0.00001, per_token_out: 0.00003 }),
      );
      const mockFetch = vi.fn().mockResolvedValue(
        mockRes({
          model: "@cf/meta/llama-3.1-8b-instruct-fp8",
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          choices: [{ message: { content: "Hi" } }],
        }),
      );
      globalThis.fetch = mockFetch;

      const res = await fetchApp(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "@cf/meta/llama-3.1-8b-instruct-fp8", prompt: "Hello" }),
        }),
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as { estimatedCost: number };
      expect(data.estimatedCost).toBeCloseTo(0.0007, 6);
      const callArgs = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
      expect(callArgs[1].headers["cf-aig-custom-cost"]).toBe(
        '{"per_token_in":0.00001,"per_token_out":0.00003}',
      );
    });

    it("applies custom cost headers from client", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockRes({
          model: "@cf/meta/llama-3.1-8b-instruct-fp8",
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          choices: [{ message: { content: "Hi" } }],
        }),
      );
      globalThis.fetch = mockFetch;

      await fetchApp(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-custom-cost-in": "0.00001",
            "x-custom-cost-out": "0.00003",
          },
          body: JSON.stringify({ model: "@cf/meta/llama-3.1-8b-instruct-fp8", prompt: "Hello" }),
        }),
      );

      const callArgs = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
      expect(callArgs[1].headers["cf-aig-custom-cost"]).toBe(
        '{"per_token_in":0.00001,"per_token_out":0.00003}',
      );
    });

    it("applies cache and metadata parameters", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockRes(
          {
            model: "@cf/meta/llama-3.1-8b-instruct-fp8",
            usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
            choices: [{ message: { content: "Hi" } }],
          },
          { headers: { "cf-aig-cache-status": "HIT" } },
        ),
      );
      globalThis.fetch = mockFetch;

      const res = await fetchApp(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "@cf/meta/llama-3.1-8b-instruct-fp8",
            prompt: "Hello",
            cache: { ttl: 300, key: "test-key" },
            metadata: { team: "demo" },
          }),
        }),
      );

      expect(res.status).toBe(200);
      const callArgs = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
      expect(callArgs[1].headers["cf-aig-cache-ttl"]).toBe("300");
      expect(callArgs[1].headers["cf-aig-cache-key"]).toBe("test-key");
      expect(callArgs[1].headers["cf-aig-metadata"]).toBe('{"team":"demo"}');
    });

    it("passes session_id in cf-aig-metadata to upstream", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockRes({
          model: "@cf/meta/llama-3.1-8b-instruct-fp8",
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          choices: [{ message: { content: "Hi" } }],
        }),
      );
      globalThis.fetch = mockFetch;

      await fetchApp(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "@cf/meta/llama-3.1-8b-instruct-fp8",
            prompt: "Hello",
            metadata: { session_id: "sess-abc123", team: "demo" },
          }),
        }),
      );

      const callArgs = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
      const meta = JSON.parse(callArgs[1].headers["cf-aig-metadata"]);
      expect(meta.session_id).toBe("sess-abc123");
      expect(meta.team).toBe("demo");
    });

    it("rejects metadata with reserved cf. keys", async () => {
      const res = await fetchApp(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "@cf/meta/llama-3.1-8b-instruct-fp8",
            prompt: "Hello",
            metadata: { "cf.user_id": "spoof" },
          }),
        }),
      );
      expect(res.status).toBe(400);
    });

    it("rejects metadata with more than 5 keys", async () => {
      const res = await fetchApp(
        new Request("http://localhost/demo/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "@cf/meta/llama-3.1-8b-instruct-fp8",
            prompt: "Hello",
            metadata: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 },
          }),
        }),
      );
      expect(res.status).toBe(400);
    });

    it("rejects metadata with object values", async () => {
      const res = await fetchApp(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "@cf/meta/llama-3.1-8b-instruct-fp8",
            prompt: "Hello",
            metadata: { nested: { bad: true } },
          }),
        }),
      );
      expect(res.status).toBe(400);
    });

    it("skips cache when skip flag is set", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockRes({
          model: "@cf/meta/llama-3.1-8b-instruct-fp8",
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          choices: [{ message: { content: "Hi" } }],
        }),
      );
      globalThis.fetch = mockFetch;

      await fetchApp(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "@cf/meta/llama-3.1-8b-instruct-fp8",
            prompt: "Hello",
            cache: { ttl: 300, skip: true },
          }),
        }),
      );

      const callArgs = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
      expect(callArgs[1].headers["cf-aig-skip-cache"]).toBe("true");
      expect(callArgs[1].headers["cf-aig-cache-ttl"]).toBeUndefined();
    });

    it("sends service token headers to upstream", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockRes({
          model: "@cf/meta/llama-3.1-8b-instruct-fp8",
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          choices: [{ message: { content: "Hi" } }],
        }),
      );
      globalThis.fetch = mockFetch;

      await fetchApp(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "@cf/meta/llama-3.1-8b-instruct-fp8", prompt: "Hello" }),
        }),
      );

      const callArgs = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
      expect(callArgs[1].headers["CF-Access-Client-Id"]).toBe("fake-access-id");
      expect(callArgs[1].headers["CF-Access-Client-Secret"]).toBe("fake-access-secret");
    });

    it("prefixes model with workers-ai/", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockRes({
          model: "@cf/meta/llama-3.1-8b-instruct-fp8",
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          choices: [{ message: { content: "Hi" } }],
        }),
      );
      globalThis.fetch = mockFetch;

      await fetchApp(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "@cf/meta/llama-3.1-8b-instruct-fp8", prompt: "Hello" }),
        }),
      );

      const callArgs = mockFetch.mock.calls[0] as [string, { body: string }];
      const sentBody = JSON.parse(callArgs[1].body);
      expect(sentBody.model).toBe("workers-ai/@cf/meta/llama-3.1-8b-instruct-fp8");
    });

    it("chat upstream fetch carries an AbortSignal timeout", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockRes({
          model: "@cf/meta/llama-3.1-8b-instruct-fp8",
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          choices: [{ message: { content: "Hi" } }],
        }),
      );
      globalThis.fetch = mockFetch;

      await fetchApp(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "@cf/meta/llama-3.1-8b-instruct-fp8", prompt: "Hello" }),
        }),
      );

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

      await fetchApp(
        new Request("http://localhost/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer fake-token" },
          body: JSON.stringify({
            rateLimit: { enabled: true, limit: 100, interval: 60, technique: "fixed" },
            spendLimit: { enabled: false, budget: 1, window: "1d", scope: "global" },
          }),
        }),
      );

      const putCall = (globalThis.fetch as any).mock.calls.find(
        ([, o]: [unknown, any]) => o?.method === "PUT",
      ) as [string, { signal?: AbortSignal }];
      expect(putCall[1].signal).toBeInstanceOf(AbortSignal);
    });
  });

  // ─── Chat (/demo/api proxy) ───────────────────────────────────────────────

  describe("Chat (/demo/api proxy)", () => {
    it("/demo/api/chat returns upstream response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mockRes(
          {
            model: "@cf/meta/llama-3.1-8b-instruct-fp8",
            usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
            choices: [{ message: { content: "Hello back" } }],
          },
          { headers: { "cf-aig-cache-status": "MISS" } },
        ),
      );

      const res = await fetchApp(
        new Request("http://localhost/demo/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "@cf/meta/llama-3.1-8b-instruct-fp8", prompt: "Hello" }),
        }),
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as { ok: boolean; cacheStatus: string };
      expect(data.ok).toBe(true);
      expect(data.cacheStatus).toBe("MISS");
    });

    it("/demo/api/chat sends service token headers", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockRes({
          model: "@cf/meta/llama-3.1-8b-instruct-fp8",
          usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
          choices: [{ message: { content: "Hi" } }],
        }),
      );
      globalThis.fetch = mockFetch;

      await fetchApp(
        new Request("http://localhost/demo/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "@cf/meta/llama-3.1-8b-instruct-fp8", prompt: "Hello" }),
        }),
      );

      const callArgs = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
      expect(callArgs[1].headers["CF-Access-Client-Id"]).toBe("fake-access-id");
      expect(callArgs[1].headers["CF-Access-Client-Secret"]).toBe("fake-access-secret");
    });

    it("/demo/api/chat applies cache headers", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockRes({
          model: "@cf/meta/llama-3.1-8b-instruct-fp8",
          usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
          choices: [{ message: { content: "Hi" } }],
        }),
      );
      globalThis.fetch = mockFetch;

      await fetchApp(
        new Request("http://localhost/demo/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "@cf/meta/llama-3.1-8b-instruct-fp8",
            prompt: "Hello",
            cache: { ttl: 600, key: "demo-key" },
            metadata: { env: "test" },
          }),
        }),
      );

      const callArgs = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
      expect(callArgs[1].headers["cf-aig-cache-ttl"]).toBe("600");
      expect(callArgs[1].headers["cf-aig-cache-key"]).toBe("demo-key");
      expect(callArgs[1].headers["cf-aig-metadata"]).toBe('{"env":"test"}');
    });
  });

  // ─── Gateway Settings ─────────────────────────────────────────────────────

  describe("Gateway Settings", () => {
    it("POST /api/settings returns error without valid API token", async () => {
      const res = await fetchApp(
        new Request("http://localhost/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer fake-token" },
          body: JSON.stringify({
            rateLimit: { enabled: false, limit: 100, interval: 60, technique: "fixed" },
            spendLimit: { enabled: false, budget: 1, window: "1d", scope: "global" },
          }),
        }),
      );
      expect([500, 502]).toContain(res.status);
    });

    it("POST /demo/api/settings returns error without valid API token", async () => {
      const res = await fetchApp(
        new Request("http://localhost/demo/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer fake-token" },
          body: JSON.stringify({
            rateLimit: { enabled: false, limit: 100, interval: 60, technique: "fixed" },
            spendLimit: { enabled: false, budget: 1, window: "1d", scope: "global" },
          }),
        }),
      );
      expect([500, 502]).toContain(res.status);
    });

    it("reports warnings when spend-limit cleanup fails", async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
        const method = opts?.method ?? "GET";
        if (method === "PUT") {
          return Promise.resolve(mockRes({ result: {}, success: true }));
        }
        if (url.includes("/spend-limits") && method === "GET") {
          return Promise.resolve(
            mockRes({ result: [{ id: "rule-1" }, { id: "rule-2" }], success: true }),
          );
        }
        if (url.includes("/spend-limits") && method === "DELETE") {
          return Promise.resolve(
            mockRes({ success: false, errors: [{ message: "boom" }] }, { status: 500 }),
          );
        }
        return Promise.resolve(mockRes({}));
      });

      const res = await fetchApp(
        new Request("http://localhost/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer fake-token" },
          body: JSON.stringify({
            rateLimit: { enabled: false, limit: 100, interval: 60, technique: "fixed" },
            spendLimit: { enabled: false, budget: 1, window: "1d", scope: "global" },
          }),
        }),
      );
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
          return Promise.resolve(
            mockRes({ result: [{ id: "rule-1" }, { id: "rule-2" }], success: true }),
          );
        }
        if (url.includes("/spend-limits") && method === "DELETE") {
          return Promise.resolve(mockRes({ result: { id: "deleted" }, success: true }));
        }
        return Promise.resolve(mockRes({}));
      });

      const res = await fetchApp(
        new Request("http://localhost/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer fake-token" },
          body: JSON.stringify({
            rateLimit: { enabled: false, limit: 100, interval: 60, technique: "fixed" },
            spendLimit: { enabled: false, budget: 1, window: "1d", scope: "global" },
          }),
        }),
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as { ok: boolean; warnings?: string[] };
      expect(data.ok).toBe(true);
      expect(data.warnings ?? []).toHaveLength(0);
      const deletes = (globalThis.fetch as any).mock.calls.filter(
        ([, o]: [unknown, any]) => o?.method === "DELETE",
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

      const res = await fetchApp(
        new Request("http://localhost/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer fake-token" },
          body: JSON.stringify({
            rateLimit: { enabled: false, limit: 100, interval: 60, technique: "sliding" },
            spendLimit: { enabled: false, budget: 1, window: "1d", scope: "global" },
          }),
        }),
      );
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

      const res = await fetchApp(
        new Request("http://localhost/demo/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer fake-token" },
          body: JSON.stringify({
            rateLimit: { enabled: true, limit: 100, interval: 60, technique: "fixed" },
            spendLimit: { enabled: false, budget: 1, window: "1d", scope: "global" },
          }),
        }),
      );
      expect(res.status).toBe(200);
      expect(putBody.rate_limiting_limit).toBe(100);
      expect(putBody.rate_limiting_technique).toBe("fixed");
    });

    it("includes collect_logs, cache_invalidate_on_update, and cache_ttl (live API requires these — confirmed against the real gateway)", async () => {
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

      await fetchApp(
        new Request("http://localhost/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer fake-token" },
          body: JSON.stringify({
            rateLimit: { enabled: false, limit: 100, interval: 60, technique: "fixed" },
            spendLimit: { enabled: false, budget: 1, window: "1d", scope: "global" },
          }),
        }),
      );
      expect(typeof putBody.collect_logs).toBe("boolean");
      expect(typeof putBody.cache_invalidate_on_update).toBe("boolean");
      expect(typeof putBody.cache_ttl).toBe("number");
    });

    it("preserves an existing DLP policy instead of clobbering it when updating rate limits", async () => {
      let putBody: any;
      const existingDlp = { enabled: true, policies: [{ id: "Policy 1", enabled: true }] };
      globalThis.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
        const method = opts?.method ?? "GET";
        if (method === "PUT") {
          putBody = JSON.parse(opts.body);
          return Promise.resolve(mockRes({ result: {}, success: true }));
        }
        if (url.includes("/spend-limits")) {
          return Promise.resolve(mockRes({ result: [], success: true }));
        }
        return Promise.resolve(mockRes({ result: { dlp: existingDlp }, success: true }));
      });

      await fetchApp(
        new Request("http://localhost/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer fake-token" },
          body: JSON.stringify({
            rateLimit: { enabled: true, limit: 50, interval: 60, technique: "fixed" },
            spendLimit: { enabled: false, budget: 1, window: "1d", scope: "global" },
          }),
        }),
      );
      expect(putBody.dlp).toEqual(existingDlp);
    });

    it("preserves arbitrary unrelated gateway fields via full-config spread (regression: authentication was silently reset to false by an earlier version of this handler)", async () => {
      let putBody: any;
      // A representative slice of the real gateway resource's other fields —
      // none of these are things settingsHandler intentionally manages, but
      // all of them must survive a rate-limit-only update.
      const unrelatedFields = {
        authentication: true,
        log_management: 10000000,
        log_management_strategy: "DELETE_OLDEST",
        workers_ai_billing_mode: "postpaid",
        zdr: false,
        id: "ai-cost-demo",
      };
      globalThis.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
        const method = opts?.method ?? "GET";
        if (method === "PUT") {
          putBody = JSON.parse(opts.body);
          return Promise.resolve(mockRes({ result: {}, success: true }));
        }
        if (url.includes("/spend-limits")) {
          return Promise.resolve(mockRes({ result: [], success: true }));
        }
        return Promise.resolve(mockRes({ result: unrelatedFields, success: true }));
      });

      await fetchApp(
        new Request("http://localhost/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer fake-token" },
          body: JSON.stringify({
            rateLimit: { enabled: true, limit: 75, interval: 30, technique: "sliding" },
            spendLimit: { enabled: false, budget: 1, window: "1d", scope: "global" },
          }),
        }),
      );
      for (const [key, value] of Object.entries(unrelatedFields)) {
        expect(putBody[key]).toEqual(value);
      }
      // And the intentional change still applied on top of the spread
      expect(putBody.rate_limiting_limit).toBe(75);
      expect(putBody.rate_limiting_technique).toBe("sliding");
    });
  });

  // ─── Guardrails ───────────────────────────────────────────────────────────

  describe("Guardrails", () => {
    it("requires admin auth", async () => {
      const res = await fetchApp(
        new Request("http://localhost/api/guardrails", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: true }),
        }),
      );
      expect(res.status).toBe(401);
    });

    it("enabling with no prior config applies the default (FLAG-everywhere) categories", async () => {
      let putBody: any;
      globalThis.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
        const method = opts?.method ?? "GET";
        if (method === "PUT") {
          putBody = JSON.parse(opts.body);
          return Promise.resolve(mockRes({ result: {}, success: true }));
        }
        // GET of current gateway config — no guardrails configured yet
        return Promise.resolve(mockRes({ result: {}, success: true }));
      });

      const res = await fetchApp(
        new Request("http://localhost/api/guardrails", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer fake-token" },
          body: JSON.stringify({ enabled: true }),
        }),
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as { ok: boolean; guardrailsEnabled: boolean };
      expect(data.ok).toBe(true);
      expect(data.guardrailsEnabled).toBe(true);
      expect(putBody.guardrails).toBeDefined();
      expect(putBody.guardrails.prompt.S1).toBe("FLAG");
      expect(putBody.guardrails.response.P1).toBe("FLAG");
    });

    it("enabling when a custom config already exists preserves it instead of overwriting with the default", async () => {
      let putBody: any;
      const existingGuardrails = {
        prompt: { S1: "BLOCK", P1: "BLOCK" },
        response: { S1: "BLOCK", P1: "BLOCK" },
      };
      globalThis.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
        const method = opts?.method ?? "GET";
        if (method === "PUT") {
          putBody = JSON.parse(opts.body);
          return Promise.resolve(mockRes({ result: {}, success: true }));
        }
        return Promise.resolve(
          mockRes({ result: { guardrails: existingGuardrails }, success: true }),
        );
      });

      await fetchApp(
        new Request("http://localhost/api/guardrails", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer fake-token" },
          body: JSON.stringify({ enabled: true }),
        }),
      );
      expect(putBody.guardrails).toEqual(existingGuardrails);
    });

    it("disabling omits the guardrails key entirely (that's how the API clears it)", async () => {
      let putBody: any;
      globalThis.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
        const method = opts?.method ?? "GET";
        if (method === "PUT") {
          putBody = JSON.parse(opts.body);
          return Promise.resolve(mockRes({ result: {}, success: true }));
        }
        return Promise.resolve(mockRes({ result: {}, success: true }));
      });

      const res = await fetchApp(
        new Request("http://localhost/api/guardrails", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer fake-token" },
          body: JSON.stringify({ enabled: false }),
        }),
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as { ok: boolean; guardrailsEnabled: boolean };
      expect(data.guardrailsEnabled).toBe(false);
      expect(putBody).not.toHaveProperty("guardrails");
    });

    it("disabling removes an already-present guardrails config (the spread alone would otherwise preserve it)", async () => {
      let putBody: any;
      globalThis.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
        const method = opts?.method ?? "GET";
        if (method === "PUT") {
          putBody = JSON.parse(opts.body);
          return Promise.resolve(mockRes({ result: {}, success: true }));
        }
        // Current config already HAS guardrails — the spread would carry
        // this over unless enabled:false explicitly deletes it.
        return Promise.resolve(
          mockRes({
            result: { guardrails: { prompt: { S1: "BLOCK" }, response: { S1: "BLOCK" } } },
            success: true,
          }),
        );
      });

      await fetchApp(
        new Request("http://localhost/api/guardrails", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer fake-token" },
          body: JSON.stringify({ enabled: false }),
        }),
      );
      expect(putBody).not.toHaveProperty("guardrails");
    });

    it("preserves unrelated gateway fields (rate limiting, authentication) via the full-config spread", async () => {
      let putBody: any;
      globalThis.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
        const method = opts?.method ?? "GET";
        if (method === "PUT") {
          putBody = JSON.parse(opts.body);
          return Promise.resolve(mockRes({ result: {}, success: true }));
        }
        return Promise.resolve(
          mockRes({
            result: { rate_limiting_limit: 75, rate_limiting_interval: 30, authentication: true },
            success: true,
          }),
        );
      });

      await fetchApp(
        new Request("http://localhost/api/guardrails", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer fake-token" },
          body: JSON.stringify({ enabled: true }),
        }),
      );
      expect(putBody.rate_limiting_limit).toBe(75);
      expect(putBody.rate_limiting_interval).toBe(30);
      expect(putBody.authentication).toBe(true);
    });
  });

  describe("Guardrails activity (gateway-mode lookup)", () => {
    it("requires admin auth", async () => {
      const res = await fetchApp(
        new Request("http://localhost/api/guardrails-activity", { method: "GET" }),
      );
      expect(res.status).toBe(401);
    });

    it("returns llama-guard evaluations within the requested window", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mockRes({
          result: [
            {
              request_type: "llama-guard",
              created_at: new Date().toISOString(),
              duration: 8000,
              tokens_in: 500,
            },
            {
              request_type: "llama-guard",
              created_at: new Date(Date.now() - 60_000).toISOString(), // outside window
              duration: 500,
              tokens_in: 10,
            },
            { request_type: "provider", created_at: new Date().toISOString(), duration: 900 },
          ],
          success: true,
        }),
      );

      const res = await fetchApp(
        new Request(`http://localhost/api/guardrails-activity?since=${Date.now() - 5000}`, {
          headers: { Authorization: "Bearer fake-token" },
        }),
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        ok: boolean;
        guardrails: { evaluations: number; totalMs: number };
      };
      expect(data.ok).toBe(true);
      expect(data.guardrails.evaluations).toBe(1);
      expect(data.guardrails.totalMs).toBe(8000);
    });

    it("defaults to a zero-activity shape when the logs lookup fails", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("logs down"));

      const res = await fetchApp(
        new Request("http://localhost/api/guardrails-activity", {
          headers: { Authorization: "Bearer fake-token" },
        }),
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        ok: boolean;
        guardrails: { evaluations: number };
      };
      expect(data.ok).toBe(true);
      expect(data.guardrails.evaluations).toBe(0);
    });
  });

  // ─── Stats ────────────────────────────────────────────────────────────────

  describe("Stats", () => {
    it("GET /api/stats returns error without valid API token", async () => {
      const res = await fetchApp(
        new Request("http://localhost/api/stats", {
          headers: { Authorization: "Bearer fake-token" },
        }),
      );
      expect([200, 500]).toContain(res.status);
    });

    it("GET /demo/api/stats returns error without valid API token", async () => {
      const res = await fetchApp(
        new Request("http://localhost/demo/api/stats", {
          headers: { Authorization: "Bearer fake-token" },
        }),
      );
      expect([200, 500]).toContain(res.status);
    });

    it("returns aggregated requests, tokens, and cost from GraphQL", async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/ai-gateway/gateways/")) {
          return Promise.resolve(
            mockRes({
              result: {
                id: "demo-gateway",
                cache_ttl: 0,
                rate_limiting_limit: 50,
                rate_limiting_interval: 60,
              },
              success: true,
            }),
          );
        }
        if (url.includes("/graphql")) {
          return Promise.resolve(
            mockRes({
              data: {
                viewer: {
                  accounts: [
                    {
                      aiGatewayRequestsAdaptiveGroups: [
                        {
                          count: 5,
                          sum: { tokensIn: 220, tokensOut: 217, cost: 13.05 },
                          dimensions: {
                            model: "@cf/meta/llama-3.1-8b-instruct-fp8",
                            gateway: "demo-gateway",
                          },
                        },
                        {
                          count: 11,
                          sum: { tokensIn: 3397, tokensOut: 33, cost: 0.0016 },
                          dimensions: {
                            model: "@cf/meta/llama-guard-3-8b",
                            gateway: "demo-gateway",
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            }),
          );
        }
        return Promise.resolve(mockRes({}));
      });

      const res = await fetchApp(
        new Request("http://localhost/api/stats", {
          headers: { Authorization: "Bearer fake-token" },
        }),
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        ok: boolean;
        requests: number;
        tokens: number;
        cost: string;
      };
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
          return Promise.resolve(
            mockRes({
              data: { viewer: { accounts: [{ aiGatewayRequestsAdaptiveGroups: [] }] } },
            }),
          );
        }
        return Promise.resolve(mockRes({}));
      });

      await fetchApp(
        new Request("http://localhost/api/stats", {
          headers: { Authorization: "Bearer fake-token" },
        }),
      );

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
          return Promise.resolve(
            mockRes({
              data: { viewer: { accounts: [{ aiGatewayRequestsAdaptiveGroups: [] }] } },
            }),
          );
        }
        return Promise.resolve(mockRes({}));
      });

      const res = await fetchApp(
        new Request("http://localhost/api/stats", {
          headers: { Authorization: "Bearer fake-token" },
        }),
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        ok: boolean;
        requests: string;
        tokens: string;
        cost: string;
      };
      expect(data.ok).toBe(true);
      expect(data.requests).toBe("-");
      expect(data.tokens).toBe("-");
      expect(data.cost).toBe("-");
    });

    it("returns gateway config fields (cacheTTL, rlLimit, rlInterval, rlTechnique) for form pre-fill", async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/ai-gateway/gateways/")) {
          return Promise.resolve(
            mockRes({
              result: {
                id: "demo-gateway",
                cache_ttl: 300,
                rate_limiting_limit: 100,
                rate_limiting_interval: 60,
                rate_limiting_technique: "sliding",
              },
              success: true,
            }),
          );
        }
        if (url.includes("/graphql")) {
          return Promise.resolve(
            mockRes({
              data: { viewer: { accounts: [{ aiGatewayRequestsAdaptiveGroups: [] }] } },
            }),
          );
        }
        return Promise.resolve(mockRes({}));
      });

      const res = await fetchApp(
        new Request("http://localhost/api/stats", {
          headers: { Authorization: "Bearer fake-token" },
        }),
      );
      const data = (await res.json()) as {
        cacheTTL: number;
        rlLimit: number;
        rlInterval: number;
        rlTechnique: string;
      };
      expect(data.cacheTTL).toBe(300);
      expect(data.rlLimit).toBe(100);
      expect(data.rlInterval).toBe(60);
      // Regression: the Gateway Settings form is pre-filled from /api/stats.
      // When this field was missing, a fresh page's Apply button sent the
      // form's hardcoded defaults and silently disabled rate limiting
      // (rate_limiting_limit: 0) — confirmed live 2026-10-28.
      expect(data.rlTechnique).toBe("sliding");
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
          return Promise.resolve(
            mockRes({
              data: { viewer: { accounts: [{ aiGatewayRequestsAdaptiveGroups: [] }] } },
            }),
          );
        }
        return Promise.resolve(mockRes({}));
      });

      const res = await fetchApp(
        new Request("http://localhost/api/stats", {
          headers: { Authorization: "Bearer fake-token" },
        }),
      );
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
          return Promise.resolve(
            mockRes({
              data: { viewer: { accounts: [{ aiGatewayRequestsAdaptiveGroups: [] }] } },
            }),
          );
        }
        return Promise.resolve(mockRes({}));
      });

      const res = await fetchApp(
        new Request("http://localhost/demo/api/stats", {
          headers: { Authorization: "Bearer fake-token" },
        }),
      );
      const data = (await res.json()) as { ok: boolean; spendLimit: string };
      expect(data.spendLimit).toBe("Off");
    });

    it("guardrailsEnabled is true when the gateway config has guardrails categories set", async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/spend-limits")) {
          return Promise.resolve(mockRes({ result: [], success: true }));
        }
        if (url.includes("/ai-gateway/gateways/")) {
          return Promise.resolve(
            mockRes({
              result: { guardrails: { prompt: { S1: "FLAG" }, response: { S1: "FLAG" } } },
              success: true,
            }),
          );
        }
        return Promise.resolve(mockRes({}));
      });

      const res = await fetchApp(
        new Request("http://localhost/api/stats", {
          headers: { Authorization: "Bearer fake-token" },
        }),
      );
      const data = (await res.json()) as { guardrailsEnabled: boolean };
      expect(data.guardrailsEnabled).toBe(true);
    });

    it("guardrailsEnabled is false when the gateway has no guardrails configured", async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/spend-limits")) {
          return Promise.resolve(mockRes({ result: [], success: true }));
        }
        if (url.includes("/ai-gateway/gateways/")) {
          return Promise.resolve(mockRes({ result: {}, success: true }));
        }
        return Promise.resolve(mockRes({}));
      });

      const res = await fetchApp(
        new Request("http://localhost/api/stats", {
          headers: { Authorization: "Bearer fake-token" },
        }),
      );
      const data = (await res.json()) as { guardrailsEnabled: boolean };
      expect(data.guardrailsEnabled).toBe(false);
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
          return Promise.resolve(
            mockRes({
              data: { viewer: { accounts: [{ aiGatewayRequestsAdaptiveGroups: [] }] } },
            }),
          );
        }
        return Promise.resolve(mockRes({}));
      });

      const res = await fetchApp(
        new Request("http://localhost/api/stats", {
          headers: { Authorization: "Bearer fake-token" },
        }),
      );
      const data = (await res.json()) as { ok: boolean; rateLimited?: unknown };
      expect(data.ok).toBe(true);
      expect(data).not.toHaveProperty("rateLimited");
    });

    it("GET /api/stats returns 500 when upstream fetch rejects", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("upstream down"));
      const res = await fetchApp(
        new Request("http://localhost/api/stats", {
          headers: { Authorization: "Bearer fake-token" },
        }),
      );
      expect(res.status).toBe(500);
      const data = (await res.json()) as { ok: boolean; error: string };
      expect(data.ok).toBe(false);
      expect(data.error).toContain("upstream down");
    });

    it("GET /demo/api/stats returns 500 when upstream fetch rejects", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("upstream down"));
      const res = await fetchApp(
        new Request("http://localhost/demo/api/stats", {
          headers: { Authorization: "Bearer fake-token" },
        }),
      );
      expect(res.status).toBe(500);
    });

    it("/demo/api/stats returns same data", async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/ai-gateway/gateways/")) {
          return Promise.resolve(mockRes({ result: { cache_ttl: 0 }, success: true }));
        }
        if (url.includes("/graphql")) {
          return Promise.resolve(
            mockRes({
              data: {
                viewer: {
                  accounts: [
                    {
                      aiGatewayRequestsAdaptiveGroups: [
                        {
                          count: 3,
                          sum: { tokensIn: 100, tokensOut: 50, cost: 1.5 },
                          dimensions: {},
                        },
                      ],
                    },
                  ],
                },
              },
            }),
          );
        }
        return Promise.resolve(mockRes({}));
      });

      const res = await fetchApp(
        new Request("http://localhost/demo/api/stats", {
          headers: { Authorization: "Bearer fake-token" },
        }),
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        ok: boolean;
        requests: number;
        tokens: number;
        cost: string;
      };
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
      const res = await fetchApp(
        new Request("http://localhost/demo/api/bootstrap", {
          headers: { Authorization: "Bearer fake-token" },
        }),
      );
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
      const res = await fetchApp(
        new Request("http://localhost/api/bootstrap", {
          headers: { Authorization: "Bearer wrong-token" },
        }),
      );
      expect(res.status).toBe(401);
    });

    it("GET /api/bootstrap returns gateway with correct token", async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(mockRes({ result: { id: "demo-gateway" }, success: true }));
      const res = await fetchApp(
        new Request("http://localhost/api/bootstrap", {
          headers: { Authorization: "Bearer fake-token" },
        }),
      );
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
        return Promise.resolve({
          ok: false,
          status: 404,
          text: async () => "not found",
          json: async () => ({}),
        } as unknown as Response);
      });
      globalThis.fetch = mockFetch;

      const res = await fetchApp(
        new Request("http://localhost/demo/api/bootstrap", {
          headers: { Authorization: "Bearer fake-token" },
        }),
      );
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

  // ─── Admin gate (requireAdmin) ─────────────────────────────────────────────
  // These endpoints were previously reachable with zero auth on the public
  // *.workers.dev URL — see AGENTS.md Known Limitations. The 401-without-auth
  // cases for /bootstrap already existed above; these cover the three routes
  // that were newly gated (settings, costs write, stats), plus the Access-JWT
  // path and the routes that must stay open by design.

  describe("Admin gate (requireAdmin)", () => {
    const settingsBody = JSON.stringify({
      rateLimit: { enabled: false, limit: 100, interval: 60, technique: "fixed" },
      spendLimit: { enabled: false, budget: 1, window: "1d", scope: "global" },
    });

    it("POST /api/settings returns 401 with no auth at all", async () => {
      const res = await fetchApp(
        new Request("http://localhost/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: settingsBody,
        }),
      );
      expect(res.status).toBe(401);
    });

    it("POST /api/costs returns 401 with no auth at all", async () => {
      const res = await fetchApp(
        new Request("http://localhost/api/costs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ per_token_in: 0.001, per_token_out: 0.002 }),
        }),
      );
      expect(res.status).toBe(401);
    });

    it("GET /api/stats returns 401 with no auth at all", async () => {
      const res = await fetchApp(new Request("http://localhost/api/stats"));
      expect(res.status).toBe(401);
    });

    it("hitting /demo/api/stats on the unprotected host with a bogus Access JWT still returns 401", async () => {
      // Regression test for the actual bug: path alone ("/demo/...") must
      // never be treated as proof of Access. A garbage JWT header must fail
      // cryptographic verification, not be trusted because of the path.
      const res = await fetchApp(
        new Request("http://localhost/demo/api/stats", {
          headers: { "Cf-Access-Jwt-Assertion": "not-a-real-jwt" },
        }),
      );
      expect(res.status).toBe(401);
    });

    it("a verified Access JWT grants access without the admin bearer token", async () => {
      mockJwtVerify.mockResolvedValue({ payload: { email: "jason@sherron.com" } });
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(mockRes({ result: { id: "demo-gateway" }, success: true }));

      const res = await fetchApp(
        new Request("http://localhost/api/stats", {
          headers: { "Cf-Access-Jwt-Assertion": "a.valid.jwt" },
        }),
      );
      expect(res.status).toBe(200);
    });

    it("an invalid Access JWT (failed verification) is rejected even though the header is present", async () => {
      mockJwtVerify.mockRejectedValue(new Error("signature verification failed"));
      const res = await fetchApp(
        new Request("http://localhost/api/settings", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Cf-Access-Jwt-Assertion": "a.forged.jwt",
          },
          body: settingsBody,
        }),
      );
      expect(res.status).toBe(401);
    });

    it("the admin bearer token still works even when no Access JWT is present", async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(mockRes({ result: { id: "demo-gateway" }, success: true }));
      const res = await fetchApp(
        new Request("http://localhost/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer fake-token" },
          body: settingsBody,
        }),
      );
      expect(res.status).toBe(200);
    });

    it("GET /api/costs (reading your own saved costs) stays open by design — no auth required", async () => {
      const res = await fetchApp(new Request("http://localhost/api/costs"));
      expect(res.status).toBe(200);
    });

    it("POST /api/chat (the service-identity demo traffic) stays open by design — no auth required", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mockRes({
          model: "@cf/meta/llama-3.1-8b-instruct-fp8",
          usage: { prompt_tokens: 1, completion_tokens: 1 },
          choices: [{ message: { content: "hi" } }],
        }),
      );
      const res = await fetchApp(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "@cf/meta/llama-3.1-8b-instruct-fp8", prompt: "hi" }),
        }),
      );
      expect(res.status).toBe(200);
    });
  });

  // ─── Chat input validation ─────────────────────────────────────────────────

  describe("Chat input validation", () => {
    it("rejects a missing model", async () => {
      const res = await fetchApp(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: "hi" }),
        }),
      );
      expect(res.status).toBe(400);
    });

    it("rejects an empty prompt", async () => {
      const res = await fetchApp(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "@cf/meta/llama-3.1-8b-instruct-fp8", prompt: "" }),
        }),
      );
      expect(res.status).toBe(400);
    });

    it("rejects a prompt over the length cap", async () => {
      const res = await fetchApp(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "@cf/meta/llama-3.1-8b-instruct-fp8",
            prompt: "a".repeat(4001),
          }),
        }),
      );
      expect(res.status).toBe(400);
    });

    it("rejects a cache key containing control characters (CR/LF)", async () => {
      const res = await fetchApp(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "@cf/meta/llama-3.1-8b-instruct-fp8",
            prompt: "hi",
            cache: { ttl: 60, key: "evil\r\nX-Injected: true" },
          }),
        }),
      );
      expect(res.status).toBe(400);
    });

    it("rejects a cache key over the length cap", async () => {
      const res = await fetchApp(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "@cf/meta/llama-3.1-8b-instruct-fp8",
            prompt: "hi",
            cache: { ttl: 60, key: "k".repeat(513) },
          }),
        }),
      );
      expect(res.status).toBe(400);
    });

    it("rejects a metadata string value over the length cap", async () => {
      const res = await fetchApp(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "@cf/meta/llama-3.1-8b-instruct-fp8",
            prompt: "hi",
            metadata: { note: "x".repeat(201) },
          }),
        }),
      );
      expect(res.status).toBe(400);
    });

    it("accepts a well-formed request with cache and metadata at the limits", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        mockRes({
          model: "@cf/meta/llama-3.1-8b-instruct-fp8",
          usage: { prompt_tokens: 1, completion_tokens: 1 },
          choices: [{ message: { content: "hi" } }],
        }),
      );
      const res = await fetchApp(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "@cf/meta/llama-3.1-8b-instruct-fp8",
            prompt: "a".repeat(4000),
            cache: { ttl: 60, key: "k".repeat(512) },
            metadata: { note: "x".repeat(200) },
          }),
        }),
      );
      expect(res.status).toBe(200);
    });
  });

  // ─── CSRF protection ────────────────────────────────────────────────────────

  describe("CSRF protection", () => {
    it("blocks a form-encoded cross-site POST to an admin endpoint", async () => {
      // Hono's csrf() middleware only inspects form-like content types (the
      // ones a browser can submit cross-site without a CORS preflight) — a
      // mismatched Origin with one of those content types is the forgery
      // pattern it exists to catch.
      const res = await fetchApp(
        new Request("http://localhost/api/settings", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: "Bearer fake-token",
            Origin: "https://evil.example.com",
          },
          body: "rateLimit=1",
        }),
      );
      expect(res.status).toBe(403);
    });

    it("does not block a same-origin form-encoded POST", async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(mockRes({ result: { id: "demo-gateway" }, success: true }));
      const res = await fetchApp(
        new Request("http://localhost/api/settings", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: "Bearer fake-token",
            Origin: "http://localhost",
          },
          body: "rateLimit=1",
        }),
      );
      // Rejected further downstream for not being valid JSON, not by CSRF.
      expect(res.status).not.toBe(403);
    });

    it("does not block normal JSON POSTs with no Origin header (scripts/curl)", async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(mockRes({ result: { id: "demo-gateway" }, success: true }));
      const res = await fetchApp(
        new Request("http://localhost/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer fake-token" },
          body: JSON.stringify({
            rateLimit: { enabled: false, limit: 100, interval: 60, technique: "fixed" },
            spendLimit: { enabled: false, budget: 1, window: "1d", scope: "global" },
          }),
        }),
      );
      expect(res.status).toBe(200);
    });
  });
});
