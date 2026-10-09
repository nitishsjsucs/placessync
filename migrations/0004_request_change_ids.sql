-- Ties each request_events row to the conditional UPDATE that took effect (review of
-- 8a54cb4). Status changes, reporter cancels and the sweep hand-off set last_change_id to
-- a fresh id in their UPDATE and write their event only if the row still carries that
-- id. A concurrent request that lost the race changed nothing, so its id is not on the
-- row and it writes no event, even when both requests stamped the same updated_at.
ALTER TABLE facilities_requests ADD COLUMN last_change_id TEXT;
