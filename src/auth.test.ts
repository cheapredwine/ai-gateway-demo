import { describe, it, expect, vi, beforeEach } from "vitest";

const mockJwtVerify = vi.fn();
const mockCreateRemoteJWKSet = vi.fn((..._args: unknown[]) => "mock-jwks-fn");

vi.mock("jose", () => ({
  jwtVerify: (...args: unknown[]) => mockJwtVerify(...args),
  createRemoteJWKSet: (...args: unknown[]) => mockCreateRemoteJWKSet(...args),
}));

import { timingSafeEqual, isValidAccessRequest } from "./auth";

describe("timingSafeEqual", () => {
  it("returns true for identical strings", async () => {
    expect(await timingSafeEqual("same-secret", "same-secret")).toBe(true);
  });

  it("returns false for different strings of the same length", async () => {
    expect(await timingSafeEqual("secret-aaaa", "secret-bbbb")).toBe(false);
  });

  it("returns false for different-length strings (no early exit on length)", async () => {
    expect(await timingSafeEqual("short", "a-much-longer-value")).toBe(false);
  });

  it("returns false for empty vs non-empty", async () => {
    expect(await timingSafeEqual("", "nonempty")).toBe(false);
  });

  it("returns true for two empty strings", async () => {
    expect(await timingSafeEqual("", "")).toBe(true);
  });
});

describe("isValidAccessRequest", () => {
  beforeEach(() => {
    mockJwtVerify.mockReset();
    mockCreateRemoteJWKSet.mockClear();
  });

  it("returns false when token is missing", async () => {
    const result = await isValidAccessRequest(
      undefined,
      "https://team.cloudflareaccess.com",
      "aud-tag",
    );
    expect(result).toBe(false);
    expect(mockJwtVerify).not.toHaveBeenCalled();
  });

  it("returns false when team domain is not configured", async () => {
    const result = await isValidAccessRequest("some.jwt.token", undefined, "aud-tag");
    expect(result).toBe(false);
    expect(mockJwtVerify).not.toHaveBeenCalled();
  });

  it("returns false when AUD is not configured", async () => {
    const result = await isValidAccessRequest(
      "some.jwt.token",
      "https://team.cloudflareaccess.com",
      undefined,
    );
    expect(result).toBe(false);
    expect(mockJwtVerify).not.toHaveBeenCalled();
  });

  it("returns true when jose verifies the JWT successfully", async () => {
    mockJwtVerify.mockResolvedValue({ payload: { email: "jason@sherron.com" } });
    const result = await isValidAccessRequest(
      "valid.jwt.token",
      "https://team.cloudflareaccess.com",
      "aud-tag",
    );
    expect(result).toBe(true);
    expect(mockJwtVerify).toHaveBeenCalledWith("valid.jwt.token", "mock-jwks-fn", {
      issuer: "https://team.cloudflareaccess.com",
      audience: "aud-tag",
    });
  });

  it("returns false when jose rejects verification (bad signature, wrong aud, expired)", async () => {
    mockJwtVerify.mockRejectedValue(new Error("signature verification failed"));
    const result = await isValidAccessRequest(
      "forged.jwt.token",
      "https://team.cloudflareaccess.com",
      "aud-tag",
    );
    expect(result).toBe(false);
  });

  it("reuses the JWKS fetcher across calls for the same team domain", async () => {
    // Use a team domain unique to this test — the module-level JWKS cache in
    // auth.ts persists across tests in this file, so reusing a domain string
    // from another test above would already be cached, hiding a real bug.
    mockJwtVerify.mockResolvedValue({ payload: {} });
    await isValidAccessRequest("t1", "https://unique-cache-test.cloudflareaccess.com", "aud-tag");
    await isValidAccessRequest("t2", "https://unique-cache-test.cloudflareaccess.com", "aud-tag");
    expect(mockCreateRemoteJWKSet).toHaveBeenCalledTimes(1);
  });
});
