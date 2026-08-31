#!/usr/bin/env bash
# Generate realistic-looking traffic through Cloudflare Access-authenticated gateway.
# Requires: cloudflared (already logged in via `cloudflared access login https://ai-gw.jsherron.com`)
# Env vars from .dev.vars or environment:
#   CLOUDFLARE_API_TOKEN
#   CLOUDFLARE_ACCOUNT_ID (optional, not used for gateway calls)

set -euo pipefail

TOKEN="${CLOUDFLARE_API_TOKEN:-}"
if [[ -z "$TOKEN" ]]; then
  echo "Error: CLOUDFLARE_API_TOKEN not set"
  exit 1
fi

GATEWAY_URL="https://ai-gw.jsherron.com/compat/chat/completions"

# Realistic mix of models
MODELS=(
  "@cf/meta/llama-3.1-8b-instruct-fast"
  "@cf/meta/llama-3.2-3b-instruct"
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
  "@cf/mistral/mistral-small-3.1-24b-instruct"
  "@cf/qwen/qwen3-30b-a3b-fp8"
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b"
  "@cf/openai/gpt-oss-20b"
  "@cf/moonshotai/kimi-k2.6"
  "@cf/google/gemma-4-26b-a4b-it"
)

# Varied prompts (short to medium, different domains)
PROMPTS=(
  "Explain Cloudflare Workers in one sentence."
  "What is edge computing and why does it matter?"
  "Summarize the benefits of serverless architecture."
  "How does a CDN improve website performance?"
  "Write a haiku about artificial intelligence."
  "List three types of machine learning with brief descriptions."
  "What is the capital of France and what is it known for?"
  "Describe the water cycle in two sentences."
  "Why is caching important for web applications?"
  "What does API stand for and give an example."
  "Explain recursion to a five-year-old."
  "What are the differences between SQL and NoSQL databases?"
  "How do load balancers work?"
  "What is the difference between TCP and UDP?"
  "Describe the concept of zero trust security."
)

# Metadata personas (simulates different users/teams)
TEAMS=("engineering" "product" "sales" "support" "research")
SOURCES=("web-app" "mobile-app" "slack-bot" "api-client")

COUNT="${1:-20}"
DELAY_MS="${2:-800}"

random_choice() {
  local arr=("$@")
  local idx=$((RANDOM % ${#arr[@]}))
  echo "${arr[$idx]}"
}

random_float() {
  awk -v min="$1" -v max="$2" 'BEGIN{srand(); print min+rand()*(max-min)}'
}

for ((i=1; i<=COUNT; i++)); do
  MODEL=$(random_choice "${MODELS[@]}")
  PROMPT=$(random_choice "${PROMPTS[@]}")
  SESSION_ID="sess-$(openssl rand -hex 4)"
  TEAM=$(random_choice "${TEAMS[@]}")
  SOURCE=$(random_choice "${SOURCES[@]}")

  # Randomize custom costs slightly
  COST_IN=$(random_float 0.000001 0.000010)
  COST_OUT=$(random_float 0.000002 0.000020)

  # Random cache TTL (sometimes skip cache)
  if (( RANDOM % 3 == 0 )); then
    CACHE_HDR="cf-aig-skip-cache: true"
  else
    TTL=$(( (RANDOM % 10 + 1) * 60 ))
    CACHE_HDR="cf-aig-cache-ttl: ${TTL}"
  fi

  echo "[$i/$COUNT] POST ${MODEL} | team=${TEAM} | source=${SOURCE} | session=${SESSION_ID}"

  HTTP_CODE=$(cloudflared access curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$GATEWAY_URL" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "cf-aig-custom-cost: {\"per_token_in\":${COST_IN},\"per_token_out\":${COST_OUT}}" \
    -H "cf-aig-metadata: {\"session_id\":\"${SESSION_ID}\",\"team\":\"${TEAM}\",\"source\":\"${SOURCE}\"}" \
    -H "$CACHE_HDR" \
    -d "{\"model\":\"workers-ai/${MODEL}\",\"messages\":[{\"role\":\"user\",\"content\":\"${PROMPT}\"}]}" \
    2>/dev/null || true)

  echo "  -> HTTP ${HTTP_CODE}"

  if (( i < COUNT )); then
    sleep "$(awk "BEGIN {print ${DELAY_MS}/1000}")"
  fi
done

echo "Done. Sent ${COUNT} requests."
