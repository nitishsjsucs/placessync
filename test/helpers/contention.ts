// Fires the generated contention attempts through the Worker, concurrently, with real
// tokens for every employee (SPEC 12.1 contention.test.ts).
import { SEED, generateContentionAttempts, type ContentionAttempt } from "../../src/shared/synthetic/index.ts";
import { authHeaders, tokenFor } from "./tokens.ts";
import { bizDay, call } from "./world.ts";

export interface AttemptOutcome {
  attempt: ContentionAttempt;
  date: string;
  status: number;
  body: Record<string, unknown>;
}

export async function fireAttempts(path = "/api/reservations"): Promise<{ outcomes: AttemptOutcome[]; dates: { A: string; B: string } }> {
  const attempts = generateContentionAttempts(SEED);
  const dates = { A: bizDay(2), B: bizDay(3) };
  const tokens = new Map<string, string>();
  for (const id of new Set(attempts.map((a) => a.employeeId))) tokens.set(id, await tokenFor(id));
  const outcomes = await Promise.all(
    attempts.map(async (attempt) => {
      const date = attempt.dayOffset === 2 ? dates.A : dates.B;
      const res = await call(path, {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": attempt.idempotencyKey, ...authHeaders(tokens.get(attempt.employeeId) ?? "") },
        body: JSON.stringify({ resourceId: attempt.resourceId, date, startMin: attempt.startMin, endMin: attempt.endMin, attendees: attempt.attendees }),
      });
      const body = (await res.json()) as Record<string, unknown>;
      return { attempt, date, status: res.status, body };
    }),
  );
  return { outcomes, dates };
}
