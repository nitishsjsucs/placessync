# 0006. Cloudflare Workflows for facilities request triage

Status: accepted (2026-10-08)

## Context

Classifying a request calls an LLM that can be slow, can fail, or can return invalid JSON, and the review that follows may take a day.

## Decision

A `TriageWorkflow` instance per request (instance id = request id) runs `load-request`, `classify` (2 retries with backoff, 60 s timeout), `classify-fallback` (keyword classifier, recorded as `keyword-fallback`) when classify fails or the provider is unavailable, an idempotent `record-suggestion` batch, best-effort `notify-staff`, and a 24-hour `waitForEvent("review_outcome")`. On timeout, `flag-overdue` re-reads D1 before flagging. The staff decision itself is written by the API with a conditional UPDATE; the workflow never decides anything.

## Consequences

- Step results are cached, so a D1 failure after classification does not re-run the model.
- The suggestion is always one of the four categories.
- The local Workflows engine is emulated; production behaviour is unverified until deploy.
