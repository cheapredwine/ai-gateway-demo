# Agent Context: AI Gateway Demo

## Project Overview

Single Cloudflare Worker that serves a web UI for demonstrating AI Gateway features:
- **Custom Costs**: Override per-token pricing via `cf-aig-custom-cost` header
- **Spend Limits**: Gateway-level budget enforcement that returns 429 when exceeded
- **Workers AI**: All traffic routes to Cloudflare Workers AI models via the REST API

## Architecture

```
Browser → Worker (Hono) → AI Gateway (Demo-Cost-Gateway) → Workers AI
                ↓
            KV (SETTINGS)
```

## Key Files

| File | Purpose |
|---|---|
| `src/index.ts` | Hono Worker. Serves HTML UI, handles API routes, proxies to Workers AI via `api.cloudflare.com/client/v4/accounts/{id}/ai/v1/chat/completions` with `cf-aig-gateway-id` header. |
| `wrangler.toml` | Worker config. KV binding `SETTINGS`. Var `GATEWAY_NAME = "demo-gateway"`. |
| `scripts/create-gateway.ts` | CLI script to create the AI Gateway via Cloudflare API if missing. |
| `scripts/setup-limits.ts` | CLI script to create a spend limit rule on the gateway. |

## Environment / Secrets

Set via `wrangler secret put`:
- `CLOUDFLARE_API_TOKEN` — needs `AI Gateway:Edit`, `AI Gateway:Read`, `Workers AI:Read`
- `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account ID

KV namespace:
- `SETTINGS` — stores `custom_costs` and `spend_limits` JSON

## API Token Permissions

Critical: token MUST have:
1. `AI Gateway — Edit` (create gateway, manage spend limits)
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

### Workers AI REST API Path
```
POST https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1/chat/completions
Headers:
  Authorization: Bearer {CLOUDFLARE_API_TOKEN}
  cf-aig-gateway-id: Demo-Cost-Gateway
  cf-aig-custom-cost: {json}  (optional)
Body:
  { model: "@cf/meta/llama-3.1-8b-instruct", messages: [...] }
```

### Spend Limits API Path
```
POST /client/v4/accounts/{account_id}/ai-gateway/gateways/{gateway_name}/spend-limits
Body:
  { budget: 1.0, window: "1d", dimensions: {} }
```

### Model Selector
- 15+ pre-populated Workers AI models organized by provider (Meta, Mistral, DeepSeek, Google, Qwen, Other)
- "Custom model..." option reveals text input for any `@cf/` model
- Model value sent directly to Workers AI API — must use valid `@cf/` prefix

## Common Tasks

### Add a new model to the dropdown
Edit the `<select id="model">` in `src/index.ts` HTML string. Add `<option value="@cf/...">Display Name</option>` inside the appropriate `<optgroup>`.

### Change default gateway name
Update `GATEWAY_NAME` in `wrangler.toml` and `src/index.ts` subtitle text.

### Reset spend limits
POST to `/api/limits` with `{ enabled: false }` or run the setup script with different args.

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

## Public Template Notes

- `wrangler.toml` uses placeholder values. Set `account_id` and KV `id` before deploying.
- Default gateway name is `demo-gateway` (change via `GATEWAY_NAME` var).
