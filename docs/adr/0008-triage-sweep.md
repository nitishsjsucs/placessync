# 0008. A cron sweep as the triage safety net

Status: accepted (2026-10-08)

## Context

`create()` can fail after the request row is inserted, and a workflow instance can end errored or complete without recording a suggestion. Retrying inside the request path would make every submission slow and still miss later failures.

## Decision

A cron trigger every 2 minutes runs `sweepStrandedRequests`: up to 25 requests still `submitted` after 2 minutes. No instance: create it. Errored or terminated: restart it. In flight: leave it. Complete or unknown while D1 still says submitted: hand off. At 3 attempts: hand off. A hand-off sets `awaiting_review` with `triage_state = 'unavailable'`, logs `triage_unavailable` and notifies staff, who categorize by hand.

## Consequences

- No request can sit in `submitted` forever.
- The sweep is called directly in tests through the exported `scheduled` handler; it is not fired on a timer during local dev. Production firing is checked after deploy.
