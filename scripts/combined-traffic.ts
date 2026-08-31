import { spawn } from "child_process";
import { readFileSync } from "fs";
import { resolve } from "path";

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

const MODELS = [
  "@cf/meta/llama-3.1-8b-instruct-fast",
  "@cf/meta/llama-3.2-3b-instruct",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/qwen/qwen3-30b-a3b-fp8",
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
  "@cf/openai/gpt-oss-20b",
  "@cf/moonshotai/kimi-k2.6",
  "@cf/google/gemma-4-26b-a4b-it",
];

const PROMPTS = [
  "Explain Cloudflare Workers in one sentence.",
  "What is edge computing and why does it matter?",
  "Summarize the benefits of serverless architecture.",
  "How does a CDN improve website performance?",
  "Write a haiku about artificial intelligence.",
  "List three types of machine learning with brief descriptions.",
  "What is the capital of France and what is it known for?",
  "Describe the water cycle in two sentences.",
  "Why is caching important for web applications?",
  "What does API stand for and give an example.",
  "Explain recursion to a five-year-old.",
  "What are the differences between SQL and NoSQL databases?",
  "How do load balancers work?",
  "What is the difference between TCP and UDP?",
  "Describe the concept of zero trust security.",
];

const TEAMS = ["engineering", "product", "sales", "support", "research", "ops"];
const SOURCES = ["web-app", "mobile-app", "slack-bot", "api-client", "cron-job", "webhook"];

interface AgentCreds {
  name: string;
  id: string;
  secret: string;
}

function loadEnv(path: string) {
  try {
    const lines = readFileSync(path, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      process.env[key] = value;
    }
  } catch {
    // no .dev.vars
  }
}

function discoverAgents(): AgentCreds[] {
  const agents: AgentCreds[] = [];
  for (const key of Object.keys(process.env)) {
    const m = key.match(/^AGENT_(.+)_ID$/);
    if (!m) continue;
    const name = m[1];
    const secretKey = `AGENT_${name}_SECRET`;
    const id = process.env[key];
    const secret = process.env[secretKey];
    if (id && secret) agents.push({ name, id, secret });
  }
  return agents;
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomFloat(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

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
    const costIn = randomFloat(0.000001, 0.000010);
    const costOut = randomFloat(0.000002, 0.000020);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "CF-Access-Client-Id": agent.id,
      "CF-Access-Client-Secret": agent.secret,
      "cf-aig-custom-cost": JSON.stringify({ per_token_in: costIn, per_token_out: costOut }),
      "cf-aig-metadata": JSON.stringify({ session_id: sessionId, agent: agent.name, team, source }),
    };

    if (Math.random() > 0.25) {
      headers["cf-aig-cache-ttl"] = String(Math.floor(randomFloat(60, 600)));
    } else {
      headers["cf-aig-skip-cache"] = "true";
    }

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
    const costIn = randomFloat(0.000001, 0.000010);
    const costOut = randomFloat(0.000002, 0.000020);

    const cacheHdr = Math.random() > 0.25
      ? `-H "cf-aig-cache-ttl: ${Math.floor(randomFloat(60, 600))}"`
      : `-H "cf-aig-skip-cache: true"`;

    const cmd = `cloudflared access curl "${GATEWAY_URL}" \
      -X POST \
      -s -w "\\nHTTP_CODE:%{http_code}" -o - \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ${token}" \
      -H "cf-aig-custom-cost: {\\"per_token_in\\":${costIn},\\"per_token_out\\":${costOut}}" \
      -H "cf-aig-metadata: {\\"session_id\\":\\"${sessionId}\\",\\"team\\":\\"${team}\\",\\"source\\":\\"${source}\\",\\"agent\\":\\"human-cloudflared\\"}" \
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
