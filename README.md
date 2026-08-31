# AI Gateway Demo

A complete Cloudflare AI Gateway demo with a web client that generates traffic through the gateway using **Cloudflare Workers AI**. Supports **Custom Costs**, **Spend Limits**, **Rate Limiting**, **Caching**, **Custom Metadata**, and **Identity-Aware Gateway**.

---

## Demo URLs

| URL | Mode | Identity | Access |
|---|---|---|---|
| `https://ai-gw.jsherron.com/demo` | Gateway (human) | `cf.user_id` — shows in dashboard | Browser login (OTP/IdP) |
| `https://ai-gateway-demo-worker.jsherron-test-account.workers.dev` | Worker proxy (service) | `cf.common_name` — logs API only | None (Worker holds service token) |

See [`demo-script.md`](./demo-script.md) for a full walkthrough of both modes plus all gateway features.

---

## Architecture

```
Two demo modes, one Worker:

1. Human identity (browser → gateway directly):
   ┌──────────┐     ┌──────────────────────┐     ┌─────────────────┐
   │  Browser  │────▶│  ai-gw.jsherron.com   │────▶│  AI Gateway     │
   │ (Access)  │     │  /demo (Worker UI)    │     │  /compat/...    │
   └──────────┘     └──────────────────────┘     └─────────────────┘
         │                  │                              │
         │                  ▼                              ▼
         │           ┌──────────┐                   ┌──────────────┐
         │           │  KV      │                   │  Workers AI  │
         │           │ SETTINGS │                   └──────────────┘
         │           └──────────┘
         │
         └──▶ Access injects cf.user_id (human identity, shows in dashboard)

2. Service identity (Worker proxies):
   ┌──────────┐     ┌──────────────────────┐     ┌─────────────────┐
   │  Client   │────▶│  Worker /api/chat    │────▶│  AI Gateway     │
   │           │     │  (service token)     │     │  (custom domain)│
   └──────────┘     └──────────────────────┘     └─────────────────┘
                                                         │
                                                         ▼
                                                  cf.common_name in logs
                                                  (NOT in dashboard)
```

- **Worker** serves the web UI at `/demo` and proxies chat requests to AI Gateway via the **custom domain** (OpenAI-compatible endpoint).
- **Gateway mode** (browser): chat calls go directly to `/compat/chat/completions` — same origin, Access injects `cf.user_id`, no API token in browser.
- **Worker proxy mode** (service): Worker uses service token headers (`CF-Access-Client-Id`/`CF-Access-Client-Secret`), logs show `cf.common_name`.
- **Management calls** (stats, rate limits, spend limits) use the gateway ID via the Cloudflare REST API.
- **KV** persists custom cost settings and gateway config between requests.
- **AI Gateway** observes traffic, applies custom costs, caching, rate limits, and spend limits on Workers AI inference.

> **Two gateway references:**
> - `GATEWAY_NAME` = custom domain for chat traffic (e.g. `ai-gw.jsherron.com`)
> - `GATEWAY_ID` = actual gateway ID for management API calls (e.g. `ai-cost-demo`)

### Identity in Logs

| Auth method | Identity field | Dashboard visibility | User agent |
|---|---|---|---|
| Human (Access + IdP) | `cf.user_id` | Shows in dashboard, User Insights, per-user limits | Browser |
| Service token | `cf.common_name` | Logs API only — does NOT appear in dashboard UI | `cloudflare-worker` |

**Service tokens do not show as identities in the AI Gateway dashboard.** The `cf.common_name` field is visible in the logs API response but is not surfaced in the dashboard's User Insights or per-user analytics views. Only human identity (`cf.user_id` from IdP authentication) appears in the dashboard. This is the key value-add of Identity-Aware Gateway with human auth.

---

## Prerequisites

1. A Cloudflare account.
2. Node.js 18+ installed locally.
3. A Cloudflare API token with the following permissions:
   - `AI Gateway — Edit`
   - `AI Gateway — Read`
   - `Workers AI — Read`

---

## Quick Start

```bash
cd ~/src/ai-gateway-demo
npm install

# Copy the template and fill in your values
cp wrangler.toml.example wrangler.toml
# Edit wrangler.toml:
# - Set account_id
# - Set GATEWAY_NAME to your custom domain (e.g. "ai-gw.jsherron.com")
# - Set GATEWAY_ID to your actual gateway ID (e.g. "ai-cost-demo")
# - Create KV namespace: npx wrangler kv namespace create SETTINGS
# - Paste the KV id into wrangler.toml

# Set secrets
npx wrangler secret put CLOUDFLARE_API_TOKEN
npx wrangler secret put CLOUDFLARE_ACCOUNT_ID
npx wrangler secret put CF_ACCESS_CLIENT_ID
npx wrangler secret put CF_ACCESS_CLIENT_SECRET

# Deploy
npm run deploy
```

Visit `https://<your-gateway-domain>/demo` to open the web client (requires Access authentication for human identity).

---

## Web UI Panels

| Panel | Purpose |
|---|---|
| **Traffic Generator** | Send single or burst chat requests to Workers AI through the gateway. Choose from 20+ models or enter a custom `@cf/` model name. Toggle caching, custom costs, and metadata per-request. |
| **Custom Costs** | Set `per_token_in` and `per_token_out` values. Injected as the `cf-aig-custom-cost` header on every request. |
| **Gateway Settings** | Configure gateway-level **rate limits** (requests per window, fixed/sliding) and **spend limits** (budget + time window + scope) via the Cloudflare API. |
| **Gateway Stats** | Pull live request / token / cost stats from the gateway, plus live config snapshot (cache TTL, rate limit, spend limit status). |
| **Identity-Aware Gateway** | Reference card explaining how to put AI Gateway behind Cloudflare Access for per-user limits and User Insights. |

---

## Feature Deep Dives

### Custom Costs

The demo stores your custom cost values in KV. On every chat request the Worker reads them and forwards the header:

```http
cf-aig-custom-cost: {"per_token_in":0.000001,"per_token_out":0.000002}
```

AI Gateway uses these values instead of the public model pricing when calculating cost metrics and spend limit consumption.

### Caching

Enable caching on a per-request basis via the Traffic Generator. The Worker sends:

```http
cf-aig-cache-ttl: 300
cf-aig-cache-key: my-cache-key    (optional)
```

Or bypass cache with:
```http
cf-aig-skip-cache: true
```

The response includes `cf-aig-cache-status: HIT` or `MISS`. Identical requests within the TTL window are served from Cloudflare's cache.

### Rate Limiting

Configure request-based rate limits on the gateway:
- **Limit**: Max requests per window (e.g. 100)
- **Interval**: Window in seconds (e.g. 60)
- **Technique**: Fixed or sliding window

When exceeded, AI Gateway returns **HTTP 429**.

### Custom Metadata

Tag requests with key-value pairs via `cf-aig-metadata`. Metadata appears in AI Gateway logs for filtering and analytics. Supports strings, numbers, and booleans (max 5 pairs).

> **Reserved keys:** `cf.*` keys are reserved by Cloudflare. When Identity-Aware Gateway is configured, `cf.user_id` is automatically injected.

### Spend Limits

Gateway-level budget enforcement. When cumulative estimated spend hits the budget, AI Gateway returns **HTTP 429**.

### Identity-Aware Gateway

Put a custom domain in front of AI Gateway and protect it with **Cloudflare Access**:
1. Add a [custom domain](https://developers.cloudflare.com/ai-gateway/configuration/custom-domains/) to your gateway
2. Create an [Access application](https://developers.cloudflare.com/cloudflare-one/policies/access/) for that domain
3. Create a service token and add a Service Auth policy at #1
4. Set `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` as Worker secrets
5. Authenticate via your SAML IDP (Okta, Entra, etc.) for human identity
6. AI Gateway auto-injects `cf.user_id` metadata on human requests
7. Service token requests get `cf.common_name` instead (visible in logs API, not dashboard)

This enables:
- **Per-user spend limits** — each user gets their own budget bucket
- **Per-user rate limits** — cap requests per authenticated identity
- **User Insights** — behavioral baselines and anomaly detection per user

> **Note:** Service token identity (`cf.common_name`) appears in the logs API but does NOT appear in the AI Gateway dashboard. Only human identity (`cf.user_id` from IdP authentication) is surfaced in the dashboard's User Insights and per-user analytics views.

### WARP Seamless Auth (Optional)

Enable "Authenticate with Cloudflare One Client" on the Access application to allow WARP users to skip the login page. Requires WARP enrolled in the **same Zero Trust org** as the Access app. Cross-org WARP enrollment does not work for seamless auth (the policy allows the email, but the WARP session must be from the same org). When not configured, users get the standard OTP/IdP login page.

### Access Logout

A red **Access Logout** button appears in gateway mode. It fetches `/cdn-cgi/access/logout` to invalidate the IdP session, waits 2 seconds (to avoid a race condition where Access re-issues the cookie), then redirects to `/demo` to show the login page again.

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Web UI (Worker proxy mode) |
| `GET` | `/demo` | Web UI (gateway mode, behind Access) |
| `GET` | `/demo/logout` | Redirect to Access logout endpoint (fallback, not used by button) |
| `POST` | `/api/chat` | Proxy chat request to Workers AI via AI Gateway (service token) |
| `POST` | `/demo/api/chat` | Same, under `/demo` prefix |
| `GET` | `/api/costs` | Read current custom costs from KV |
| `GET` | `/demo/api/costs` | Same, under `/demo` prefix |
| `POST` | `/api/costs` | Save custom costs to KV |
| `POST` | `/api/settings` | Update gateway rate limits + spend limits |
| `GET` | `/api/stats` | Fetch gateway stats from Cloudflare API |
| `GET` | `/api/bootstrap` | Ensure gateway exists |
| `GET` | `/api/debug-access` | Debug Access service token auth |

---

## Traffic Generation Scripts

Several scripts generate realistic traffic for dashboard demos and load testing:

| Script | Identity | Method | Use Case |
|---|---|---|---|
| `scripts/traffic.sh` | Human (`cf.user_id`) | `cloudflared access curl` | Quick bash-based human identity traffic |
| `scripts/human-identity-traffic.ts` | Human (`cf.user_id`) | Playwright browser automation | Real browser session with saved auth state |
| `scripts/multi-agent-traffic.sh` | Service (`cf.common_name`) | Parallel curl with `CF-Access-Client-Id` | Multiple service-token agents concurrently |
| `scripts/combined-traffic.ts` | Both | TypeScript orchestrator | Simultaneous human + service traffic |
| `scripts/traffic-snippet.js` | Human (`cf.user_id`) | Browser console | Ad-hoc traffic from the demo page |

All scripts randomize models, prompts, custom costs, cache settings, and metadata to produce realistic log diversity.

---

## Token Permissions

| Permission | Scope | Why |
|---|---|---|
| `AI Gateway — Edit` | Account | Create gateway, create/delete spend limit rules, update rate limiting config. |
| `AI Gateway — Read` | Account | Read gateway stats and existing rules. |
| `Workers AI — Read` | Account | Required for Unified Billing / Workers AI inference. |

Create token at: https://dash.cloudflare.com/?to=/:account/api-tokens

---

## Local Development

```bash
cat > .dev.vars <<EOF
CLOUDFLARE_API_TOKEN=your_token
CLOUDFLARE_ACCOUNT_ID=your_account_id
CF_ACCESS_CLIENT_ID=your_access_service_token_id
CF_ACCESS_CLIENT_SECRET=your_access_service_token_secret
EOF

npm run dev
```

Worker starts on `http://localhost:8787`.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `KV namespace not found` | Run `wrangler kv namespace create SETTINGS` and paste the ID into `wrangler.toml`. |
| `Authentication error` on limits/stats | Regenerate API token with **AI Gateway — Edit** and **AI Gateway — Read**. |
| `429 Too Many Requests` from chat | Expected when a rate limit or spend limit is exceeded. Wait for the window to reset, or raise the budget. |
| `Model not found` | Ensure the model name uses the `@cf/` prefix (e.g. `@cf/meta/llama-3.1-8b-instruct`). |
| `Workers AI unauthorized` | Add **Workers AI — Read** permission to your API token. |
| `WARP doesn't auto-login` | WARP must be enrolled in the same Zero Trust org as the Access app. Cross-org enrollment shows OTP page instead. |
| `Logout then re-login fails` | Race condition — wait 2 seconds after logout before navigating to `/demo`. The button handles this automatically. |

---

## Project Structure

```
ai-gateway-demo/
├── src/
│   ├── index.ts          # Hono Worker (UI + API)
│   └── index.test.ts     # Vitest tests
├── scripts/
│   ├── create-gateway.ts        # CLI: create gateway
│   ├── setup-limits.ts          # CLI: create spend limit rule
│   ├── combined-traffic.ts      # Orchestrate service + human traffic
│   ├── human-identity-traffic.ts # Playwright browser traffic (cf.user_id)
│   ├── multi-agent-traffic.sh   # Parallel bash agents (cf.common_name)
│   ├── traffic.sh               # Simple cloudflared curl traffic
│   └── traffic-snippet.js       # Browser console ad-hoc traffic
├── wrangler.toml         # Your local config (gitignored!)
├── wrangler.toml.example # Template for new users
├── tsconfig.json
├── package.json
├── README.md
├── demo-script.md      # Full demo walkthrough (both modes + all features)
└── AGENTS.md             # Agent context for future sessions
```
