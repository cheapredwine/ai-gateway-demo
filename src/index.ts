import { Hono } from "hono";
import { cors } from "hono/cors";

type Env = {
  SETTINGS: KVNamespace;
  CLOUDFLARE_API_TOKEN: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  GATEWAY_NAME: string;
};

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

// ─── HTML Client ─────────────────────────────────────────────────────────────

app.get("/", (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Gateway Cost Demo</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      min-height: 100vh;
      padding: 2rem;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { font-size: 2rem; margin-bottom: 0.5rem; color: #f8fafc; }
    .subtitle { color: #94a3b8; margin-bottom: 2rem; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
    @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 1.5rem;
    }
    .card h2 { font-size: 1.1rem; margin-bottom: 1rem; color: #f8fafc; display: flex; align-items: center; gap: 0.5rem; }
    .card h2 span { font-size: 1.3rem; }
    label { display: block; font-size: 0.85rem; color: #94a3b8; margin: 0.75rem 0 0.25rem; }
    input, select, textarea {
      width: 100%;
      background: #0f172a;
      border: 1px solid #475569;
      border-radius: 6px;
      padding: 0.6rem 0.75rem;
      color: #e2e8f0;
      font-size: 0.9rem;
    }
    input:focus, select:focus, textarea:focus { outline: none; border-color: #3b82f6; }
    button {
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 6px;
      padding: 0.6rem 1.2rem;
      font-size: 0.9rem;
      cursor: pointer;
      margin-top: 1rem;
      font-weight: 500;
    }
    button:hover { background: #2563eb; }
    button.secondary { background: #475569; }
    button.secondary:hover { background: #334155; }
    button.danger { background: #ef4444; }
    button.danger:hover { background: #dc2626; }
    .row { display: flex; gap: 0.5rem; }
    .row input, .row select { flex: 1; }
    .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-top: 0.5rem; }
    .stat-box {
      background: #0f172a;
      border-radius: 8px;
      padding: 1rem;
      text-align: center;
    }
    .stat-value { font-size: 1.5rem; font-weight: 600; color: #3b82f6; }
    .stat-label { font-size: 0.75rem; color: #64748b; margin-top: 0.25rem; }
    .chat-area {
      min-height: 200px;
      max-height: 300px;
      overflow-y: auto;
      background: #0f172a;
      border-radius: 8px;
      padding: 1rem;
      margin-top: 0.5rem;
      font-family: monospace;
      font-size: 0.85rem;
      white-space: pre-wrap;
      color: #cbd5e1;
    }
    .success { color: #22c55e; }
    .error { color: #ef4444; }
    .warning { color: #f59e0b; }
    .info { color: #3b82f6; }
    .muted { color: #64748b; font-size: 0.8rem; }
    .cost-inputs { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
    .toggle { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.75rem; }
    .toggle input { width: auto; }
    .message { padding: 0.5rem; border-radius: 4px; margin-top: 0.5rem; font-size: 0.85rem; }
    .message.success { background: rgba(34,197,94,0.1); }
    .message.error { background: rgba(239,68,68,0.1); }
    .spinner {
      display: inline-block; width: 14px; height: 14px;
      border: 2px solid rgba(255,255,255,0.3); border-top-color: white;
      border-radius: 50%; animation: spin 0.8s linear infinite;
      margin-left: 0.5rem; vertical-align: middle;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <h1>AI Gateway Cost Control Demo</h1>
    <p class="subtitle">Gateway: <strong>Demo-Cost-Gateway</strong> | Provider: <strong>Cloudflare Workers AI</strong></p>

    <div class="grid">
      <!-- Chat / Traffic Generator -->
      <div class="card">
        <h2><span>💬</span> Traffic Generator</h2>

        <label>Workers AI Model</label>
        <select id="model" onchange="onModelChange()">
          <optgroup label="Meta Llama">
            <option value="@cf/meta/llama-3.1-8b-instruct">Llama 3.1 8B Instruct</option>
            <option value="@cf/meta/llama-3.3-70b-instruct-fp8-fast">Llama 3.3 70B Instruct (Fast)</option>
            <option value="@cf/meta/llama-2-7b-chat-int8">Llama 2 7B Chat</option>
          </optgroup>
          <optgroup label="Mistral">
            <option value="@cf/mistral/mistral-7b-instruct-v0.1">Mistral 7B Instruct</option>
            <option value="@cf/mistral/mistral-7b-instruct-v0.2-lora">Mistral 7B Instruct v0.2</option>
          </optgroup>
          <optgroup label="DeepSeek">
            <option value="@cf/deepseek-ai/deepseek-r1-distill-qwen-32b">DeepSeek R1 Distill Qwen 32B</option>
          </optgroup>
          <optgroup label="Google">
            <option value="@cf/google/gemma-2b-it-lora">Gemma 2B IT</option>
            <option value="@cf/google/gemma-7b-it-lora">Gemma 7B IT</option>
          </optgroup>
          <optgroup label="Qwen">
            <option value="@cf/qwen/qwen1.5-0.5b-chat">Qwen1.5 0.5B Chat</option>
            <option value="@cf/qwen/qwen1.5-1.8b-chat">Qwen1.5 1.8B Chat</option>
            <option value="@cf/qwen/qwen1.5-7b-chat-awq">Qwen1.5 7B Chat</option>
            <option value="@cf/qwen/qwen1.5-14b-chat-awq">Qwen1.5 14B Chat</option>
          </optgroup>
          <optgroup label="Other">
            <option value="@cf/microsoft/phi-2">Microsoft Phi-2</option>
            <option value="@cf/openchat/openchat-3.5-0106">OpenChat 3.5</option>
            <option value="@cf/tinyllama/tinyllama-1.1b-chat-v1.0">TinyLlama 1.1B</option>
            <option value="@cf/moonshotai/kimi-k2.6">Moonshot Kimi K2.6</option>
            <option value="custom">Custom model...</option>
          </optgroup>
        </select>

        <div id="customModelInput" style="display:none;margin-top:0.75rem">
          <label>Custom model name</label>
          <input type="text" id="customModel" placeholder="@cf/meta/llama-3.1-8b-instruct">
        </div>

        <label>Prompt</label>
        <textarea id="prompt" rows="3">Explain Cloudflare Workers in one sentence.</textarea>

        <div class="toggle">
          <input type="checkbox" id="useCustomCost" checked>
          <label for="useCustomCost" style="margin:0">Apply Custom Cost header</label>
        </div>

        <button onclick="sendChat()">Send Request</button>
        <button class="secondary" onclick="sendBurst()">Send Burst (5x)</button>

        <div id="chatOutput" class="chat-area muted">Responses will appear here...</div>
      </div>

      <!-- Custom Costs -->
      <div class="card">
        <h2><span>💰</span> Custom Costs</h2>
        <p class="muted">Override per-token pricing on each request via the <code>cf-aig-custom-cost</code> header.</p>

        <div class="cost-inputs">
          <div>
            <label>Input token cost ($)</label>
            <input type="number" id="costIn" value="0.000001" step="0.0000001">
          </div>
          <div>
            <label>Output token cost ($)</label>
            <input type="number" id="costOut" value="0.000002" step="0.0000001">
          </div>
        </div>

        <button onclick="saveCosts()">Save to KV</button>
        <div id="costMessage"></div>

        <hr style="border-color:#334155;margin:1rem 0">

        <label>Quick Presets</label>
        <div class="row">
          <button class="secondary" onclick="setPreset(0.000001,0.000002)">Cheap</button>
          <button class="secondary" onclick="setPreset(0.00001,0.00003)">Mid</button>
          <button class="secondary" onclick="setPreset(0.0001,0.0003)">Expensive</button>
        </div>
      </div>

      <!-- Spend Limits -->
      <div class="card">
        <h2><span>🛡️</span> Spend Limits</h2>
        <p class="muted">Configure gateway-level spend limit rules via the Cloudflare API.</p>

        <div class="toggle">
          <input type="checkbox" id="limitEnabled">
          <label for="limitEnabled" style="margin:0">Enable spend limit rule</label>
        </div>

        <label>Budget ($)</label>
        <input type="number" id="limitBudget" value="1.00" step="0.01">

        <label>Time Window</label>
        <select id="limitWindow">
          <option value="1m">1 minute</option>
          <option value="5m">5 minutes</option>
          <option value="1h">1 hour</option>
          <option value="1d" selected>1 day</option>
        </select>

        <label>Scope (dimension)</label>
        <select id="limitScope">
          <option value="global">Global (all requests)</option>
          <option value="model">Per model</option>
          <option value="provider">Per provider</option>
        </select>

        <button onclick="saveLimits()">Apply to Gateway</button>
        <div id="limitMessage"></div>
      </div>

      <!-- Stats -->
      <div class="card">
        <h2><span>📊</span> Gateway Stats</h2>
        <button class="secondary" onclick="loadStats()" style="margin-top:0;margin-bottom:1rem">Refresh Stats</button>

        <div class="stats-grid">
          <div class="stat-box">
            <div class="stat-value" id="statRequests">-</div>
            <div class="stat-label">Requests</div>
          </div>
          <div class="stat-box">
            <div class="stat-value" id="statTokens">-</div>
            <div class="stat-label">Tokens</div>
          </div>
          <div class="stat-box">
            <div class="stat-value" id="statCost">-</div>
            <div class="stat-label">Est. Cost</div>
          </div>
          <div class="stat-box">
            <div class="stat-value" id="statRateLimited">-</div>
            <div class="stat-label">Rate Limited</div>
          </div>
        </div>

        <div id="statsDetail" class="muted" style="margin-top:1rem;font-size:0.8rem"></div>
      </div>
    </div>
  </div>

  <script>
    const API = "";

    function log(msg, type="info") {
      const el = document.getElementById("chatOutput");
      const time = new Date().toLocaleTimeString();
      el.innerHTML += \`[\${time}] <span class="\${type}">\${msg}</span>\\n\`;
      el.scrollTop = el.scrollHeight;
    }

    function show(id, msg, type="success") {
      const el = document.getElementById(id);
      el.innerHTML = \`<div class="message \${type}">\${msg}</div>\`;
      setTimeout(() => el.innerHTML = "", 5000);
    }

    async function sendChat(count=1) {
      const model = document.getElementById("model").value;
      const prompt = document.getElementById("prompt").value;
      const useCustom = document.getElementById("useCustomCost").checked;
      const costIn = parseFloat(document.getElementById("costIn").value);
      const costOut = parseFloat(document.getElementById("costOut").value);

      for (let i = 0; i < count; i++) {
        log(\`Sending #\${i+1} to \${model}...\`, "info");
        try {
          const headers = { "Content-Type": "application/json" };
          if (useCustom) {
            headers["x-custom-cost-in"] = costIn;
            headers["x-custom-cost-out"] = costOut;
          }
          const res = await fetch(\`\${API}/api/chat\`, {
            method: "POST",
            headers,
            body: JSON.stringify({ model, prompt })
          });
          const data = await res.json();
          if (res.status === 429) {
            log(\`BLOCKED: Spend limit exceeded (429)\`, "error");
          } else if (res.ok) {
            const tokens = data.usage ? (data.usage.total_tokens || "?") : "?";
            const cost = data.estimatedCost !== undefined ? "\$" + data.estimatedCost.toFixed(6) : "?";
            log(\`OK \${tokens} tokens | est cost \${cost} | \${data.model || model}\`, "success");
          } else {
            log(\`ERR \${res.status}: \${data.error || "Unknown"}\`, "error");
          }
        } catch (e) {
          log("Network error: " + e.message, "error");
        }
      }
    }

    function sendBurst() { sendChat(5); }

    async function saveCosts() {
      const costIn = parseFloat(document.getElementById("costIn").value);
      const costOut = parseFloat(document.getElementById("costOut").value);
      try {
        const res = await fetch(\`\${API}/api/costs\`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ per_token_in: costIn, per_token_out: costOut })
        });
        const data = await res.json();
        show("costMessage", data.ok ? "Custom costs saved to KV." : "Error: " + data.error, data.ok ? "success" : "error");
      } catch (e) {
        show("costMessage", "Error: " + e.message, "error");
      }
    }

    function setPreset(inCost, outCost) {
      document.getElementById("costIn").value = inCost;
      document.getElementById("costOut").value = outCost;
    }

    async function saveLimits() {
      const enabled = document.getElementById("limitEnabled").checked;
      const budget = parseFloat(document.getElementById("limitBudget").value);
      const window = document.getElementById("limitWindow").value;
      const scope = document.getElementById("limitScope").value;
      try {
        const res = await fetch(\`\${API}/api/limits\`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled, budget, window, scope })
        });
        const data = await res.json();
        show("limitMessage", data.ok ? "Spend limits applied to gateway." : "Error: " + data.error, data.ok ? "success" : "error");
      } catch (e) {
        show("limitMessage", "Error: " + e.message, "error");
      }
    }

    async function loadStats() {
      document.getElementById("statRequests").textContent = "...";
      try {
        const res = await fetch(\`\${API}/api/stats\`);
        const data = await res.json();
        if (data.ok) {
          document.getElementById("statRequests").textContent = data.requests ?? "-";
          document.getElementById("statTokens").textContent = data.tokens ?? "-";
          document.getElementById("statCost").textContent = data.cost ? "\$" + data.cost : "-";
          document.getElementById("statRateLimited").textContent = data.rateLimited ?? "-";
          document.getElementById("statsDetail").textContent = data.note || "";
        } else {
          document.getElementById("statsDetail").textContent = "Error: " + (data.error || "Unknown");
        }
      } catch (e) {
        document.getElementById("statsDetail").textContent = "Error: " + e.message;
      }
    }

    // Load saved costs on page load
    (async () => {
      try {
        const res = await fetch(\`\${API}/api/costs\`);
        const data = await res.json();
        if (data.ok && data.costs) {
          document.getElementById("costIn").value = data.costs.per_token_in ?? 0.000001;
          document.getElementById("costOut").value = data.costs.per_token_out ?? 0.000002;
        }
      } catch (e) {}
      loadStats();
    })();
  </script>
</body>
</html>`);
});

// ─── API: Chat ───────────────────────────────────────────────────────────────

app.post("/api/chat", async (c) => {
  const env = c.env;
  const body = await c.req.json<{ model: string; prompt: string }>();
  const { model, prompt } = body;

  // Read custom cost headers (set by client) or fall back to KV
  const hdrIn = c.req.header("x-custom-cost-in");
  const hdrOut = c.req.header("x-custom-cost-out");
  let customCost: { per_token_in: number; per_token_out: number } | undefined;

  if (hdrIn && hdrOut) {
    customCost = { per_token_in: parseFloat(hdrIn), per_token_out: parseFloat(hdrOut) };
  } else {
    const kv = await env.SETTINGS.get("custom_costs");
    if (kv) customCost = JSON.parse(kv);
  }

  const gatewayId = env.GATEWAY_NAME;

  // Cloudflare REST API for Workers AI through AI Gateway
  const upstreamUrl = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/v1/chat/completions`;
  const upstreamHeaders: Record<string, string> = {
    "Authorization": `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
    "Content-Type": "application/json",
    "cf-aig-gateway-id": gatewayId,
  };
  const upstreamBody = {
    model,
    messages: [{ role: "user", content: prompt }],
  };

  // Add custom cost header if configured
  if (customCost) {
    upstreamHeaders["cf-aig-custom-cost"] = JSON.stringify(customCost);
  }

  try {
    const res = await fetch(upstreamUrl, {
      method: "POST",
      headers: upstreamHeaders,
      body: JSON.stringify(upstreamBody),
    });

    const data = await res.json<any>();

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
      choices: data.choices,
      error: data.error?.message,
    }, res.status as any);
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

// ─── API: Custom Costs ───────────────────────────────────────────────────────

app.get("/api/costs", async (c) => {
  const kv = await c.env.SETTINGS.get("custom_costs");
  return c.json({ ok: true, costs: kv ? JSON.parse(kv) : null });
});

app.post("/api/costs", async (c) => {
  const body = await c.req.json<{ per_token_in: number; per_token_out: number }>();
  await c.env.SETTINGS.put("custom_costs", JSON.stringify({
    per_token_in: body.per_token_in,
    per_token_out: body.per_token_out,
  }));
  return c.json({ ok: true });
});

// ─── API: Spend Limits ───────────────────────────────────────────────────────

app.get("/api/limits", async (c) => {
  const kv = await c.env.SETTINGS.get("spend_limits");
  return c.json({ ok: true, limits: kv ? JSON.parse(kv) : null });
});

app.post("/api/limits", async (c) => {
  const env = c.env;
  const body = await c.req.json<{
    enabled: boolean;
    budget: number;
    window: string;
    scope: string;
  }>();

  // Store in KV
  await env.SETTINGS.put("spend_limits", JSON.stringify(body));

  if (!body.enabled) {
    // Disable all spend limit rules (best effort: list and delete)
    try {
      const listRes = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai-gateway/gateways/${env.GATEWAY_NAME}/spend-limits`,
        { headers: { "Authorization": `Bearer ${env.CLOUDFLARE_API_TOKEN}` } }
      );
      const list = await listRes.json<any>();
      if (list.result) {
        for (const rule of list.result) {
          await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai-gateway/gateways/${env.GATEWAY_NAME}/spend-limits/${rule.id}`,
            { method: "DELETE", headers: { "Authorization": `Bearer ${env.CLOUDFLARE_API_TOKEN}` } }
          );
        }
      }
    } catch (e) {}
    return c.json({ ok: true, note: "Spend limits disabled." });
  }

  // Create a spend limit rule via Cloudflare API
  const dimensions: any = {};
  if (body.scope === "model") {
    dimensions.model = { mode: "split_by_value" };
  } else if (body.scope === "provider") {
    dimensions.provider = { mode: "split_by_value" };
  }

  const payload = {
    budget: body.budget,
    window: body.window,
    dimensions,
  };

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai-gateway/gateways/${env.GATEWAY_NAME}/spend-limits`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );
    const data = await res.json<any>();
    if (!res.ok) {
      return c.json({ ok: false, error: data.errors?.[0]?.message || "API error" }, 502);
    }
    return c.json({ ok: true, ruleId: data.result?.id });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

// ─── API: Stats ──────────────────────────────────────────────────────────────

app.get("/api/stats", async (c) => {
  const env = c.env;
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai-gateway/gateways/${env.GATEWAY_NAME}`,
      { headers: { "Authorization": `Bearer ${env.CLOUDFLARE_API_TOKEN}` } }
    );
    const data = await res.json<any>();
    if (!res.ok) {
      return c.json({
        ok: false,
        error: data.errors?.[0]?.message || "Could not fetch stats",
        note: "Ensure your API token has AI Gateway - Read permission.",
      });
    }

    const gw = data.result;
    return c.json({
      ok: true,
      requests: gw.total_requests ?? "-",
      tokens: gw.total_tokens ?? "-",
      cost: gw.total_cost ?? "-",
      rateLimited: gw.rate_limited_requests ?? "-",
      note: "Stats from Cloudflare AI Gateway API.",
    });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message });
  }
});

// ─── Bootstrap: create gateway if missing ────────────────────────────────────

app.get("/api/bootstrap", async (c) => {
  const env = c.env;
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai-gateway/gateways/${env.GATEWAY_NAME}`,
      { headers: { "Authorization": `Bearer ${env.CLOUDFLARE_API_TOKEN}` } }
    );
    if (res.status === 404) {
      const create = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai-gateway`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ id: env.GATEWAY_NAME, name: env.GATEWAY_NAME }),
        }
      );
      const data = await create.json<any>();
      return c.json({ ok: create.ok, created: true, gateway: data.result, error: data.errors?.[0]?.message });
    }
    const data = await res.json<any>();
    return c.json({ ok: true, created: false, gateway: data.result });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message });
  }
});

export default app;
