# Agent Context: AI Gateway Demo

## Project Overview

Single Cloudflare Worker that serves a web UI for demonstrating AI Gateway features:
- **Custom Costs**: Override per-token pricing via `cf-aig-custom-cost` header
- **Spend Limits**: Gateway-level budget enforcement that returns 429 when exceeded
- **Rate Limiting**: Request-based limits (fixed/sliding window) via gateway config
- **Caching**: Per-request cache TTL and custom cache keys via `cf-aig-cache-ttl`
- **Custom Metadata**: Tag requests with `cf-aig-metadata` for log filtering
- **Identity-Aware Gateway**: Cloudflare Access + custom domain auto-injects `cf.user_id`
- **Workers AI**: All traffic routes to Cloudflare Workers AI models via the REST API

## Architecture

```
Two demo modes, one Worker:

1. Human identity (browser → gateway directly):
   Browser → ai-gw.jsherron.com/demo (Worker serves UI)
          → ai-gw.jsherron.com/compat/chat/completions (direct, Access injects cf.user_id)
          → ai-gw.jsherron.com/demo/api/* (Worker handles management with service token)

2. Service identity (Worker proxies everything):
   Client → workers.dev URL /api/chat → AI Gateway (custom domain with service token) → Workers AI
                                        → cf.common_name in logs (NOT cf.user_id)
```

- **Gateway mode URL**: `https://ai-gw.jsherron.com/demo` — behind Access, human identity
- **Worker proxy URL**: `https://ai-gateway-demo-worker.jsherron-test-account.workers.dev` — no Access, service token
- **Worker routes**: `ai-gw.jsherron.com/demo` and `ai-gw.jsherron.com/demo/*` (zone: jsherron.com)
- **Gateway direct**: `ai-gw.jsherron.com/compat/chat/completions` goes directly to AI Gateway (no Worker route)
- **Management calls** (stats, settings) use the gateway **ID** via Cloudflare REST API
- **KV** stores `custom_costs` and `gateway_settings`

### Identity in Logs

| Auth method | Identity field | Dashboard visibility | User agent |
|---|---|---|---|
| Human (Access + IdP) | `cf.user_id` | Shows in dashboard, User Insights, per-user limits | Browser |
| Service token | `cf.common_name` | Logs API only — does NOT appear in dashboard UI | `cloudflare-worker` |

**Service tokens do not show as identities in the AI Gateway dashboard.** The `cf.common_name` field is visible in the logs API response but is not surfaced in the dashboard's User Insights or per-user analytics views. Only human identity (`cf.user_id` from IdP authentication) appears in the dashboard. This is the key value-add of Identity-Aware Gateway with human auth.

## Key Files

| File | Purpose |
|---|---|
| `src/index.ts` | Hono Worker. Serves HTML UI at `/` and `/demo`. Handles API routes under both `/api/*` and `/demo/api/*`. Chat calls custom domain `/compat/chat/completions`. Management calls use gateway ID via Cloudflare REST API. |
| `wrangler.toml` | Your local Worker config (gitignored). Copy from `wrangler.toml.example`. |
| `wrangler.toml.example` | Template with placeholder values for new users. |
| `scripts/create-gateway.ts` | CLI script to create the AI Gateway via Cloudflare API if missing. |
| `scripts/setup-limits.ts` | CLI script to create a spend limit rule on the gateway. |
| `scripts/combined-traffic.ts` | Orchestrates both service-token agents and human-identity traffic simultaneously. |
| `scripts/human-identity-traffic.ts` | Playwright browser script that fires requests with real Access session (cf.user_id). |
| `scripts/multi-agent-traffic.sh` | Parallel bash traffic generator using multiple AGENT_* service token pairs. |
| `scripts/traffic.sh` | Simple bash script using cloudflared access curl for human-identity traffic. |
| `scripts/traffic-snippet.js` | Browser console snippet for ad-hoc human-identity traffic on the demo page. |

## Environment / Secrets

Set via `wrangler secret put`:
- `CLOUDFLARE_API_TOKEN` — needs `AI Gateway:Edit`, `AI Gateway:Read`, `Workers AI:Read`
- `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account ID
- `CF_ACCESS_CLIENT_ID` — Cloudflare Access service token client ID
- `CF_ACCESS_CLIENT_SECRET` — Cloudflare Access service token client secret

KV namespace:
- `SETTINGS` — stores `custom_costs` and `gateway_settings` JSON

### Setup

1. Copy the template: `cp wrangler.toml.example wrangler.toml`
2. Edit `wrangler.toml` with your `account_id`, `GATEWAY_NAME`, `GATEWAY_ID`, and KV `id`
3. Add Worker routes for your gateway custom domain (e.g., `ai-gw.jsherron.com/demo` and `ai-gw.jsherron.com/demo/*`)
4. `wrangler.toml` is gitignored so your personal config never gets committed

## API Token Permissions

Critical: token MUST have:
1. `AI Gateway — Edit` (create gateway, manage spend limits, update gateway config)
2. `AI Gateway — Read` (fetch stats)
3. `Workers AI — Read` (call Workers AI inference)

## Important Implementation Details

### Custom Costs Header
```
cf-aig-custom-cost: {"per_token_in":0.000001,"per_token_out":0.000002}
```
- Sent on every `/api/chat` request if enabled
- Values stored in KV, editable in web UI
- AI Gateway uses these instead of public pricing for cost tracking

### Caching Headers
```
cf-aig-cache-ttl: 300
cf-aig-cache-key: my-key      (optional)
cf-aig-skip-cache: true       (optional, bypasses cache)
```
- Per-request override of gateway cache settings
- Cache status returned in response header `cf-aig-cache-status` (HIT / MISS)

### Custom Metadata Header
```
cf-aig-metadata: {"team":"AI","user":12345}
```
- Up to 5 key-value pairs (string, number, or boolean)
- Appears in AI Gateway logs for filtering and analytics
- **Reserved:** Keys starting with `cf.` are reserved. When Identity-Aware Gateway is configured with Cloudflare Access, `cf.user_id` is automatically injected into metadata.

### Workers AI via Custom Domain
```
POST https://ai-gw.jsherron.com/compat/chat/completions
Headers:
  Authorization: Bearer {CLOUDFLARE_API_TOKEN}
  CF-Access-Client-Id: {service_token_id}    (for Worker/service auth)
  CF-Access-Client-Secret: {service_token_secret}
  cf-aig-custom-cost: {json}      (optional)
  cf-aig-cache-ttl: {seconds}     (optional)
  cf-aig-metadata: {json}        (optional)
Body:
  { model: "workers-ai/@cf/meta/llama-3.1-8b-instruct", messages: [...] }
```
- Uses the AI Gateway custom domain directly
- Service token headers (`CF-Access-Client-Id`/`CF-Access-Client-Secret`) authenticate the Worker through Cloudflare Access
- When a human user opens the UI in a browser, Access injects `cf.user_id` via the IdP session — no service token or API token needed in the browser
- Model names are prefixed with `workers-ai/`

### Gateway Settings API
Rate limiting is updated via PUT to the gateway:
```
PUT /client/v4/accounts/{account_id}/ai-gateway/gateways/{gateway_name}
Body:
  { rate_limiting_limit: 100, rate_limiting_interval: 60, rate_limiting_technique: "fixed" }
```

Spend limits are created via:
```
POST /client/v4/accounts/{account_id}/ai-gateway/gateways/{gateway_name}/spend-limits
Body:
  { budget: 1.0, window: "1d", dimensions: {} }
```

### Identity-Aware Gateway
1. Add a [custom domain](https://developers.cloudflare.com/ai-gateway/configuration/custom-domains/) to the AI Gateway
2. Create a [Cloudflare Access application](https://developers.cloudflare.com/cloudflare-one/policies/access/) for that domain
3. Create a service token and add a Service Auth policy at #1
4. Set `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` as Worker secrets
5. Authenticate via SAML IdP (Okta, Entra, etc.) for human identity
6. AI Gateway automatically injects `cf.user_id` metadata on human requests
7. Service token requests get `cf.common_name` instead (visible in logs API, not dashboard)
8. Enables per-user spend limits, per-user rate limits, and User Insights behavioral baselines

### WARP Seamless Auth (Optional)
- Enable "Authenticate with Cloudflare One Client" on the Access application (not the policy)
- Requires WARP enrolled in the **same Zero Trust org** as the Access app
- Cross-org WARP enrollment does NOT work for seamless auth (policy allows the email, but WARP session must be from the same org)
- When working: browser goes straight to the UI — no OTP/IdP login page
- When not working: Access shows the OTP/IdP login page (still authenticates fine, just not seamless)
- To switch WARP org: `warp-cli registration new <team-name>` (replaces existing enrollment)

### Access Logout
- Logout button shown only in gateway mode (when `isGateway` is true server-side)
- Client-side: `fetch("/cdn-cgi/access/logout")` → wait 2s → redirect to `/demo`
- The 2s delay avoids a race condition where Access re-issues the cookie before the IdP session is fully invalidated
- The `/demo/logout` server-side route exists as a fallback but is not used by the button

### Model Selector
- 20+ pre-populated Workers AI models organized by provider (Meta, Mistral, DeepSeek, Google, Qwen, OpenAI, Moonshot, Other)
- "Custom model..." option reveals text input for any `@cf/` model
- Model value sent directly to Workers AI API — must use valid `@cf/` prefix

## Common Tasks

### Add a new model to the dropdown
Edit the `<select id="model">` in `src/index.ts` HTML string. Add `<option value="@cf/...">Display Name</option>` inside the appropriate `<optgroup>`.

### Change default gateway name
Update `GATEWAY_NAME` in `wrangler.toml` and `src/index.ts` subtitle text.

### Reset gateway settings
POST to `/api/settings` with rate limit and spend limit `enabled: false`, or use the web UI toggles.

### Local dev
Set secrets via `wrangler secret put` (same as production), then run:

```bash
npm run dev
```

If you need local-only overrides without touching Cloudflare secrets, create `.dev.vars` in the project root — `wrangler dev` reads it automatically.

## Tech Stack

- **Runtime**: Cloudflare Workers (V8 isolates)
- **Framework**: Hono v4
- **Language**: TypeScript
- **Storage**: Cloudflare KV
- **AI**: Cloudflare Workers AI via AI Gateway
- **Testing**: Vitest (with manual KV mocking, runs in Node)
- **Traffic Generation**: Playwright (browser automation), bash/curl, cloudflared

## Testing

```bash
npm test
```

Tests use Vitest with a mock KV implementation and mocked `fetch` for upstream API calls. No Workers runtime or live Cloudflare API needed for unit tests.

Key test coverage:
- HTML UI rendering at `/`, `/demo`, `/demo/` with env vars
- Gateway mode detection (`onGateway`) in HTML JavaScript
- Custom Costs CRUD via mock KV (both `/api` and `/demo/api` prefixes)
- Chat proxy with mocked upstream responses
- Service token header forwarding (`CF-Access-Client-Id`, `CF-Access-Client-Secret`)
- Model prefixing (`workers-ai/` prefix)
- Caching headers (`cf-aig-cache-ttl`, `cf-aig-cache-key`, `cf-aig-skip-cache`)
- Custom metadata header (`cf-aig-metadata`)
- Custom cost header forwarding
- KV fallback for custom costs
- 429 rate-limit response handling
- Debug access endpoint
- All API routes tested under both `/api` and `/demo/api` prefixes

## Deployment

```bash
npm install
# ...configure wrangler.toml and secrets...
npm run deploy
```

## Known Limitations

- Spend limits are eventually consistent (burst can briefly exceed budget)
- Cost tracking is best-effort estimation based on token counts
- Max 20 spend limit rules per gateway
- Gateway stats endpoint may vary; adjust `/api/stats` if Cloudflare API changes
- Identity-Aware Gateway requires a custom domain and Cloudflare Access (not configurable through this Worker)
- WARP seamless auth requires same-org WARP enrollment; cross-org shows OTP page instead
- Access logout race condition: immediate re-login after logout can fail; 2s delay in the client-side logout handles this

## Public Template Notes

- Copy `wrangler.toml.example` → `wrangler.toml` and fill in your values
- `wrangler.toml` is gitignored so your personal config never gets committed
- Default gateway name is `demo-gateway` (change via `GATEWAY_ID` var)
