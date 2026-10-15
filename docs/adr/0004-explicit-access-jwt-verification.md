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

## Amendment (2026-10-15): one service token

`npm run prod:verify` signs in through an Access Service Auth policy with a service token, whose JWT has no email, an empty `sub` and the token's Client ID as `common_name`. The verifier accepts such a token, and the middleware maps it to the D1 employee `emp_verify` only when `common_name` equals `ACCESS_SERVICE_CLIENT_ID`; any other service token gets 401, and the role still comes from D1. A placeholder Client ID fails closed like the AUD.
