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

/**
 * A verified Access token. User tokens carry the email the identity provider verified.
 * Service token tokens carry no email: `common_name` is the token's Client ID and `sub` is
 * empty (https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/application-token/).
 */
export type VerifiedToken =
  | { kind: "user"; email: string; sub: string; /** Expiry in seconds since the epoch. */ exp: number }
  | { kind: "service"; clientId: string; exp: number };

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
      if (typeof payload.exp !== "number") throw new TokenError("token has no exp claim");
      if (typeof payload.email === "string" && payload.email.length > 0) {
        return { kind: "user", email: payload.email, sub: typeof payload.sub === "string" ? payload.sub : "", exp: payload.exp };
      }
      const cn = payload.common_name;
      if (payload.sub === "" && typeof cn === "string" && cn.length > 0) return { kind: "service", clientId: cn, exp: payload.exp };
      throw new TokenError("token has no email claim");
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
