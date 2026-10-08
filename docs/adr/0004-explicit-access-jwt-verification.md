# 0004. Explicit Access JWT verification with jose, not ctx.access

Status: accepted (2026-10-08)

## Context

Production sits behind Cloudflare Access, which sends a signed RS256 JWT in `Cf-Access-Jwt-Assertion`. The runtime exposes `ctx.access`, but it cannot be exercised offline.

## Decision

The Worker verifies the token itself with `jose`: RS256 only, `iss` equal to the team domain, `aud` equal to the application tag, `exp` with 30 seconds of tolerance, and keys from `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`. Locally the same verifier runs against a locally generated RS256 key. The verifier comes from an injected factory, memoized per app instance, so tests can serve a fake team JWKS through jose's `customFetch`. Roles come only from D1, never from a token claim.

## Consequences

- The production code path is tested offline, including the certs URL.
- This is a local stand-in for Access, not Access: it proves the checks, not Cloudflare's login flow.
- An unconfigured deploy (placeholder team domain or AUD) answers 500 `misconfigured` instead of verifying against a placeholder.
