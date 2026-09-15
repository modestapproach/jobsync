// Cloudflare Access single sign-on. jobs.teddessert.com sits behind Access
// (Google login); every request that reaches the Worker carries Access's
// signed identity in `Cf-Access-Jwt-Assertion`. Verifying that JWT here
// (signature, audience, issuer, expiry) lets JobSync sign the owner in
// without a second password, and makes a forged or replayed header useless:
// only Access holds the signing keys.

type Jwk = JsonWebKey & { kid: string };
let certsCache: { keys: Jwk[]; at: number } | null = null;

const b64urlBytes = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

function accessConfig() {
  const teamDomain = process.env.ACCESS_TEAM_DOMAIN?.replace(/\/$/, "");
  const audience = process.env.ACCESS_AUD;
  return teamDomain && audience ? { teamDomain, audience } : null;
}

async function signingKeys(teamDomain: string, force = false): Promise<Jwk[]> {
  if (!force && certsCache && Date.now() - certsCache.at < 3_600_000) return certsCache.keys;
  const res = await fetch(`${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certs HTTP ${res.status}`);
  const { keys } = (await res.json()) as { keys: Jwk[] };
  certsCache = { keys, at: Date.now() };
  return keys;
}

/** The verified Access email, or null when the assertion is missing or invalid. */
export async function verifyAccessAssertion(token: string | null | undefined): Promise<string | null> {
  const cfg = accessConfig();
  if (!cfg || !token) return null;
  const [h, p, sig] = token.split(".");
  if (!h || !p || !sig) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64urlBytes(h))) as { kid?: string; alg?: string };
    const payload = JSON.parse(new TextDecoder().decode(b64urlBytes(p))) as { aud?: string | string[]; exp?: number; iss?: string; email?: string };
    if (header.alg !== "RS256") return null;
    let jwk = (await signingKeys(cfg.teamDomain)).find((k) => k.kid === header.kid);
    // Access rotates signing keys; refetch once before rejecting an unknown kid.
    if (!jwk) jwk = (await signingKeys(cfg.teamDomain, true)).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(sig), new TextEncoder().encode(`${h}.${p}`));
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!valid || !auds.includes(cfg.audience) || payload.iss !== cfg.teamDomain || (payload.exp ?? 0) * 1000 <= Date.now()) return null;
    return typeof payload.email === "string" ? payload.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Access emails allowed to sign in, lowercase. Empty means SSO is off. */
export function allowedAccessEmails(): string[] {
  return (process.env.ACCESS_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
