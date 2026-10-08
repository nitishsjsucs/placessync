// Cloudflare Access JWT verification with jose (SPEC 9.2, ADR 0004). Production fetches
// the team JWKS; local dev and tests verify against a locally generated RS256 key. The
// checks (RS256 only, iss, aud, exp with 30 s tolerance) are identical in both modes.
import {
  type FetchImplementation,
  type JSONWebKeySet,
  type JWTVerifyGetKey,
  createLocalJWKSet,
  createRemoteJWKSet,
  customFetch,
  jwtVerify,
} from "jose";
import type { AuthConfig } from "../config.ts";

export interface VerifiedToken {
  email: string;
  sub: string;
  /** Expiry in seconds since the epoch. */
  exp: number;
}

export interface AccessVerifier {
  verify(token: string, nowMs: number): Promise<VerifiedToken>;
}

export class TokenError extends Error {}

export function createAccessVerifier(opts: { issuer: string; audience: string; keySet: JWTVerifyGetKey }): AccessVerifier {
  return {
    async verify(token, nowMs) {
      let payload;
      try {
        ({ payload } = await jwtVerify(token, opts.keySet, {
          issuer: opts.issuer,
          audience: opts.audience,
          algorithms: ["RS256"],
          clockTolerance: 30,
          currentDate: new Date(nowMs),
        }));
      } catch (err) {
        throw new TokenError(err instanceof Error ? err.message : "token verification failed");
      }
      if (typeof payload.email !== "string" || payload.email.length === 0) throw new TokenError("token has no email claim");
      if (typeof payload.exp !== "number") throw new TokenError("token has no exp claim");
      return { email: payload.email, sub: typeof payload.sub === "string" ? payload.sub : "", exp: payload.exp };
    },
  };
}

export type VerifierFactory = (cfg: AuthConfig) => AccessVerifier;

/**
 * Builds a verifier for the config: a remote key set for Access, a local one for dev.
 * Pass fetchImpl to serve the remote JWKS without network access (tests).
 */
export function makeVerifierFactory(opts: { fetchImpl?: FetchImplementation } = {}): VerifierFactory {
  return (cfg) => {
    const keySet: JWTVerifyGetKey =
      cfg.mode === "access"
        ? createRemoteJWKSet(new URL(cfg.jwksUrl), opts.fetchImpl ? { [customFetch]: opts.fetchImpl } : {})
        : createLocalJWKSet(JSON.parse(cfg.jwks) as JSONWebKeySet);
    return createAccessVerifier({ issuer: cfg.issuer, audience: cfg.audience, keySet });
  };
}

export function verifierKey(cfg: AuthConfig): string {
  return cfg.mode === "access"
    ? `access|${cfg.issuer}|${cfg.audience}|${cfg.jwksUrl}`
    : `dev|${cfg.issuer}|${cfg.audience}|${cfg.jwks}`;
}
