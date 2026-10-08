# 0005. @cloudflare/vitest-plugin 1.4.0 instead of @cloudflare/vitest-pool-workers

Status: accepted (2026-10-08)

## Context

The brief named `@cloudflare/vitest-pool-workers`. npm marked version 0.23.0 deprecated on 2026-10-07 ("renamed to @cloudflare/vitest-plugin"), and it bundles a Miniflare that refuses `compatibility_date` 2026-10-01.

## Decision

Use `@cloudflare/vitest-plugin@1.4.0`, the same Workers Vitest integration under its new name. It depends on `wrangler@4.149.0` and `miniflare@5.20261006.1-alpha`, the versions `@cloudflare/vite-plugin@1.63.1` uses, so the tree holds one copy of each. Fallback: 1.3.7 (which brings a second wrangler and Miniflare).

## Consequences

- WebSocket tests run in their own `worker-ws` project with one worker and no isolation, because WebSockets with per-file storage isolation are unsupported.
- `.dev.vars` leaks into the test runtime, so every var the tests use is pinned in `miniflare.bindings` and asserted by `env-pins.test.ts`.
