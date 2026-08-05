// Priority 8.11: the unified CORE-issued JWT (API_CONTRACT.md ->
// Authentication & application identity, §3.1, decided Priority 8.9).
// RS256, verified via the public JWKS document this same keypair backs
// (GET /v1/.well-known/jwks.json). Claims are deliberately minimal --
// `sub` (user), `azp` (the application this token was issued for), `iat`,
// `exp`, `jti` -- no name/email/role/Premium status, all of which are
// looked up fresh per request (PROJECT_KNOWLEDGE.md -> Permissions).
import { createPrivateKey, createPublicKey, randomUUID, type KeyObject } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

// 15 minutes -- API_CONTRACT.md §3.1.
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

function loadPrivateKey(): KeyObject {
  const b64 = process.env.V1_JWT_PRIVATE_KEY;
  if (!b64) throw new Error("V1_JWT_PRIVATE_KEY is not configured");
  const pem = Buffer.from(b64, "base64").toString("utf8");
  return createPrivateKey(pem);
}

function loadPublicKey(): KeyObject {
  return createPublicKey(loadPrivateKey());
}

function keyId(): string {
  const kid = process.env.V1_JWT_KEY_ID;
  if (!kid) throw new Error("V1_JWT_KEY_ID is not configured");
  return kid;
}

export type MintedAccessToken = { token: string; expiresIn: number };

export async function mintAccessToken(userId: string, appId: string): Promise<MintedAccessToken> {
  const token = await new SignJWT({ azp: appId })
    .setProtectedHeader({ alg: "RS256", kid: keyId() })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .setJti(randomUUID())
    .sign(loadPrivateKey());
  return { token, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

export type VerifiedAccessToken = { userId: string; appId: string };

export async function verifyAccessToken(token: string): Promise<VerifiedAccessToken | null> {
  try {
    const { payload } = await jwtVerify(token, loadPublicKey(), { algorithms: ["RS256"] });
    if (!payload.sub || typeof payload.azp !== "string") return null;
    return { userId: payload.sub, appId: payload.azp };
  } catch {
    return null;
  }
}

// Public JWKS document (§5's GET /v1/.well-known/jwks.json) -- only ever
// the public half of the keypair, never the private key material.
export function getJwks(): { keys: Record<string, unknown>[] } {
  const jwk = loadPublicKey().export({ format: "jwk" }) as Record<string, unknown>;
  return { keys: [{ ...jwk, kid: keyId(), use: "sig", alg: "RS256" }] };
}
