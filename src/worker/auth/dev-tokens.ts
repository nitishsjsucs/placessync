// Dev-mode token signing: /api/dev/login signs an RS256 token with the private JWK from
// .dev.vars (written by `npm run setup:dev`). Never used in access mode.
import { type JWK, SignJWT, importJWK } from "jose";

export const DEV_TOKEN_TTL_SECONDS = 8 * 60 * 60;

export async function signDevToken(opts: {
  privateJwk: string;
  issuer: string;
  audience: string;
  email: string;
  sub: string;
  nowMs: number;
  ttlSeconds?: number;
  extraClaims?: Record<string, unknown>;
}): Promise<{ token: string; exp: number }> {
  const jwk = JSON.parse(opts.privateJwk) as JWK;
  const key = await importJWK(jwk, "RS256");
  const iat = Math.floor(opts.nowMs / 1000);
  const exp = iat + (opts.ttlSeconds ?? DEV_TOKEN_TTL_SECONDS);
  const token = await new SignJWT({ email: opts.email, ...opts.extraClaims })
    .setProtectedHeader({ alg: "RS256", kid: jwk.kid ?? "dev" })
    .setIssuer(opts.issuer)
    .setAudience(opts.audience)
    .setSubject(opts.sub)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(key);
  return { token, exp };
}
