import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * Constant-time string comparison for secret values (API tokens, etc.).
 * Hashes both values to a fixed size first so a byte-length mismatch can't
 * short-circuit the comparison and leak the secret's length through timing,
 * then compares every byte unconditionally (no early return) via XOR
 * accumulation.
 *
 * Deliberately NOT `crypto.subtle.timingSafeEqual` — that's a Workers-runtime
 * extension (https://developers.cloudflare.com/workers/runtime-apis/web-crypto/#timingsafeequal)
 * that doesn't exist in Node's Web Crypto, and this project's unit tests run
 * under plain Node (see AGENTS.md Testing). `crypto.subtle.digest` is
 * standard Web Crypto and works identically in both.
 */
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const bytesA = new Uint8Array(hashA);
  const bytesB = new Uint8Array(hashB);
  // Both are SHA-256 digests, always 32 bytes — the loop does the same
  // amount of work regardless of the inputs' original lengths or content.
  let diff = 0;
  for (let i = 0; i < bytesA.length; i++) {
    diff |= bytesA[i] ^ bytesB[i];
  }
  return diff === 0;
}

// JWKS caching here is safe under the "no global request state" rule: this is
// immutable, account-wide public key material shared by every request, not
// anything derived from a single request. `createRemoteJWKSet` itself handles
// refresh/expiry internally; the Map just avoids re-creating the fetcher per call.
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(teamDomain: string): ReturnType<typeof createRemoteJWKSet> {
  let jwks = jwksCache.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    jwksCache.set(teamDomain, jwks);
  }
  return jwks;
}

/**
 * Verifies the `Cf-Access-Jwt-Assertion` header Cloudflare Access attaches to
 * any request that passed an Access policy — human login or a service token,
 * both produce a validly-signed JWT (service tokens get `common_name` set and
 * `sub` empty; human logins get `email` set).
 *
 * This is deliberately NOT a path or Host-header check. Enabling
 * `workers_dev = true` serves every route — including `/demo/*` — on the
 * public, un-Access-protected `*.workers.dev` hostname too, and a client can
 * send any `Host` header it likes over HTTP. Only a cryptographically valid,
 * correctly-audienced JWT proves the request actually passed Access, because
 * forging one requires Cloudflare's private signing key.
 * https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
 */
export async function isValidAccessRequest(
  token: string | undefined,
  teamDomain: string | undefined,
  aud: string | undefined,
): Promise<boolean> {
  if (!token || !teamDomain || !aud) return false;
  try {
    await jwtVerify(token, getJwks(teamDomain), { issuer: teamDomain, audience: aud });
    return true;
  } catch {
    return false;
  }
}
