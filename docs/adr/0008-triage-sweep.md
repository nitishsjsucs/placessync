# 0008. A cron sweep as the triage safety net

Status: accepted (2026-10-08)

## Context

`create()` can fail after the request row is inserted, and a workflow instance can end errored or complete without recording a suggestion. Retrying inside the request path would make every submission slow and still miss later failures.

## Decision

A cron trigger every 2 minutes runs `sweepStrandedRequests`: up to 12 requests of the configured site still `submitted` after 2 minutes (25 before 2026-10-15; at most 3 D1 statements per row plus the SELECT keep one run within D1's 50 queries per invocation on Workers Free, and filtering on `site_id` lets the query search `idx_requests_status` instead of scanning it). No instance: create it. Errored or terminated: restart it. In flight: leave it. Complete or unknown while D1 still says submitted: hand off. At 3 attempts: hand off. A hand-off sets `awaiting_review` with `triage_state = 'unavailable'`, logs `triage_unavailable` and notifies staff, who categorize by hand.

## Consequences

- No request can sit in `submitted` forever.
- The sweep is called directly in tests through the exported `scheduled` handler; it is not fired on a timer during local dev. Production firing is checked after deploy.
