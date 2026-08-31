/**
 * Shared traffic generation utilities for AI Gateway demo scripts.
 * Pure functions + constants. No side effects.
 */

export const MODELS = [
  "@cf/meta/llama-3.1-8b-instruct-fast",
  "@cf/meta/llama-3.2-3b-instruct",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/qwen/qwen3-30b-a3b-fp8",
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
  "@cf/openai/gpt-oss-20b",
  "@cf/moonshotai/kimi-k2.6",
  "@cf/google/gemma-4-26b-a4b-it",
];

export const PROMPTS = [
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

export const TEAMS = ["engineering", "product", "sales", "support", "research", "ops"];
export const SOURCES = ["web-app", "mobile-app", "slack-bot", "api-client", "cron-job", "webhook"];

export interface AgentCreds {
  name: string;
  id: string;
  secret: string;
}

export function loadEnv(path: string): void {
  try {
    const { readFileSync } = require("fs");
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

export function discoverAgents(): AgentCreds[] {
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

export function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function randomFloat(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function randomInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

export function buildCacheHeaders(): Record<string, string> {
  if (Math.random() > 0.25) {
    return { "cf-aig-cache-ttl": String(Math.floor(randomFloat(60, 600))) };
  }
  return { "cf-aig-skip-cache": "true" };
}

export function buildMetadata(sessionId: string, agent: string, team: string, source: string): Record<string, unknown> {
  return { session_id: sessionId, agent, team, source };
}

export function buildCustomCost(perTokenIn: number, perTokenOut: number): Record<string, number> {
  return { per_token_in: perTokenIn, per_token_out: perTokenOut };
}
