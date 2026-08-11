#!/usr/bin/env tsx
/**
 * Create the AI Gateway "Demo-Cost-Gateway" via Cloudflare API.
 *
 * Required env vars:
 *   CLOUDFLARE_API_TOKEN  (with AI Gateway - Edit)
 *   CLOUDFLARE_ACCOUNT_ID
 */

export {};

const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const GATEWAY_NAME = process.env.GATEWAY_NAME || "Demo-Cost-Gateway";

if (!TOKEN || !ACCOUNT) {
  console.error("Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID");
  process.exit(1);
}

async function main() {
  const base = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}`;

  // Check if gateway exists
  const check = await fetch(`${base}/ai-gateway/gateways/${GATEWAY_NAME}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });

  if (check.status === 404) {
    console.log(`Gateway "${GATEWAY_NAME}" not found. Creating...`);
    const create = await fetch(`${base}/ai-gateway`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: GATEWAY_NAME, name: GATEWAY_NAME }),
    });
    const data = await create.json() as { result?: unknown; errors?: { message: string }[] };
    if (!create.ok) {
      console.error("Create failed:", JSON.stringify(data, null, 2));
      process.exit(1);
    }
    console.log("Created gateway:", JSON.stringify(data.result, null, 2));
  } else {
    const data = await check.json() as { result?: unknown };
    console.log(`Gateway "${GATEWAY_NAME}" already exists.`);
    console.log(JSON.stringify(data.result, null, 2));
  }
}

main();
