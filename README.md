# AI Gateway PowerShell Demo

A complete Cloudflare AI Gateway demo with a web client that generates traffic through the gateway using **Cloudflare Workers AI**. Supports **Custom Costs** (per-request token pricing overrides) and **Spend Limits** (gateway-level budget enforcement).

---

## Architecture

```
┌─────────────┐      ┌──────────────────────┐      ┌─────────────────┐
│  Web Client │─────▶│  ai-gateway-demo  │─────▶│  AI Gateway     │
│  (Browser)  │      │  (Cloudflare Worker)   │      │  demo-gateway
└─────────────┘      └──────────────────────┘      └─────────────────┘
                            │                              │
                            ▼                              ▼
                      ┌──────────┐                  ┌──────────────┐
                      │  KV      │                  │  Workers AI  │
                      │ SETTINGS │                  └──────────────┘
                      └──────────┘
```

- **Worker** serves the web UI and proxies chat requests to AI Gateway via the Cloudflare REST API.
- **KV** persists custom cost settings between requests.
- **AI Gateway** `demo-gateway` observes traffic, applies custom costs, and enforces spend limits on Workers AI inference.

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

# Create KV namespace and paste ID into wrangler.toml
npx wrangler kv namespace create SETTINGS

# Set secrets
npx wrangler secret put CLOUDFLARE_API_TOKEN
npx wrangler secret put CLOUDFLARE_ACCOUNT_ID

# Create the AI Gateway
CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<id> npx tsx scripts/create-gateway.ts

# Deploy
npm run deploy
```

Visit the deployed Worker URL to open the web client.

---

## Web UI Panels

| Panel | Purpose |
|---|---|
| **Traffic Generator** | Send single or burst chat requests to Workers AI through the gateway. Choose from 15+ models or enter a custom `@cf/` model name. |
| **Custom Costs** | Set `per_token_in` and `per_token_out` values. Injected as the `cf-aig-custom-cost` header on every request. |
| **Spend Limits** | Create gateway-level spend limit rules (budget + time window + scope) via the Cloudflare API. |
| **Gateway Stats** | Pull live request / token / cost stats from the gateway. |

---

## How Custom Costs Work

The demo stores your custom cost values in KV. On every chat request the Worker reads them and forwards the header:

```http
cf-aig-custom-cost: {"per_token_in":0.000001,"per_token_out":0.000002}
```

AI Gateway uses these values instead of the public model pricing when calculating cost metrics and spend limit consumption.

Change values in the web UI at any time; the next request uses the new pricing.

---

## How Spend Limits Work

Spend limits are configured **on the gateway itself** via the Cloudflare API. When you click *Apply to Gateway* in the web UI, the Worker creates a rule such as:

- Budget: `$1.00`
- Window: `1 day`
- Scope: `global` (or per-model / per-provider)

Once cumulative estimated spend hits the budget, AI Gateway returns **HTTP 429** and the demo client shows:

```
BLOCKED: Spend limit exceeded (429)
```

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Web UI |
| `POST` | `/api/chat` | Proxy chat request to Workers AI via AI Gateway |
| `GET` | `/api/costs` | Read current custom costs from KV |
| `POST` | `/api/costs` | Save custom costs to KV |
| `GET` | `/api/limits` | Read spend limit config from KV |
| `POST` | `/api/limits` | Create spend limit rule on gateway |
| `GET` | `/api/stats` | Fetch gateway stats from Cloudflare API |
| `GET` | `/api/bootstrap` | Ensure gateway exists |

---

## Token Permissions

| Permission | Scope | Why |
|---|---|---|
| `AI Gateway — Edit` | Account | Create gateway, create/delete spend limit rules. |
| `AI Gateway — Read` | Account | Read gateway stats and existing rules. |
| `Workers AI — Read` | Account | Required for Unified Billing / Workers AI inference. |

Create token at: https://dash.cloudflare.com/?to=/:account/api-tokens

---

## Local Development

```bash
cat > .dev.vars <<EOF
CLOUDFLARE_API_TOKEN=your_token
CLOUDFLARE_ACCOUNT_ID=your_account_id
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
| `429 Too Many Requests` from chat | Expected when a spend limit is exceeded. Wait for the window to reset, or raise the budget. |
| `Model not found` | Ensure the model name uses the `@cf/` prefix (e.g. `@cf/meta/llama-3.1-8b-instruct`). |
| `Workers AI unauthorized` | Add **Workers AI — Read** permission to your API token. |

---

## Project Structure

```
ai-gateway-demo/
├── src/
│   └── index.ts          # Hono Worker (UI + API)
├── scripts/
│   ├── create-gateway.ts # CLI: create demo-gateway
│   └── setup-limits.ts   # CLI: create spend limit rule
├── wrangler.toml         # Worker config (KV binding, vars)
├── tsconfig.json
├── package.json
├── README.md
└── AGENTS.md             # Agent context for future sessions
```
