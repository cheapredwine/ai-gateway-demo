// Paste into browser console on https://ai-gw.jsherron.com/demo
// Requires active Access session (log in first)

(async () => {
  const models = [
    "@cf/meta/llama-3.1-8b-instruct-fast",
    "@cf/meta/llama-3.2-3b-instruct",
    "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    "@cf/qwen/qwen3-30b-a3b-fp8",
    "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
    "@cf/openai/gpt-oss-20b",
    "@cf/moonshotai/kimi-k2.6",
    "@cf/google/gemma-4-26b-a4b-it"
  ];

  const prompts = [
    "Explain Cloudflare Workers in one sentence.",
    "What is edge computing?",
    "Summarize the benefits of serverless.",
    "How does a CDN work?",
    "Write a haiku about AI.",
    "List three types of machine learning.",
    "What is the capital of France?",
    "Describe the water cycle briefly.",
    "Why is caching important?",
    "What does API stand for?"
  ];

  function random(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  async function fire() {
    const model = random(models);
    const prompt = random(prompts);
    const sessionId = "sess-" + Math.random().toString(36).slice(2, 10);
    const costIn = 0.000001 + Math.random() * 0.000009;
    const costOut = 0.000002 + Math.random() * 0.000018;
    const cacheTTL = Math.random() > 0.5 ? 300 : 60;

    const headers = {
      "Content-Type": "application/json",
      "cf-aig-custom-cost": JSON.stringify({ per_token_in: costIn, per_token_out: costOut }),
      "cf-aig-cache-ttl": String(cacheTTL),
      "cf-aig-metadata": JSON.stringify({ session_id: sessionId, team: "demo", source: "console-traffic" })
    };

    try {
      const res = await fetch("/compat/chat/completions", {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: "workers-ai/" + model,
          messages: [{ role: "user", content: prompt }]
        })
      });
      const data = await res.json();
      const tokens = data.usage ? data.usage.total_tokens : "?";
      console.log(`[${new Date().toLocaleTimeString()}] ${res.status} | ${tokens} tokens | ${model}`);
    } catch (e) {
      console.error("Network error:", e.message);
    }
  }

  const count = parseInt(prompt("How many requests? (default 20)", "20"), 10) || 20;
  const delay = parseInt(prompt("Delay between requests in ms? (default 800)", "800"), 10) || 800;

  console.log(`Firing ${count} requests with ${delay}ms delay...`);
  for (let i = 0; i < count; i++) {
    await fire();
    if (i < count - 1) await new Promise(r => setTimeout(r, delay));
  }
  console.log("Done.");
})();
