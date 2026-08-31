import { chromium } from "playwright";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  MODELS,
  PROMPTS,
  TEAMS,
  SOURCES,
  loadEnv,
  randomChoice,
  randomFloat,
  buildCacheHeaders,
  buildMetadata,
  buildCustomCost,
} from "./lib/traffic-utils";

/**
 * Human Identity Traffic Generator
 *
 * Opens a real browser, navigates to the Access-protected gateway,
 * and fires chat requests with randomized models, prompts, costs,
 * cache settings, and metadata.
 *
 * Auth: if auth.json exists, loads saved browser state (cookies).
 *       If not, opens browser for manual login, then saves state.
 *
 * Usage:
 *   npx tsx scripts/human-identity-traffic.ts [count] [delay_ms]
 *   npx tsx scripts/human-identity-traffic.ts 30 600
 */

const AUTH_STATE = resolve("scripts/auth.json");
const GATEWAY_URL = "https://ai-gw.jsherron.com/demo";

async function run(count: number, delay: number) {
  loadEnv(".dev.vars");

  const hasAuth = (() => {
    try {
      readFileSync(AUTH_STATE);
      return true;
    } catch {
      return false;
    }
  })();

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext(
    hasAuth ? { storageState: AUTH_STATE } : {}
  );
  const page = await context.newPage();

  await page.goto(GATEWAY_URL);

  if (!hasAuth) {
    console.log("No saved auth state. Please log in via the browser window.");
    console.log("Waiting for the demo page to load (up to 2 minutes)...");
    await page.waitForSelector('h1', { timeout: 120000 });
    console.log("Page loaded. Saving auth state...");
    await context.storageState({ path: AUTH_STATE });
    console.log("Auth state saved to", AUTH_STATE);
  } else {
    console.log("Loaded saved auth state.")
    try {
      await page.waitForSelector('h1', { timeout: 10000 });
    } catch {
      console.log("Saved auth may have expired. Delete scripts/auth.json and re-run.");
      await browser.close();
      process.exit(1);
    }
  }

  const favoredModel = randomChoice(MODELS);
  const favoredTeam = randomChoice(TEAMS);
  console.log(`Human agent: model=${favoredModel} team=${favoredTeam}`);
  console.log(`Firing ${count} requests with ${delay}ms delay...`);

  let success = 0;
  let blocked = 0;
  let errors = 0;

  for (let i = 0; i < count; i++) {
    const model = Math.random() < 0.7 ? favoredModel : randomChoice(MODELS);
    const prompt = randomChoice(PROMPTS);
    const sessionId = `sess-human-${Math.random().toString(36).slice(2, 8)}`;
    const team = Math.random() < 0.7 ? favoredTeam : randomChoice(TEAMS);
    const source = randomChoice(SOURCES);
    const cost = buildCustomCost(randomFloat(0.000001, 0.000010), randomFloat(0.000002, 0.000020));
    const cache = buildCacheHeaders();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "cf-aig-custom-cost": JSON.stringify(cost),
      "cf-aig-metadata": JSON.stringify(buildMetadata(sessionId, "human-browser", team, source)),
      ...cache,
    };

    try {
      const res = await page.evaluate(
        async ({ url, headers, body }) => {
          const r = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
          });
          const data = (await r.json().catch(() => ({}))) as any;
          return {
            status: r.status,
            tokens: data.usage?.total_tokens ?? "?",
            model: data.model ?? "?",
            cacheStatus: r.headers.get("cf-aig-cache-status") ?? "-",
          };
        },
        {
          url: "/compat/chat/completions",
          headers,
          body: {
            model: `workers-ai/${model}`,
            messages: [{ role: "user", content: prompt }],
          },
        }
      );

      const time = new Date().toLocaleTimeString();
      if (res.status === 200) {
        console.log(`[${time}] #${i + 1}/${count} OK | ${res.tokens} tokens | cache=${res.cacheStatus} | ${res.model}`);
        success++;
      } else if (res.status === 429) {
        console.log(`[${time}] #${i + 1}/${count} BLOCKED (429) | rate limited`);
        blocked++;
      } else {
        console.log(`[${time}] #${i + 1}/${count} ERR ${res.status}`);
        errors++;
      }
    } catch (e: any) {
      console.log(`[${new Date().toLocaleTimeString()}] #${i + 1}/${count} NET ERR: ${e.message}`);
      errors++;
    }

    if (i < count - 1) {
      await page.waitForTimeout(delay);
    }
  }

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  Human Identity Traffic Complete");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Success:   ${success}`);
  console.log(`  Rate-lim:  ${blocked}`);
  console.log(`  Errors:    ${errors}`);
  console.log(`  Total:     ${count}`);
  console.log("═══════════════════════════════════════════════════════");

  await browser.close();
}

const count = parseInt(process.argv[2] ?? "20", 10) || 20;
const delay = parseInt(process.argv[3] ?? "800", 10) || 800;
run(count, delay).catch((err) => {
  console.error(err);
  process.exit(1);
});
