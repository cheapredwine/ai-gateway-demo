#!/usr/bin/env bash
# Multi-agent traffic generator for AI Gateway
# Discovers agent credentials from .dev.vars (AGENT_*_ID / AGENT_*_SECRET pairs)
# Each agent runs in parallel with different behavior patterns.
#
# Usage:
#   ./scripts/multi-agent-traffic.sh [total_requests_per_agent] [delay_ms]
#   ./scripts/multi-agent-traffic.sh 15 500
#
# For browser-based human identity (cf.user_id), open https://ai-gw.jsherron.com/demo
# and use the browser console snippet in scripts/traffic-snippet.js

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DEVVARS="$PROJECT_ROOT/.dev.vars"

# Source .dev.vars properly (KEY=VALUE format, no exports)
if [[ -f "$DEVVARS" ]]; then
  while IFS='=' read -r key value; do
    [[ -z "$key" || "$key" =~ ^# ]] && continue
    key="$(echo "$key" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    value="$(echo "$value" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [[ -n "$key" && -n "$value" ]] && export "$key"="$value"
  done < "$DEVVARS"
fi

TOKEN="${CLOUDFLARE_API_TOKEN:-}"
if [[ -z "$TOKEN" ]]; then
  echo "Error: CLOUDFLARE_API_TOKEN not set (check .dev.vars)"
  exit 1
fi

GATEWAY_URL="https://ai-gw.jsherron.com/compat/chat/completions"

# Discover agents from env vars
AGENTS=()
for id_var in $(env | grep '^AGENT_.*_ID=' | cut -d= -f1); do
  prefix="${id_var%_ID}"
  secret_var="${prefix}_SECRET"
  id_val="${!id_var:-}"
  secret_val="${!secret_var:-}"
  if [[ -n "$id_val" && -n "$secret_val" ]]; then
    name="${prefix#AGENT_}"
    AGENTS+=("$name")
  fi
done

if [[ ${#AGENTS[@]} -eq 0 ]]; then
  echo "Error: No AGENT_*_ID / AGENT_*_SECRET pairs found in .dev.vars"
  echo "Add them like: AGENT_ALPHA_ID=xxx.access AGENT_ALPHA_SECRET=yyy"
  exit 1
fi

echo "Discovered ${#AGENTS[@]} agents: ${AGENTS[*]}"

# Agent behavior profiles
MODELS=(
  "@cf/meta/llama-3.1-8b-instruct-fast"
  "@cf/meta/llama-3.2-3b-instruct"
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
  "@cf/qwen/qwen3-30b-a3b-fp8"
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b"
  "@cf/openai/gpt-oss-20b"
  "@cf/moonshotai/kimi-k2.6"
  "@cf/google/gemma-4-26b-a4b-it"
)

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

TEAMS=("engineering" "product" "sales" "support" "research" "ops")
SOURCES=("web-app" "mobile-app" "slack-bot" "api-client" "cron-job" "webhook")

REQUESTS_PER_AGENT="${1:-15}"
DELAY_MS="${2:-600}"

random_choice() {
  local arr=("$@")
  echo "${arr[$RANDOM % ${#arr[@]}]}"
}

random_float() {
  awk -v min="$1" -v max="$2" 'BEGIN{srand(); print min+rand()*(max-min)}'
}

run_agent() {
  local agent="$1"
  local id_var="AGENT_${agent}_ID"
  local secret_var="AGENT_${agent}_SECRET"
  local client_id="${!id_var}"
  local client_secret="${!secret_var}"

  # Each agent has a favored model + team (consistent identity)
  local favored_model favored_team
  favored_model=$(random_choice "${MODELS[@]}")
  favored_team=$(random_choice "${TEAMS[@]}" "${TEAMS[@]}")

  local logfile="/tmp/agent-${agent}.log"
  : > "$logfile"

  for ((i=1; i<=REQUESTS_PER_AGENT; i++)); do
    # 70% chance to use favored model, 30% random
    if (( RANDOM % 10 < 7 )); then
      local model="$favored_model"
    else
      local model=$(random_choice "${MODELS[@]}")
    fi

    local prompt=$(random_choice "${PROMPTS[@]}")
    local session_id="sess-$(echo "$agent" | tr '[:upper:]' '[:lower:]')-$(openssl rand -hex 3)"
    local source=$(random_choice "${SOURCES[@]}")
    local cost_in=$(random_float 0.000001 0.000010)
    local cost_out=$(random_float 0.000002 0.000020)

    local cache_hdr
    if (( RANDOM % 4 == 0 )); then
      cache_hdr="cf-aig-skip-cache: true"
    else
      local ttl=$(( (RANDOM % 10 + 1) * 60 ))
      cache_hdr="cf-aig-cache-ttl: ${ttl}"
    fi

    local timestamp
    timestamp=$(date '+%H:%M:%S')
    printf '[%s] %-10s req %2d/%d  model=%s  team=%s  source=%s\n' \
      "$timestamp" "$agent" "$i" "$REQUESTS_PER_AGENT" "$model" "$favored_team" "$source" | tee -a "$logfile"

    local http_code body
    body=$(mktemp)
    http_code=$(curl -s -o "$body" -w "%{http_code}" \
      -X POST "$GATEWAY_URL" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ${TOKEN}" \
      -H "CF-Access-Client-Id: ${client_id}" \
      -H "CF-Access-Client-Secret: ${client_secret}" \
      -H "cf-aig-custom-cost: {\"per_token_in\":${cost_in},\"per_token_out\":${cost_out}}" \
      -H "cf-aig-metadata: {\"session_id\":\"${session_id}\",\"agent\":\"${agent}\",\"team\":\"${favored_team}\",\"source\":\"${source}\"}" \
      -H "$cache_hdr" \
      -d "{\"model\":\"workers-ai/${model}\",\"messages\":[{\"role\":\"user\",\"content\":\"${prompt}\"}]}" \
      2>/dev/null || true)

    local tokens="?"
    if [[ -s "$body" ]]; then
      tokens=$(python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('usage',{}).get('total_tokens','?'))" < "$body" 2>/dev/null || echo "?")
    fi
    rm -f "$body"

    printf '  -> HTTP %s | %s tokens\n' "$http_code" "$tokens" | tee -a "$logfile"

    if (( i < REQUESTS_PER_AGENT )); then
      sleep "$(awk "BEGIN {print ${DELAY_MS}/1000}")"
    fi
  done

  echo "AGENT_DONE:$agent:$REQUESTS_PER_AGENT" >> "$logfile"
}

# Run all agents in parallel
PIDS=()
for agent in "${AGENTS[@]}"; do
  run_agent "$agent" &
  PIDS+=($!)
done

# Wait for all agents
for pid in "${PIDS[@]}"; do
  wait "$pid"
done

# Aggregate report
echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Multi-Agent Traffic Complete"
echo "═══════════════════════════════════════════════════════"
total=0
for agent in "${AGENTS[@]}"; do
  logfile="/tmp/agent-${agent}.log"
  done_line=$(grep "AGENT_DONE" "$logfile" 2>/dev/null || true)
  if [[ -n "$done_line" ]]; then
    count=$(echo "$done_line" | cut -d: -f3)
    total=$((total + count))
    printf "  %-12s %3d requests\n" "$agent:" "$count"
  fi
done
printf "  %-12s %3d total\n" "SUM:" "$total"
echo "═══════════════════════════════════════════════════════"
