import { Hono } from "hono";
import type { Context } from "hono";
import { renderHtml } from "./ui";
import { cfApiFetch } from "./api/cloudflare";

type Env = {
  SETTINGS: KVNamespace;
  CLOUDFLARE_API_TOKEN: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  GATEWAY_NAME: string;
  GATEWAY_ID: string;
  CF_ACCESS_CLIENT_ID: string;
  CF_ACCESS_CLIENT_SECRET: string;
};

const app = new Hono<{ Bindings: Env }>();

type AppContext = Context<{ Bindings: Env }>;

// ─── HTML Client ─────────────────────────────────────────────────────────────

app.get("/", (c) => serveHtml(c));
app.get("/demo", (c) => serveHtml(c));
app.get("/demo/", (c) => serveHtml(c));

app.get("/demo/logout", (c) => {
  const logoutUrl = `https://${c.env.GATEWAY_NAME}/cdn-cgi/access/logout`;
  return c.redirect(logoutUrl);
});

function serveHtml(c: AppContext) {
  const isGateway = c.req.path.startsWith("/demo");
  const accessLogoutUrl = `https://${c.env.GATEWAY_NAME}/cdn-cgi/access/logout`;
  return c.html(renderHtml({
    gatewayName: c.env.GATEWAY_NAME,
    isGateway,
    accessLogoutUrl,
  }));
}

// ─── API Routes (mounted under both /api and /demo/api) ────────────────────────

type ApiHandler = (c: AppContext) => Promise<Response> | Response;

function dualRoute(method: "get" | "post", path: string, handler: ApiHandler) {
  (app as any)[method](`/api${path}`, handler);
  (app as any)[method](`/demo/api${path}`, handler);
}

const isValidCost = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;

const safeKvParse = <T>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const validateMetadata = (metadata: Record<string, unknown>): string | null => {
  const keys = Object.keys(metadata);
  if (keys.length > 5) return "metadata supports at most 5 key-value pairs";
  for (const key of keys) {
    if (key.startsWith("cf.")) return `metadata key "${key}" uses reserved cf. prefix`;
    const value = metadata[key];
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      return `metadata value for "${key}" must be a string, number, or boolean`;
    }
  }
  return null;
};

// ─── API: Chat ───────────────────────────────────────────────────────────────

const chatHandler = async (c: AppContext) => {
  const env = c.env;
  const body = await c.req.json() as {
    model: string;
    prompt: string;
    cache?: { ttl: number; key?: string; skip?: boolean };
    metadata?: Record<string, string | number | boolean>;
  };
  const { model, prompt, cache, metadata } = body;

  if (metadata) {
    const metaError = validateMetadata(metadata);
    if (metaError) return c.json({ ok: false, error: metaError }, 400);
  }

  // Read custom cost headers (set by client) or fall back to KV
  const hdrIn = c.req.header("x-custom-cost-in");
  const hdrOut = c.req.header("x-custom-cost-out");
  let customCost: { per_token_in: number; per_token_out: number } | undefined;

  if (hdrIn && hdrOut) {
    customCost = { per_token_in: parseFloat(hdrIn), per_token_out: parseFloat(hdrOut) };
  } else {
    const kv = safeKvParse<{ per_token_in: number; per_token_out: number }>(
      await env.SETTINGS.get("custom_costs")
    );
    if (kv && isValidCost(kv.per_token_in) && isValidCost(kv.per_token_out)) {
      customCost = { per_token_in: kv.per_token_in, per_token_out: kv.per_token_out };
    }
  }

  // Cloudflare REST API for Workers AI through AI Gateway custom domain
  // Service token auth for Identity-Aware Gateway (Cloudflare Access)
  const upstreamUrl = `https://${env.GATEWAY_NAME}/compat/chat/completions`;
  const upstreamHeaders: Record<string, string> = {
    "Authorization": `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
    "Content-Type": "application/json",
    "CF-Access-Client-Id": env.CF_ACCESS_CLIENT_ID,
    "CF-Access-Client-Secret": env.CF_ACCESS_CLIENT_SECRET,
  };
  const upstreamBody = {
    model: `workers-ai/${model}`,
    messages: [{ role: "user", content: prompt }],
  };

  // Add custom cost header if configured
  if (customCost) {
    upstreamHeaders["cf-aig-custom-cost"] = JSON.stringify(customCost);
  }

  // Add caching headers
  if (cache) {
    if (cache.skip) {
      upstreamHeaders["cf-aig-skip-cache"] = "true";
    } else {
      upstreamHeaders["cf-aig-cache-ttl"] = String(cache.ttl);
      if (cache.key) upstreamHeaders["cf-aig-cache-key"] = cache.key;
    }
  }

  // Add custom metadata header
  if (metadata && Object.keys(metadata).length > 0) {
    upstreamHeaders["cf-aig-metadata"] = JSON.stringify(metadata);
  }

  try {
    // 30s — LLM inference can be slow (large models, cold starts); 15s kills valid requests
    const res = await fetch(upstreamUrl, {
      method: "POST",
      headers: upstreamHeaders,
      body: JSON.stringify(upstreamBody),
      signal: AbortSignal.timeout(30000),
    });

    const cacheStatus = res.headers.get("cf-aig-cache-status") || undefined;
    const rawText = await res.text();
    let data: any;
    try { data = JSON.parse(rawText); } catch { data = { _raw: rawText }; }

    // Calculate estimated cost for display
    let estimatedCost: number | undefined;
    if (data.usage && customCost) {
      const inTokens = data.usage.prompt_tokens ?? 0;
      const outTokens = data.usage.completion_tokens ?? 0;
      estimatedCost = inTokens * customCost.per_token_in + outTokens * customCost.per_token_out;
    }

    return c.json({
      ok: res.ok,
      status: res.status,
      model: data.model,
      usage: data.usage,
      estimatedCost,
      cacheStatus,
      choices: data.choices,
      error: data.error?.message || data.errors?.[0]?.message,
    }, res.status as any);
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
};
dualRoute("post", "/chat", chatHandler);

// ─── API: Custom Costs ───────────────────────────────────────────────────────

const costsGetHandler = async (c: AppContext) => {
  const kv = safeKvParse<Record<string, number>>(await c.env.SETTINGS.get("custom_costs"));
  return c.json({ ok: true, costs: kv ?? null });
};
dualRoute("get", "/costs", costsGetHandler);

const costsPostHandler = async (c: AppContext) => {
  const body = await c.req.json() as { per_token_in: number; per_token_out: number };
  if (!isValidCost(body?.per_token_in) || !isValidCost(body?.per_token_out)) {
    return c.json({ ok: false, error: "per_token_in and per_token_out must be non-negative finite numbers" }, 400);
  }
  await c.env.SETTINGS.put("custom_costs", JSON.stringify({
    per_token_in: body.per_token_in,
    per_token_out: body.per_token_out,
  }));
  return c.json({ ok: true });
};
dualRoute("post", "/costs", costsPostHandler);

// ─── API: Gateway Settings ────────────────────────────────────────────────────

const settingsHandler = async (c: AppContext) => {
  const env = c.env;
  const body = await c.req.json() as {
    rateLimit: { enabled: boolean; limit: number; interval: number; technique: string };
    spendLimit: { enabled: boolean; budget: number; window: string; scope: string };
  };

  // 1. Update gateway rate limiting
  const gwUpdateRes = await cfApiFetch(
    env,
    `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai-gateway/gateways/${env.GATEWAY_ID}`,
    {
      method: "PUT",
      body: JSON.stringify({
        rate_limiting_limit: body.rateLimit.enabled ? body.rateLimit.limit : 0,
        rate_limiting_interval: body.rateLimit.enabled ? body.rateLimit.interval : 0,
        ...(body.rateLimit.enabled ? { rate_limiting_technique: body.rateLimit.technique } : {}),
      }),
    }
  );

  if (!gwUpdateRes.ok) {
    const errData = await gwUpdateRes.json<any>();
    return c.json({ ok: false, error: errData.errors?.[0]?.message || "Failed to update gateway" }, 502);
  }

  // 2. Handle spend limits — clear existing rules first
  const warnings: string[] = [];
  try {
    const listRes = await cfApiFetch(
      env,
      `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai-gateway/gateways/${env.GATEWAY_ID}/spend-limits`
    );
    const list = await listRes.json<any>();
    const rules: Array<{ id: string }> = list.result ?? [];
    const deleteResults = await Promise.all(rules.map(async (rule) => {
      try {
        const delRes = await cfApiFetch(
          env,
          `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai-gateway/gateways/${env.GATEWAY_ID}/spend-limits/${rule.id}`,
          { method: "DELETE" }
        );
        if (!delRes.ok) return `Failed to delete spend limit rule ${rule.id} (HTTP ${delRes.status})`;
        return null;
      } catch (e: any) {
        return `Failed to delete spend limit rule ${rule.id}: ${e.message}`;
      }
    }));
    for (const w of deleteResults) if (w) warnings.push(w);
  } catch (e: any) {
    warnings.push(`Spend limit cleanup failed: ${e.message}`);
  }

  await env.SETTINGS.put("gateway_settings", JSON.stringify(body));

  if (!body.spendLimit.enabled) {
    return c.json({ ok: true, note: "Rate limiting updated. Spend limits disabled.", warnings });
  }

  // Create a spend limit rule
  const dimensions: any = {};
  if (body.spendLimit.scope === "model") {
    dimensions.model = { mode: "split_by_value" };
  } else if (body.spendLimit.scope === "provider") {
    dimensions.provider = { mode: "split_by_value" };
  }

  const payload = {
    budget: body.spendLimit.budget,
    window: body.spendLimit.window,
    dimensions,
  };

  try {
    const res = await cfApiFetch(
      env,
      `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai-gateway/gateways/${env.GATEWAY_ID}/spend-limits`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
    const data = await res.json<any>();
    if (!res.ok) {
      return c.json({ ok: false, error: data.errors?.[0]?.message || "API error" }, 502);
    }
    return c.json({ ok: true, ruleId: data.result?.id, warnings });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
};
dualRoute("post", "/settings", settingsHandler);

// ─── API: Stats ──────────────────────────────────────────────────────────────

const statsHandler = async (c: AppContext) => {
  const env = c.env;
  try {
    // Fetch config for live settings
    const configRes = await cfApiFetch(
      env,
      `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai-gateway/gateways/${env.GATEWAY_ID}`
    );
    const configData = await configRes.json<any>();
    const gw = configRes.ok ? configData.result : {};

    // Fetch spend-limit rules to determine live spend limit state
    let spendLimitOn = false;
    try {
      const rulesRes = await cfApiFetch(
        env,
        `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai-gateway/gateways/${env.GATEWAY_ID}/spend-limits`
      );
      const rulesData = await rulesRes.json<any>();
      spendLimitOn = Array.isArray(rulesData.result) && rulesData.result.length > 0;
    } catch {}

    // Fetch analytics via GraphQL
    const now = new Date();
    const start = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(); // last 24h
    const graphqlRes = await cfApiFetch(env, "/graphql", {
      method: "POST",
      body: JSON.stringify({
        query: `
          query GetAIGatewayAnalytics($accountTag: String!, $gateway: String!, $start: Time!, $end: Time!) {
            viewer {
              accounts(filter: { accountTag: $accountTag }) {
                aiGatewayRequestsAdaptiveGroups(
                  limit: 1000
                  filter: { datetimeHour_geq: $start, datetimeHour_leq: $end, gateway: $gateway }
                  orderBy: [datetimeMinute_ASC]
                ) {
                  count
                  sum {
                    tokensIn
                    tokensOut
                    cost
                  }
                  dimensions {
                    model
                    provider
                    gateway
                    ts: datetimeMinute
                  }
                }
              }
            }
          }
        `,
        variables: {
          accountTag: env.CLOUDFLARE_ACCOUNT_ID,
          gateway: env.GATEWAY_ID,
          start,
          end: now.toISOString(),
        },
      }),
    });

    let requests = 0;
    let tokens = 0;
    let cost = 0;

    if (graphqlRes.ok) {
      const gqData = await graphqlRes.json<any>();
      const groups = gqData?.data?.viewer?.accounts?.[0]?.aiGatewayRequestsAdaptiveGroups || [];
      for (const g of groups) {
        requests += g.count ?? 0;
        tokens += (g.sum?.tokensIn ?? 0) + (g.sum?.tokensOut ?? 0);
        cost += g.sum?.cost ?? 0;
      }
    }

    return c.json({
      ok: true,
      requests: requests || "-",
      tokens: tokens || "-",
      cost: cost ? `$${cost.toFixed(4)}` : "-",
      cacheTTL: gw.cache_ttl ?? 0,
      rlLimit: gw.rate_limiting_limit ?? 0,
      rlInterval: gw.rate_limiting_interval ?? 0,
      spendLimit: spendLimitOn ? "On" : "Off",
      note: "Stats from Cloudflare AI Gateway Analytics.",
    });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
};
dualRoute("get", "/stats", statsHandler);

// ─── Bootstrap: create gateway if missing (admin-gated) ──────────────────────

const bootstrapHandler = async (c: AppContext) => {
  const env = c.env;
  const auth = c.req.header("Authorization");
  if (auth !== `Bearer ${env.CLOUDFLARE_API_TOKEN}`) {
    return c.json({ ok: false, error: "Unauthorized" }, 401);
  }
  try {
    const res = await cfApiFetch(
      env,
      `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai-gateway/gateways/${env.GATEWAY_ID}`
    );
    if (res.status === 404) {
      const create = await cfApiFetch(
        env,
        `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai-gateway`,
        {
          method: "POST",
          body: JSON.stringify({ id: env.GATEWAY_ID, name: env.GATEWAY_ID }),
        }
      );
      const data = await create.json<any>();
      return c.json({ ok: create.ok, created: true, gateway: data.result, error: data.errors?.[0]?.message });
    }
    const data = await res.json<any>();
    return c.json({ ok: true, created: false, gateway: data.result });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
};
dualRoute("get", "/bootstrap", bootstrapHandler);

export default app;
