// Workers Free plan limits that size this Worker's batches (README "Production on the
// Workers Free plan"). Nitish runs PlacesSync on the Free plan, so no code path may need
// Workers Paid. Each value was read on developers.cloudflare.com on 2026-10-15.

/**
 * D1 queries per Worker invocation on Workers Free (Paid: 1,000).
 * https://developers.cloudflare.com/d1/platform/limits/
 * The page also says per-query limits apply to each statement inside a batch, so every
 * statement is counted here, not every batch() call.
 */
export const D1_QUERIES_PER_INVOCATION = 50;

/**
 * CPU time per HTTP request, Cron Trigger and Workflow step on Workers Free.
 * https://developers.cloudflare.com/workers/platform/limits/#cpu-time
 * Not asserted locally: `npm run prod:verify` measures it on the deployed Worker.
 */
export const CPU_MS_PER_INVOCATION = 10;
