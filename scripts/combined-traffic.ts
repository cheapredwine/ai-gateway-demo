import { spawn } from "child_process";
import {
  MODELS,
  PROMPTS,
  TEAMS,
  SOURCES,
  AgentCreds,
  loadEnv,
  discoverAgents,
  randomChoice,
  randomFloat,
  buildCacheHeaders,
  buildMetadata,
  buildCustomCost,
} from "./lib/traffic-utils";

/**
 * Combined Traffic Orchestrator
 *
 * Runs both service-token agents AND human-identity traffic
 * against the AI Gateway simultaneously.
 *
 * Human identity uses cloudflared access curl (cf.user_id).
 * Service agents use direct curl with CF-Access-Client-Id/Secret (cf.common_name).
 *
 * Usage:
 *   npx tsx scripts/combined-traffic.ts [options]
 *
 * Options (env vars):
 *   AGENT_COUNT=4          Number of agents to run
 *   AGENT_REQS=15          Requests per agent
 *   AGENT_DELAY=600        Delay between agent requests (ms)
 *   HUMAN_REQS=20          Human identity requests
 *   HUMAN_DELAY=800        Human request delay (ms)
 *   SKIP_HUMAN=true        Skip human identity traffic
 *   SKIP_AGENTS=true       Skip service-token agents
 *
 * Examples:
 *   npx tsx scripts/combined-traffic.ts
 *   SKIP_HUMAN=true npx tsx scripts/combined-traffic.ts
 *   AGENT_REQS=30 HUMAN_REQS=30 npx tsx scripts/combined-traffic.ts
 */

const GATEWAY_URL = "https://ai-gw.jsherron.com/compat/chat/completions";

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Service Token Traffic ──────────────────────────────────────────────────

async function runAgent(agent: AgentCreds, count: number, delay: number, results: { ok: number; blocked: number; err: number }) {
  const favoredModel = randomChoice(MODELS);
  const favoredTeam = randomChoice(TEAMS);
  const token = process.env.CLOUDFLARE_API_TOKEN;

  for (let i = 0; i < count; i++) {
    const model = Math.random() < 0.7 ? favoredModel : randomChoice(MODELS);
    const prompt = randomChoice(PROMPTS);
    const sessionId = `sess-${agent.name.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`;
    const team = Math.random() < 0.7 ? favoredTeam : randomChoice(TEAMS);
    const source = randomChoice(SOURCES);
    const cost = buildCustomCost(randomFloat(0.000001, 0.000010), randomFloat(0.000002, 0.000020));

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "CF-Access-Client-Id": agent.id,
      "CF-Access-Client-Secret": agent.secret,
      "cf-aig-custom-cost": JSON.stringify(cost),
      "cf-aig-metadata": JSON.stringify(buildMetadata(sessionId, agent.name, team, source)),
      ...buildCacheHeaders(),
    };

    try {
      const res = await fetch(GATEWAY_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: `workers-ai/${model}`,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      const time = new Date().toLocaleTimeString();
      if (res.status === 200) {
        const data = (await res.json().catch(() => ({}))) as any;
        const tokens = data.usage?.total_tokens ?? "?";
        console.log(`[AGENT ${agent.name}] ${time} #${i + 1}/${count} OK | ${tokens} tokens | ${model}`);
        results.ok++;
      } else if (res.status === 429) {
        console.log(`[AGENT ${agent.name}] ${time} #${i + 1}/${count} BLOCKED (429)`);
        results.blocked++;
      } else {
        console.log(`[AGENT ${agent.name}] ${time} #${i + 1}/${count} ERR ${res.status}`);
        results.err++;
      }
    } catch (e: any) {
      console.log(`[AGENT ${agent.name}] ${new Date().toLocaleTimeString()} #${i + 1}/${count} NET ERR: ${e.message}`);
      results.err++;
    }

    if (i < count - 1) await sleep(delay);
  }
}

// ─── Human Identity Traffic (cloudflared access curl) ─────────────────────────

async function runHumanTraffic(count: number, delay: number, results: { ok: number; blocked: number; err: number }) {
  const favoredModel = randomChoice(MODELS);
  const favoredTeam = randomChoice(TEAMS);
  const token = process.env.CLOUDFLARE_API_TOKEN;

  console.log(`[HUMAN] model=${favoredModel} team=${favoredTeam} | Firing ${count} requests via cloudflared...`);

  for (let i = 0; i < count; i++) {
    const model = Math.random() < 0.7 ? favoredModel : randomChoice(MODELS);
    const prompt = randomChoice(PROMPTS);
    const sessionId = `sess-human-${Math.random().toString(36).slice(2, 8)}`;
    const team = Math.random() < 0.7 ? favoredTeam : randomChoice(TEAMS);
    const source = randomChoice(SOURCES);
    const cost = buildCustomCost(randomFloat(0.000001, 0.000010), randomFloat(0.000002, 0.000020));
    const cacheHdr = Object.entries(buildCacheHeaders())
      .map(([k, v]) => `-H "${k}: ${v}"`)
      .join(" ");

    const cmd = `cloudflared access curl "${GATEWAY_URL}" \
      -X POST \
      -s -w "\\nHTTP_CODE:%{http_code}" -o - \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ${token}" \
      -H "cf-aig-custom-cost: ${JSON.stringify(cost).replace(/"/g, '\\"')}" \
      -H "cf-aig-metadata: ${JSON.stringify(buildMetadata(sessionId, "human-cloudflared", team, source)).replace(/"/g, '\\"')}" \
      ${cacheHdr} \
      -d '{"model":"workers-ai/${model}","messages":[{"role":"user","content":"${prompt}"}]}' 2>/dev/null`;

    try {
      const output = await new Promise<string>((resolve, reject) => {
        const child = spawn("bash", ["-c", cmd], { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => stdout += d.toString());
        child.stderr.on("data", (d) => stderr += d.toString());
        child.on("close", (code) => {
          if (code !== 0 && code !== null) reject(new Error(stderr || `exit ${code}`));
          else resolve(stdout);
        });
      });

      const lines = output.trim().split("\n");
      const httpLine = lines.find((l) => l.startsWith("HTTP_CODE:"));
      const httpCode = httpLine ? parseInt(httpLine.replace("HTTP_CODE:", ""), 10) : 0;
      const bodyLine = lines.filter((l) => !l.startsWith("HTTP_CODE:")).pop() || "";
      let tokens = "?";
      try {
        const data = JSON.parse(bodyLine) as any;
        tokens = data.usage?.total_tokens ?? "?";
      } catch {
        // ignore
      }

      const time = new Date().toLocaleTimeString();
      if (httpCode === 200) {
        console.log(`[HUMAN] ${time} #${i + 1}/${count} OK | ${tokens} tokens | ${model}`);
        results.ok++;
      } else if (httpCode === 429) {
        console.log(`[HUMAN] ${time} #${i + 1}/${count} BLOCKED (429)`);
        results.blocked++;
      } else {
        console.log(`[HUMAN] ${time} #${i + 1}/${count} ERR ${httpCode}`);
        results.err++;
      }
    } catch (e: any) {
      console.log(`[HUMAN] ${new Date().toLocaleTimeString()} #${i + 1}/${count} NET ERR: ${e.message}`);
      results.err++;
    }

    if (i < count - 1) await sleep(delay);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  loadEnv(".dev.vars");

  const skipHuman = process.env.SKIP_HUMAN === "true";
  const skipAgents = process.env.SKIP_AGENTS === "true";
  const agentReqs = parseInt(process.env.AGENT_REQS ?? "15", 10) || 15;
  const agentDelay = parseInt(process.env.AGENT_DELAY ?? "600", 10) || 600;
  const humanReqs = parseInt(process.env.HUMAN_REQS ?? "20", 10) || 20;
  const humanDelay = parseInt(process.env.HUMAN_DELAY ?? "800", 10) || 800;

  console.log("═══════════════════════════════════════════════════════");
  console.log("  Combined AI Gateway Traffic Orchestrator");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Service agents: ${skipAgents ? "SKIPPED" : `${agentReqs} req/agent`}`);
  console.log(`  Human identity: ${skipHuman ? "SKIPPED" : `${humanReqs} requests`}`);
  console.log("═══════════════════════════════════════════════════════\n");

  const agentResults = { ok: 0, blocked: 0, err: 0 };
  const humanResults = { ok: 0, blocked: 0, err: 0 };

  const promises: Promise<void>[] = [];

  if (!skipAgents) {
    const agents = discoverAgents();
    if (agents.length === 0) {
      console.log("Warning: No AGENT_* credentials found. Skipping agent traffic.");
    } else {
      console.log(`Starting ${agents.length} service-token agents...`);
      for (const agent of agents) {
        promises.push(runAgent(agent, agentReqs, agentDelay, agentResults));
      }
    }
  }

  if (!skipHuman) {
    promises.push(runHumanTraffic(humanReqs, humanDelay, humanResults));
  }

  await Promise.all(promises);

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  Combined Traffic Complete");
  console.log("═══════════════════════════════════════════════════════");
  if (!skipAgents) {
    console.log(`  Agents:   OK=${agentResults.ok}  429=${agentResults.blocked}  ERR=${agentResults.err}`);
  }
  if (!skipHuman) {
    console.log(`  Human:    OK=${humanResults.ok}  429=${humanResults.blocked}  ERR=${humanResults.err}`);
  }
  console.log("═══════════════════════════════════════════════════════");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
