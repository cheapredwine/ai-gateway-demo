export type UiOptions = {
  gatewayName: string;
  isGateway: boolean;
  accessLogoutUrl: string;
};

export function renderHtml(opts: UiOptions): string {
  const { gatewayName, isGateway, accessLogoutUrl } = opts;
  return `<!DOCTYPE html>
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
    <p class="subtitle">Gateway: <strong>${gatewayName}</strong> | Provider: <strong>Cloudflare Workers AI</strong> | <span id="identityMode">Loading...</span>${isGateway ? ' | <button id="logoutBtn" onclick="accessLogout()" style="background:#dc2626;color:white;border:none;padding:2px 10px;border-radius:4px;cursor:pointer;font-size:0.8rem;margin-left:0.5rem;">Access Logout</button>' : ''}</p>

    <div class="grid">
      <!-- Chat / Traffic Generator -->
      <div class="card">
        <h2><span>💬</span> Traffic Generator</h2>

        <label>Workers AI Model</label>
        <select id="model" onchange="onModelChange()">
          <optgroup label="Meta Llama">
            <option value="@cf/meta/llama-3.1-8b-instruct-fast" selected>Llama 3.1 8B Fast</option>
            <option value="@cf/meta/llama-3.2-3b-instruct">Llama 3.2 3B Instruct</option>
            <option value="@cf/meta/llama-3.3-70b-instruct-fp8-fast">Llama 3.3 70B FP8 Fast</option>
            <option value="@cf/meta/llama-4-scout-17b-16e-instruct">Llama 4 Scout 17B</option>
          </optgroup>
          <optgroup label="Mistral">
            <option value="@cf/mistral/mistral-7b-instruct-v0.2-lora">Mistral 7B v0.2 LoRA</option>
            <option value="@cf/mistral/mistral-small-3.1-24b-instruct">Mistral Small 3.1 24B</option>
          </optgroup>
          <optgroup label="DeepSeek">
            <option value="@cf/deepseek-ai/deepseek-r1-distill-qwen-32b">DeepSeek R1 Distill Qwen 32B</option>
          </optgroup>
          <optgroup label="Google">
            <option value="@cf/google/gemma-4-26b-a4b-it">Gemma 4 26B IT</option>
            <option value="@cf/google/gemma-7b-it-lora">Gemma 7B IT LoRA</option>
          </optgroup>
          <optgroup label="Qwen">
            <option value="@cf/qwen/qwen3-30b-a3b-fp8">Qwen3 30B FP8</option>
            <option value="@cf/qwen/qwq-32b">QwQ 32B (Reasoning)</option>
            <option value="@cf/qwen/qwen2.5-coder-32b-instruct">Qwen2.5 Coder 32B</option>
          </optgroup>
          <optgroup label="OpenAI">
            <option value="@cf/openai/gpt-oss-20b">GPT-OSS 20B</option>
            <option value="@cf/openai/gpt-oss-120b">GPT-OSS 120B</option>
          </optgroup>
          <optgroup label="Moonshot">
            <option value="@cf/moonshotai/kimi-k2.6">Kimi K2.6</option>
            <option value="@cf/moonshotai/kimi-k2.7-code">Kimi K2.7 Code</option>
          </optgroup>
          <optgroup label="Other">
            <option value="@cf/zhipuai/glm-4.7-flash">GLM 4.7 Flash</option>
            <option value="@cf/ibm/granite-4.0-h-micro">IBM Granite 4.0</option>
            <option value="@cf/nvidia/nemotron-3-120b-a12b">NVIDIA Nemotron 3 120B</option>
            <option value="@cf/microsoft/phi-2">Microsoft Phi-2</option>
            <option value="@cf/tinyllama/tinyllama-1.1b-chat-v1.0">TinyLlama 1.1B</option>
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

        <hr style="border-color:#334155;margin:1rem 0">
        <h3 style="font-size:0.9rem;color:#94a3b8;margin-bottom:0.5rem">Session &amp; Metadata</h3>

        <label>Session ID</label>
        <div class="row">
          <input type="text" id="sessionId" readonly style="font-family:monospace;font-size:0.8rem">
          <button class="secondary" onclick="newSessionId()" style="white-space:nowrap">New</button>
        </div>
        <p class="muted" style="font-size:0.75rem;margin-top:0.25rem">Sent as <code>session_id</code> in cf-aig-metadata. AI Gateway promotes it to <code>metadataSessionId</code> in analytics.</p>

        <div class="toggle" style="margin-top:0.75rem">
          <input type="checkbox" id="useCache" onchange="onCacheToggle()">
          <label for="useCache" style="margin:0">Enable caching (cf-aig-cache-ttl)</label>
        </div>

        <div id="cacheControls" style="display:none;margin-top:0.5rem">
          <div class="cost-inputs">
            <div>
              <label>Cache TTL (seconds)</label>
              <input type="number" id="cacheTTL" value="300" step="60" min="60" max="2592000">
            </div>
            <div>
              <label>Custom Cache Key (optional)</label>
              <input type="text" id="cacheKey" placeholder="my-cache-key">
            </div>
          </div>
          <div class="toggle">
            <input type="checkbox" id="skipCache">
            <label for="skipCache" style="margin:0">Skip cache this time</label>
          </div>
        </div>

        <div class="toggle" style="margin-top:0.75rem">
          <input type="checkbox" id="useMetadata" onchange="onMetadataToggle()">
          <label for="useMetadata" style="margin:0">Send custom metadata (cf-aig-metadata)</label>
        </div>

        <div id="metadataControls" style="display:none;margin-top:0.5rem">
          <div class="cost-inputs">
            <div>
              <label>Key</label>
              <input type="text" id="metaKey" placeholder="user_id" value="team">
            </div>
            <div>
              <label>Value</label>
              <input type="text" id="metaValue" placeholder="12345" value="demo">
            </div>
          </div>
        </div>

        <button onclick="sendChat()">Send Request</button>
        <button class="secondary" onclick="sendBurst()">Send Burst (5x)</button>

        <div id="chatOutput" class="chat-area muted">Responses will appear here...</div>
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
            <div class="stat-value" id="statRlInterval">-</div>
            <div class="stat-label">RL Window (s)</div>
          </div>
        </div>

        <h3 style="font-size:0.85rem;color:#94a3b8;margin-top:1rem;margin-bottom:0.5rem">Live Gateway Config</h3>
        <div class="stats-grid" style="grid-template-columns: 1fr 1fr 1fr">
          <div class="stat-box">
            <div class="stat-value" style="font-size:1rem" id="statCacheTTL">-</div>
            <div class="stat-label">Cache TTL</div>
          </div>
          <div class="stat-box">
            <div class="stat-value" style="font-size:1rem" id="statRLLimit">-</div>
            <div class="stat-label">Rate Limit</div>
          </div>
          <div class="stat-box">
            <div class="stat-value" style="font-size:1rem" id="statSpendLimit">-</div>
            <div class="stat-label">Spend Limit</div>
          </div>
        </div>

        <div id="statsDetail" class="muted" style="margin-top:1rem;font-size:0.8rem"></div>
      </div>

      <!-- Gateway Settings -->
      <div class="card">
        <h2><span>⚙️</span> Gateway Settings</h2>
        <p class="muted">Configure gateway-level rate limits and spend limits via Cloudflare API.</p>

        <h3 style="font-size:0.9rem;color:#94a3b8;margin:0.5rem 0">Rate Limiting</h3>
        <div class="toggle">
          <input type="checkbox" id="rlEnabled">
          <label for="rlEnabled" style="margin:0">Enable rate limiting</label>
        </div>
        <label>Requests per window</label>
        <input type="number" id="rlLimit" value="100" step="1">
        <label>Window (seconds)</label>
        <input type="number" id="rlInterval" value="60" step="10">
        <label>Technique</label>
        <select id="rlTechnique">
          <option value="fixed">Fixed window</option>
          <option value="sliding">Sliding window</option>
        </select>

        <hr style="border-color:#334155;margin:1rem 0">

        <h3 style="font-size:0.9rem;color:#94a3b8;margin:0.5rem 0">Spend Limits</h3>
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

        <button onclick="saveGatewaySettings()">Apply All to Gateway</button>
        <div id="limitMessage"></div>
      </div>

      <!-- Custom Costs (compact) -->
      <div class="card" style="grid-column:2">
        <h2><span>💰</span> Custom Costs</h2>

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

        <div class="row" style="margin-top:0.75rem">
          <button class="secondary" onclick="setPreset(0.000001,0.000002)">Cheap</button>
          <button class="secondary" onclick="setPreset(0.00001,0.00003)">Mid</button>
          <button class="secondary" onclick="setPreset(0.0001,0.0003)">Expensive</button>
        </div>
      </div>

      <!-- Identity & Access -->
      <div class="card">
        <h2><span>🔐</span> Identity-Aware Gateway <span class="muted" style="font-size:0.7rem;background:#1e3a5f;padding:2px 6px;border-radius:4px">BETA</span></h2>
        <p class="muted">Put a custom domain in front of AI Gateway and protect it with Cloudflare Access. Every authenticated request carries the user's identity as <code>cf.user_id</code> metadata — no code changes required.</p>

        <div class="stats-grid" style="grid-template-columns: 1fr 1fr; gap:0.5rem; margin-top:0.75rem">
          <div class="stat-box" style="padding:0.75rem">
            <div class="stat-value" style="font-size:1.1rem">Per-User</div>
            <div class="stat-label">Spend Limits</div>
          </div>
          <div class="stat-box" style="padding:0.75rem">
            <div class="stat-value" style="font-size:1.1rem">Per-User</div>
            <div class="stat-label">Rate Limits</div>
          </div>
          <div class="stat-box" style="padding:0.75rem">
            <div class="stat-value" style="font-size:1.1rem">User Insights</div>
            <div class="stat-label">Behavioral Baselines</div>
          </div>
          <div class="stat-box" style="padding:0.75rem">
            <div class="stat-value" style="font-size:1.1rem">IDP Groups</div>
            <div class="stat-label">Okta / Entra / SAML</div>
          </div>
        </div>

        <h3 style="font-size:0.85rem;color:#94a3b8;margin-top:1rem;margin-bottom:0.5rem">Setup Steps</h3>
        <ol class="muted" style="font-size:0.8rem;padding-left:1.2rem;line-height:1.6">
          <li>Add a <a href="https://developers.cloudflare.com/ai-gateway/configuration/custom-domains/" target="_blank" style="color:#3b82f6">custom domain</a> to your AI Gateway</li>
          <li>Create an <a href="https://developers.cloudflare.com/cloudflare-one/policies/access/" target="_blank" style="color:#3b82f6">Access application</a> for that domain</li>
          <li>Authenticate via your SAML IDP (Okta, Entra, etc.)</li>
          <li>AI Gateway auto-injects <code>cf.user_id</code> into every request</li>
          <li>Filter logs, set per-user limits, and view User Insights</li>
        </ol>

        <div class="message info" style="background:rgba(59,130,246,0.1);margin-top:0.75rem">
          <strong>Reserved metadata:</strong> Keys starting with <code>cf.</code> are reserved. When Access is configured, <code>cf.user_id</code> is automatically added to request metadata and appears in logs.
        </div>
      </div>
    </div>
  </div>

  <script>
    const onGateway = window.location.pathname.startsWith("/demo");
    const API = onGateway ? "/demo" : "";

    document.getElementById("identityMode").innerHTML = onGateway
      ? '<span style="color:#4ade80;">Access Identity (cf.user_id)</span>'
      : '<span style="color:#fbbf24;">Service Token (cf.common_name)</span>';

    function generateSessionId() {
      const bytes = crypto.getRandomValues(new Uint8Array(8));
      return "sess-" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    }

    function newSessionId() {
      document.getElementById("sessionId").value = generateSessionId();
    }

    newSessionId();

    function log(msg, type="info") {
      const el = document.getElementById("chatOutput");
      const time = new Date().toLocaleTimeString();
      const line = document.createElement("div");
      line.appendChild(document.createTextNode("[" + time + "] "));
      const span = document.createElement("span");
      span.className = type;
      span.textContent = msg;
      line.appendChild(span);
      el.appendChild(line);
      el.scrollTop = el.scrollHeight;
    }

    function accessLogout() {
      fetch("${accessLogoutUrl}", { credentials: "include" })
        .catch(() => {})
        .finally(() => {
          const el = document.getElementById("chatOutput");
          if (el) el.innerHTML = '<div class="message info">Logged out. Redirecting to login in 2 seconds...</div>';
          setTimeout(() => { window.location.href = "/demo"; }, 2000);
        });
    }

    function show(id, msg, type="success") {
      const el = document.getElementById(id);
      el.innerHTML = "";
      const div = document.createElement("div");
      div.className = "message " + type;
      div.textContent = msg;
      el.appendChild(div);
      setTimeout(() => el.innerHTML = "", 5000);
    }

    function onModelChange() {
      const sel = document.getElementById("model").value;
      document.getElementById("customModelInput").style.display = sel === "custom" ? "block" : "none";
    }

    function onCacheToggle() {
      document.getElementById("cacheControls").style.display = document.getElementById("useCache").checked ? "block" : "none";
    }

    function onMetadataToggle() {
      document.getElementById("metadataControls").style.display = document.getElementById("useMetadata").checked ? "block" : "none";
    }

    async function sendChat(count=1) {
      const modelSel = document.getElementById("model").value;
      const model = modelSel === "custom" ? document.getElementById("customModel").value : modelSel;
      const prompt = document.getElementById("prompt").value;
      const useCustom = document.getElementById("useCustomCost").checked;
      const costIn = parseFloat(document.getElementById("costIn").value);
      const costOut = parseFloat(document.getElementById("costOut").value);
      const useCache = document.getElementById("useCache").checked;
      const cacheTTL = parseInt(document.getElementById("cacheTTL").value, 10);
      const cacheKey = document.getElementById("cacheKey").value;
      const skipCache = document.getElementById("skipCache").checked;
      const useMetadata = document.getElementById("useMetadata").checked;
      const metaKey = document.getElementById("metaKey").value;
      const metaValue = document.getElementById("metaValue").value;
      const sessionId = document.getElementById("sessionId").value;

      const buildMetadata = () => {
        const m = { session_id: sessionId };
        if (useMetadata && metaKey) m[metaKey] = metaValue;
        return m;
      };

      for (let i = 0; i < count; i++) {
        log(\`Sending #\${i+1} to \${model} [session: \${sessionId}]...\`, "info");
        try {
          if (onGateway) {
            // Gateway mode: call /compat/chat/completions directly (Access injects cf.user_id)
            const headers = { "Content-Type": "application/json" };
            if (useCustom) {
              headers["cf-aig-custom-cost"] = JSON.stringify({ per_token_in: costIn, per_token_out: costOut });
            }
            if (useCache) {
              if (skipCache) {
                headers["cf-aig-skip-cache"] = "true";
              } else {
                headers["cf-aig-cache-ttl"] = String(cacheTTL);
                if (cacheKey) headers["cf-aig-cache-key"] = cacheKey;
              }
            }
            if (useMetadata && metaKey) {
              headers["cf-aig-metadata"] = JSON.stringify(buildMetadata());
            } else {
              headers["cf-aig-metadata"] = JSON.stringify({ session_id: sessionId });
            }
            const res = await fetch("/compat/chat/completions", {
              method: "POST",
              headers,
              body: JSON.stringify({
                model: "workers-ai/" + model,
                messages: [{ role: "user", content: prompt }]
              })
            });
            const data = await res.json();
            if (res.status === 429) {
              log(\`BLOCKED: Gateway limit exceeded (429)\`, "error");
            } else if (res.ok) {
              const tokens = data.usage ? (data.usage.total_tokens || "?") : "?";
              const cacheStatus = res.headers.get("cf-aig-cache-status");
              const cacheStr = cacheStatus ? \` | cache \${cacheStatus}\` : "";
              let costStr = "?";
              if (useCustom && data.usage) {
                const est = (data.usage.prompt_tokens ?? 0) * costIn + (data.usage.completion_tokens ?? 0) * costOut;
                costStr = "$" + est.toFixed(6);
              }
              log(\`OK \${tokens} tokens | est cost \${costStr}\${cacheStr} | \${data.model || model}\`, "success");
              const content = data.choices?.[0]?.message?.content;
              if (content) log(\`  > \${content}\`, "info");
            } else {
              log(\`ERR \${res.status}: \${data.error?.message || data.error || "Unknown"}\`, "error");
            }
          } else {
            // Worker mode: proxy through /api/chat (service token auth)
            const headers = { "Content-Type": "application/json" };
            if (useCustom) {
              headers["x-custom-cost-in"] = costIn;
              headers["x-custom-cost-out"] = costOut;
            }
            const res = await fetch(\`\${API}/api/chat\`, {
              method: "POST",
              headers,
              body: JSON.stringify({
                model,
                prompt,
                cache: useCache ? { ttl: cacheTTL, key: cacheKey || undefined, skip: skipCache } : undefined,
                metadata: buildMetadata()
              })
            });
            const data = await res.json();
            if (res.status === 429) {
              log(\`BLOCKED: Gateway limit exceeded (429)\`, "error");
            } else if (res.ok) {
              const tokens = data.usage ? (data.usage.total_tokens || "?") : "?";
              const cost = data.estimatedCost !== undefined ? "$" + data.estimatedCost.toFixed(6) : "?";
              const cacheStatus = data.cacheStatus ? \` | cache \${data.cacheStatus}\` : "";
              log(\`OK \${tokens} tokens | est cost \${cost}\${cacheStatus} | \${data.model || model}\`, "success");
              const content = data.choices?.[0]?.message?.content;
              if (content) log(\`  > \${content}\`, "info");
            } else {
              log(\`ERR \${res.status}: \${data.error || "Unknown"}\`, "error");
            }
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
      saveCosts();
    }

    async function saveGatewaySettings() {
      const rlEnabled = document.getElementById("rlEnabled").checked;
      const rlLimit = parseInt(document.getElementById("rlLimit").value, 10);
      const rlInterval = parseInt(document.getElementById("rlInterval").value, 10);
      const rlTechnique = document.getElementById("rlTechnique").value;
      const limitEnabled = document.getElementById("limitEnabled").checked;
      const budget = parseFloat(document.getElementById("limitBudget").value);
      const window = document.getElementById("limitWindow").value;
      const scope = document.getElementById("limitScope").value;
      try {
        const res = await fetch(\`\${API}/api/settings\`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rateLimit: { enabled: rlEnabled, limit: rlLimit, interval: rlInterval, technique: rlTechnique },
            spendLimit: { enabled: limitEnabled, budget, window, scope }
          })
        });
        const data = await res.json();
        show("limitMessage", data.ok ? "Gateway settings applied." : "Error: " + data.error, data.ok ? "success" : "error");
      } catch (e) {
        show("limitMessage", "Error: " + e.message, "error");
      }
    }

    async function loadStats() {
      document.getElementById("statRequests").textContent = "...";
      try {
        const res = await fetch(\`\${API}/api/stats\`, { cache: "no-store" });
        const data = await res.json();
        if (data.ok) {
          document.getElementById("statRequests").textContent = data.requests ?? "-";
          document.getElementById("statTokens").textContent = data.tokens ?? "-";
          document.getElementById("statCost").textContent = data.cost || "-";
          document.getElementById("statRlInterval").textContent = data.rlInterval ?? "-";
          document.getElementById("statCacheTTL").textContent = data.cacheTTL ?? "-";
          document.getElementById("statRLLimit").textContent = data.rlLimit ?? "-";
          document.getElementById("statSpendLimit").textContent = data.spendLimit ?? "-";
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
`;
}
