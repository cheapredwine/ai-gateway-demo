# Agent Context: AI Gateway Demo

## Project Overview

Single Cloudflare Worker that serves a web UI for demonstrating AI Gateway features:
- **Custom Costs**: Override per-token pricing via `cf-aig-custom-cost` header
- **Spend Limits**: Gateway-level budget enforcement that returns 429 when exceeded
- **Rate Limiting**: Request-based limits (fixed/sliding window) via gateway config
- **Caching**: Per-request cache TTL and custom cache keys via `cf-aig-cache-ttl`
- **Custom Metadata**: Tag requests with `cf-aig-metadata` for log filtering
- **Identity-Aware Gateway** (Beta): Cloudflare Access + custom domain auto-injects `cf.user_id`
- **Workers AI**: All traffic routes to Cloudflare Workers AI models via the REST API

## Architecture

```
Browser → Worker (Hono) → AI Gateway (custom domain) → Workers AI
                ↓                ↑ (management calls)
            KV (SETTINGS)      (gateway ID)
```

- **Chat traffic** routes through the AI Gateway **custom domain** (OpenAI-compatible endpoint)
- **Management calls** (stats, settings) use the gateway **ID** via Cloudflare REST API
- **KV** stores `custom_costs` and `gateway_settings`

## Key Files

| File | Purpose |
|---|---|
| `src/index.ts` | Hono Worker. Serves HTML UI, handles API routes. Chat calls custom domain `/compat/chat/completions`. Management calls use gateway ID via Cloudflare REST API. |
| `wrangler.toml` | Your local Worker config (gitignored). Copy from `wrangler.toml.example`. |
| `wrangler.toml.example` | Template with placeholder values for new users. |
| `scripts/create-gateway.ts` | CLI script to create the AI Gateway via Cloudflare API if missing. |
| `scripts/setup-limits.ts` | CLI script to create a spend limit rule on the gateway. |

## Environment / Secrets

Set via `wrangler secret put`:
- `CLOUDFLARE_API_TOKEN` — needs `AI Gateway:Edit`, `AI Gateway:Read`, `Workers AI:Read`
- `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account ID

KV namespace:
- `SETTINGS` — stores `custom_costs` and `gateway_settings` JSON

### Setup

1. Copy the template: `cp wrangler.toml.example wrangler.toml`
2. Edit `wrangler.toml` with your `account_id`, `GATEWAY_NAME`, `GATEWAY_ID`, and KV `id`
3. `wrangler.toml` is gitignored so your personal config never gets committed

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
  cf-aig-custom-cost: {json}      (optional)
  cf-aig-cache-ttl: {seconds}     (optional)
  cf-aig-metadata: {json}        (optional)
Body:
  { model: "workers-ai/@cf/meta/llama-3.1-8b-instruct", messages: [...] }
```
- Uses the AI Gateway custom domain directly
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

### Identity-Aware Gateway (Beta)
1. Add a [custom domain](https://developers.cloudflare.com/ai-gateway/configuration/custom-domains/) to the AI Gateway
2. Create a [Cloudflare Access application](https://developers.cloudflare.com/cloudflare-one/policies/access/) for that domain
3. Authenticate via SAML IDP (Okta, Entra, etc.)
4. AI Gateway automatically injects `cf.user_id` metadata on every request
5. Enables per-user spend limits, per-user rate limits, and User Insights behavioral baselines

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

## Testing

```bash
npm test
```

Tests use Vitest with a mock KV implementation and mocked `fetch` for upstream API calls. No Workers runtime or live Cloudflare API needed for unit tests.

Key test coverage:
- HTML UI rendering with env vars
- Custom Costs CRUD via mock KV
- Chat proxy with mocked upstream responses
- Caching headers (`cf-aig-cache-ttl`, `cf-aig-cache-key`, `cf-aig-skip-cache`)
- Custom metadata header (`cf-aig-metadata`)
- Custom cost header forwarding
- KV fallback for custom costs
- 429 rate-limit response handling

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

## Public Template Notes

- Copy `wrangler.toml.example` → `wrangler.toml` and fill in your values
- `wrangler.toml` is gitignored so your personal config never gets committed
- Default gateway name is `demo-gateway` (change via `GATEWAY_ID` var)
