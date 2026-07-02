#!/usr/bin/env tsx
/**
 * Setup a spend limit rule on "Demo-Cost-Gateway" via Cloudflare API.
 *
 * Usage:
 *   GATEWAY_NAME=Demo-Cost-Gateway \
 *   CLOUDFLARE_API_TOKEN=xxx \
 *   CLOUDFLARE_ACCOUNT_ID=xxx \
 *   npx tsx scripts/setup-limits.ts --budget 1.00 --window 1d
 */

const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const GATEWAY_NAME = process.env.GATEWAY_NAME || "Demo-Cost-Gateway";

if (!TOKEN || !ACCOUNT) {
  console.error("Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID");
  process.exit(1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  let budget = 1.0;
  let window = "1d";
  let scope = "global";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--budget") budget = parseFloat(args[++i]);
    if (args[i] === "--window") window = args[++i];
    if (args[i] === "--scope") scope = args[++i];
  }
  return { budget, window, scope };
}

async function main() {
  const { budget, window, scope } = parseArgs();
  const base = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai-gateway/gateways/${GATEWAY_NAME}`;

  const dimensions: any = {};
  if (scope === "model") dimensions.model = { mode: "split_by_value" };
  if (scope === "provider") dimensions.provider = { mode: "split_by_value" };

  const res = await fetch(`${base}/spend-limits`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ budget, window, dimensions }),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error("Failed to create spend limit:", JSON.stringify(data, null, 2));
    process.exit(1);
  }
  console.log("Spend limit rule created:", JSON.stringify(data.result, null, 2));
}

main();
