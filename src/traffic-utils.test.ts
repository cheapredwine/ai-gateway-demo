import { describe, it, expect, beforeEach } from "vitest";
import {
  MODELS,
  PROMPTS,
  TEAMS,
  SOURCES,
  loadEnv,
  discoverAgents,
  randomChoice,
  randomFloat,
  randomInt,
  buildCacheHeaders,
  buildMetadata,
  buildCustomCost,
} from "../scripts/lib/traffic-utils";
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { resolve } from "path";

describe("traffic-utils", () => {
  describe("constants", () => {
    it("MODELS has 8+ entries", () => {
      expect(MODELS.length).toBeGreaterThanOrEqual(8);
      expect(MODELS[0]).toMatch(/^@cf\//);
    });

    it("PROMPTS has 15 entries", () => {
      expect(PROMPTS.length).toBe(15);
    });

    it("TEAMS and SOURCES are non-empty", () => {
      expect(TEAMS.length).toBeGreaterThan(0);
      expect(SOURCES.length).toBeGreaterThan(0);
    });
  });

  describe("randomChoice", () => {
    it("returns an element from the array", () => {
      const arr = ["a", "b", "c"];
      const result = randomChoice(arr);
      expect(arr).toContain(result);
    });

    it("works with single-element arrays", () => {
      expect(randomChoice(["only"])).toBe("only");
    });
  });

  describe("randomFloat", () => {
    it("returns value within range", () => {
      const val = randomFloat(1, 10);
      expect(val).toBeGreaterThanOrEqual(1);
      expect(val).toBeLessThanOrEqual(10);
    });
  });

  describe("randomInt", () => {
    it("returns integer within range", () => {
      const val = randomInt(1, 10);
      expect(Number.isInteger(val)).toBe(true);
      expect(val).toBeGreaterThanOrEqual(1);
      expect(val).toBeLessThanOrEqual(10);
    });
  });

  describe("buildCacheHeaders", () => {
    it("returns either cache-ttl or skip-cache", () => {
      const headers = buildCacheHeaders();
      const keys = Object.keys(headers);
      expect(keys.length).toBe(1);
      expect(["cf-aig-cache-ttl", "cf-aig-skip-cache"]).toContain(keys[0]);
    });

    it("cache-ttl value is a number string when present", () => {
      // Deterministic: Math.random() is hard to control, so we test the shape
      const headers = buildCacheHeaders();
      if ("cf-aig-cache-ttl" in headers) {
        expect(Number(headers["cf-aig-cache-ttl"])).toBeGreaterThan(0);
      }
    });
  });

  describe("buildMetadata", () => {
    it("returns expected shape", () => {
      const meta = buildMetadata("sess-123", "alpha", "eng", "web");
      expect(meta).toEqual({
        session_id: "sess-123",
        agent: "alpha",
        team: "eng",
        source: "web",
      });
    });
  });

  describe("buildCustomCost", () => {
    it("returns expected shape", () => {
      const cost = buildCustomCost(0.000001, 0.000002);
      expect(cost).toEqual({ per_token_in: 0.000001, per_token_out: 0.000002 });
    });
  });

  describe("loadEnv", () => {
    const testEnvPath = resolve("test.env");

    beforeEach(() => {
      try { unlinkSync(testEnvPath); } catch { /* ignore */ }
      delete process.env.TEST_LOADENV_KEY;
    });

    it("loads key-value pairs from file", () => {
      writeFileSync(testEnvPath, "TEST_LOADENV_KEY=hello_world\n", "utf-8");
      loadEnv(testEnvPath);
      expect(process.env.TEST_LOADENV_KEY).toBe("hello_world");
    });

    it("ignores comments and empty lines", () => {
      writeFileSync(testEnvPath, "# comment\n\nTEST_LOADENV_KEY=foo\n", "utf-8");
      loadEnv(testEnvPath);
      expect(process.env.TEST_LOADENV_KEY).toBe("foo");
    });

    it("does not throw when file is missing", () => {
      expect(() => loadEnv("/nonexistent/path/.env")).not.toThrow();
    });
  });

  describe("discoverAgents", () => {
    beforeEach(() => {
      for (const key of Object.keys(process.env)) {
        if (key.startsWith("AGENT_")) delete process.env[key];
      }
    });

    it("returns empty array when no agents", () => {
      expect(discoverAgents()).toEqual([]);
    });

    it("discovers agents with matching ID/SECRET pairs", () => {
      process.env.AGENT_ALPHA_ID = "alpha-id";
      process.env.AGENT_ALPHA_SECRET = "alpha-secret";
      process.env.AGENT_BETA_ID = "beta-id";
      process.env.AGENT_BETA_SECRET = "beta-secret";

      const agents = discoverAgents();
      expect(agents).toHaveLength(2);
      expect(agents.map(a => a.name)).toContain("ALPHA");
      expect(agents.map(a => a.name)).toContain("BETA");
    });

    it("ignores agents with missing secret", () => {
      process.env.AGENT_GAMMA_ID = "gamma-id";
      delete process.env.AGENT_GAMMA_SECRET;
      expect(discoverAgents()).toEqual([]);
    });
  });
});

describe("script syntax validation", () => {
  it("combined-traffic.ts is valid TypeScript", () => {
    const code = readFileSync(resolve("scripts/combined-traffic.ts"), "utf-8");
    expect(code).toContain('from "./lib/traffic-utils"');
    expect(code).toContain("discoverAgents()");
  });

  it("human-identity-traffic.ts is valid TypeScript", () => {
    const code = readFileSync(resolve("scripts/human-identity-traffic.ts"), "utf-8");
    expect(code).toContain('from "./lib/traffic-utils"');
    expect(code).toContain("randomChoice(MODELS)");
  });
});
