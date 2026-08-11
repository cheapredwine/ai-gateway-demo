# AI Gateway Demo Script

## Demo URLs

| URL | Mode | Identity | Access |
|---|---|---|---|
| `https://ai-gw.jsherron.com/demo` | Gateway (human) | `cf.user_id` — shows in dashboard | Browser login (OTP/IdP) |
| `https://ai-gateway-demo-worker.jsherron-test-account.workers.dev` | Worker proxy (service) | `cf.common_name` — logs API only | None (Worker holds service token) |

---

## Part 1: Human Identity (Gateway Mode)

**Goal:** Show that Access injects a real user identity into gateway logs, visible in the dashboard.

### 1.1 Open the UI

1. Open `https://ai-gw.jsherron.com/demo` in your browser
2. Cloudflare Access prompts for authentication
3. Choose One-time PIN (or configured IdP: Okta, Entra, etc.)
4. Enter `jason@sherron.com` and complete OTP
5. The AI Gateway demo UI loads

> **Talking point:** The browser authenticated through Cloudflare Access. Every request from this browser session will carry the user's identity. No API token is exposed to the browser.

### 1.2 Generate traffic

1. Pick a model (e.g., Llama 3.1 8B Instruct Fast)
2. Type a prompt: "Explain AI Gateway in one sentence"
3. Click **Send**
4. The response appears in the chat output
5. Click **Send Burst** (5 requests) to generate more traffic

> **What's happening:** The browser calls `/compat/chat/completions` directly on the same origin. Access injects `cf.user_id` into the request metadata. The AI Gateway logs the request with the human's identity.

### 1.3 Verify identity in logs

```bash
# Pull latest logs from the API
curl -s "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/ai-gateway/gateways/ai-cost-demo/logs?limit=5" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | python3 -c "
import json, sys
for log in json.load(sys.stdin).get('result', [])[:5]:
    meta = log.get('metadata', {})
    identity = meta.get('cf.user_id', meta.get('cf.common_name', 'none'))
    print(f\"  {log['created_at'][:19]} | identity: {identity} | ua: {log.get('user_agent','')[:25]} | status: {log['status_code']}\")"
```

Expected: `cf.user_id` with a UUID, user agent shows `Mozilla/5.0` (browser).

### 1.4 Show the dashboard

1. Open the [AI Gateway dashboard](https://dash.cloudflare.com/?to=/:account/ai-gateway)
2. Select the `ai-cost-demo` gateway
3. Navigate to **Logs** or **User Insights**
4. The authenticated user appears with their identity, request count, token usage, and cost

> **Key point:** Human identity (`cf.user_id`) appears in the dashboard. This enables per-user spend limits, per-user rate limits, and User Insights behavioral baselines.

---

## Part 2: Service Identity (Worker Proxy Mode)

**Goal:** Show that service tokens authenticate machine-to-machine traffic, but the identity only appears in the logs API — not the dashboard.

### 2.1 Open the UI

1. Open `https://ai-gateway-demo-worker.jsherron-test-account.workers.dev` in your browser
2. The UI loads immediately — no Access login prompt
3. The UI is in "Worker proxy mode" (detected by URL path)

> **Talking point:** This URL is not behind Access. The Worker holds a service token as a secret and injects it into every request. The browser never sees the token.

### 2.2 Generate traffic

1. Pick a model and type a prompt
2. Click **Send** — the Worker proxies the request to the gateway with service token headers
3. Click **Send Burst** for more traffic

> **What's happening:** Browser → Worker → AI Gateway. The Worker adds `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers. Access authenticates the service token. The gateway logs `cf.common_name` (the service token's ID).

### 2.3 Verify identity in logs

```bash
curl -s "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/ai-gateway/gateways/ai-cost-demo/logs?limit=5" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | python3 -c "
import json, sys
for log in json.load(sys.stdin).get('result', [])[:5]:
    meta = log.get('metadata', {})
    identity = meta.get('cf.user_id', meta.get('cf.common_name', 'none'))
    print(f\"  {log['created_at'][:19]} | identity: {identity} | ua: {log.get('user_agent','')[:25]} | status: {log['status_code']}\")"
```

Expected: `cf.common_name` with the service token ID, user agent shows `cloudflare-worker`.

### 2.4 Show the dashboard gap

1. Open the [AI Gateway dashboard](https://dash.cloudflare.com/?to=/:account/ai-gateway)
2. Select the `ai-cost-demo` gateway
3. Look at **User Insights** — the service token identity does NOT appear
4. The requests show up in aggregate stats, but not as a per-user identity

> **Key point:** Service token identity (`cf.common_name`) is in the logs API but NOT in the dashboard. Only human identity (`cf.user_id`) gets the dashboard treatment. This is why Identity-Aware Gateway with human auth is the value-add.

---

## Part 3: Custom Costs

**Goal:** Show per-token cost overrides.

### 3.1 Set custom costs

1. In the **Custom Costs** panel, set:
   - `per_token_in`: `0.000001`
   - `per_token_out`: `0.000002`
2. Click **Save** (persists to KV)
3. Or use a preset button for quick values

### 3.2 Send a request

1. Check **Use Custom Cost** in the Traffic Generator
2. Send a chat request
3. The output shows estimated cost based on your custom rates

> **What's happening:** The Worker sends `cf-aig-custom-cost: {"per_token_in":0.000001,"per_token_out":0.000002}` header. AI Gateway uses these rates instead of public model pricing for cost tracking and spend limit enforcement.

---

## Part 4: Caching

**Goal:** Show per-request cache control.

### 4.1 Enable caching

1. Check **Use Cache**
2. Set TTL to `300` (5 minutes)
3. Optionally set a custom cache key
4. Send the same prompt twice
5. First response: `cache MISS`
6. Second response: `cache HIT`

> **What's happening:** The Worker sends `cf-aig-cache-ttl: 300`. The AI Gateway caches the response. Identical requests within the TTL window are served from cache — no upstream call, no token cost.

### 4.2 Bypass cache

1. Check **Skip Cache**
2. Send the same prompt — response shows `cache MISS` (forced bypass)

---

## Part 5: Rate Limiting

**Goal:** Show gateway-level request limits.

### 5.1 Configure rate limiting

1. In the **Gateway Settings** panel:
   - Enable rate limiting
   - Set limit: `5` requests per `10` seconds
   - Technique: `fixed`
2. Click **Apply**

### 5.2 Trigger the limit

1. Click **Send Burst** (5 requests)
2. First few succeed, then: `BLOCKED: Gateway limit exceeded (429)`
3. Wait 10 seconds, send again — works

> **What's happening:** The AI Gateway enforces the rate limit at the gateway level. No upstream calls are made for blocked requests.

---

## Part 6: Spend Limits

**Goal:** Show gateway-level budget enforcement.

### 6.1 Configure a spend limit

1. In the **Gateway Settings** panel:
   - Enable spend limit
   - Set budget: `$0.01`
   - Window: `1d`
   - Scope: `global`
2. Click **Apply**

### 6.2 Trigger the limit

1. Send several requests with custom costs enabled
2. After cumulative spend exceeds $0.01, requests return 429
3. Check the logs — blocked requests show in the gateway

> **Note:** Spend limits are eventually consistent. A brief burst can slightly exceed the budget before the limit kicks in.

---

## Part 7: Custom Metadata

**Goal:** Show request tagging for log filtering.

### 7.1 Send tagged requests

1. Check **Use Metadata**
2. Set key: `team`, value: `AI`
3. Send a request
4. Check the logs — metadata appears alongside the identity

```bash
curl -s "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/ai-gateway/gateways/ai-cost-demo/logs?limit=3" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | python3 -c "
import json, sys
for log in json.load(sys.stdin).get('result', [])[:3]:
    print(f\"  metadata: {log.get('metadata', {})}\")"
```

> **What's happening:** The Worker sends `cf-aig-metadata: {"team":"AI"}`. Metadata appears in gateway logs for filtering and analytics. Up to 5 key-value pairs. `cf.*` keys are reserved (auto-injected by Access).

---

## Summary: Identity Comparison

| | Human (Gateway Mode) | Service (Worker Proxy) |
|---|---|---|
| **URL** | `ai-gw.jsherron.com/demo` | `...workers.dev` |
| **Auth** | Access (OTP/IdP) | Service token (Worker secret) |
| **Identity field** | `cf.user_id` | `cf.common_name` |
| **Dashboard visibility** | User Insights, per-user limits | Not shown |
| **Logs API** | Yes | Yes |
| **Per-user spend limits** | Yes | No |
| **Per-user rate limits** | Yes | No |
| **User agent** | Browser | `cloudflare-worker` |
| **API token in browser** | No | No (Worker holds it) |
