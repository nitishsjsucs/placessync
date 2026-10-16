import { afterEach, describe, expect, it, vi } from "vitest";
import { type QueueItem, ageLong, ageShort, countText, oldestText, serverNow, summarize, tileSentence } from "../../../src/client/charts/work-summary.ts";

const T0 = Date.parse("2026-10-08T14:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

/** A row the server answered at `now`, created `ageMinutes` before it. */
function row(over: Partial<QueueItem> & { ageMinutes: number }, now = T0): QueueItem {
  const createdAt = iso(now - over.ageMinutes * 60_000);
  return {
    id: "req_x",
    siteId: "hq",
    reporterId: "emp_001",
    reporterName: "A Person",
    resourceId: null,
    resourceName: null,
    locationNote: "",
    title: "Something",
    description: "Something is broken somewhere.",
    status: "awaiting_review",
    triageState: "suggested",
    triageAttempts: 1,
    finalCategory: null,
    reviewDecision: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt,
    updatedAt: createdAt,
    suggestion: null,
    ...over,
  } as QueueItem;
}

afterEach(() => vi.useRealTimers());

describe("summarize (VIZ-01)", () => {
  it("splits the queue by the action each row offers: suggested vs pending or unavailable", () => {
    const queue = [
      row({ id: "a", triageState: "suggested", ageMinutes: 30 }),
      row({ id: "b", triageState: "suggested", ageMinutes: 3000 }),
      row({ id: "c", triageState: "pending", status: "submitted", ageMinutes: 5 }),
      // An unavailable row whose late suggestion arrived after the hand-off still offers only Categorize.
      row({
        id: "d",
        triageState: "unavailable",
        ageMinutes: 90,
        suggestion: { category: "electrical_av", confidence: 0.9, rationale: "Late.", provider: "stub", model: "keyword-v1", attempts: 1, latencyMs: 0, createdAt: "x" },
      }),
    ];
    const [suggested, manual, assigned, inProgress] = summarize(queue, []);
    expect(suggested).toMatchObject({ id: "suggested", label: "Suggestions to review", count: 2, oldestMinutes: 3000, overDay: 1, to: "/staff" });
    expect(manual).toMatchObject({ id: "manual", label: "To categorize by hand", count: 2, oldestMinutes: 90, overDay: 0, to: "/staff" });
    expect(assigned).toMatchObject({ id: "assigned", label: "Assigned, not started", count: 0, oldestMinutes: null, to: "/staff?tab=working" });
    expect(inProgress).toMatchObject({ id: "in_progress", label: "In progress", count: 0, to: "/staff?tab=working" });
  });

  it("counts over 24 h from exactly 1440 minutes, not 1439", () => {
    const [tile] = summarize([row({ ageMinutes: 1439 }), row({ ageMinutes: 1440 })], []);
    expect(tile?.overDay).toBe(1);
    const [none] = summarize([row({ ageMinutes: 1439 })], []);
    expect(none?.overDay).toBe(0);
  });

  it("measures assigned and in-progress waits from updatedAt against the server's clock, never Date.now()", () => {
    // The browser clock is a week ahead; the server answered at T0.
    vi.useFakeTimers();
    vi.setSystemTime(T0 + 7 * 24 * 60 * 60_000);
    const working = [
      row({ id: "w1", status: "assigned", ageMinutes: 600, updatedAt: iso(T0 - 125 * 60_000) }),
      row({ id: "w2", status: "assigned", ageMinutes: 300, updatedAt: iso(T0 - 61 * 60_000) }),
      row({ id: "w3", status: "in_progress", ageMinutes: 4000, updatedAt: iso(T0 - 3 * 24 * 60 * 60_000) }),
    ];
    expect(serverNow(working)).toBe(T0);
    const [, , assigned, inProgress] = summarize([], working);
    expect(assigned?.oldestMinutes).toBe(125);
    expect(oldestText(assigned!)).toBe("oldest 2 h in this status");
    expect(inProgress?.oldestMinutes).toBe(3 * 24 * 60);
    expect(tileSentence(inProgress!)).toBe("In progress: 1 request, oldest 3 days in this status");
  });

  it("shows 200+ for a list cut at the server's limit", () => {
    const full = Array.from({ length: 200 }, (_, i) => row({ id: `r${i}`, ageMinutes: 10 }));
    const [tile, manual] = summarize(full, []);
    expect(countText(tile!)).toBe("200+");
    // The other queue tile comes from the same list, so it is a lower bound too.
    expect(countText(manual!)).toBe("0+");
    expect(tileSentence(tile!)).toBe("Suggestions to review: 200 or more requests, oldest 10 minutes");
    const assigned = Array.from({ length: 200 }, (_, i) => row({ id: `a${i}`, status: "assigned", ageMinutes: 10 }));
    expect(countText(summarize([], assigned)[2]!)).toBe("200+");
    expect(countText(summarize(full.slice(1), [])[0]!)).toBe("199");
  });

  it("an empty queue and no work give zeros without oldest lines", () => {
    const tiles = summarize([], []);
    expect(tiles.map((t) => [t.count, oldestText(t), t.overDay])).toEqual([
      [0, null, 0],
      [0, null, 0],
      [0, null, null],
      [0, null, null],
    ]);
    expect(tileSentence(tiles[0]!)).toBe("Suggestions to review: 0 requests");
  });

  it("formats ages the way the Age column does, and in words", () => {
    expect([ageShort(42), ageShort(60), ageShort(47 * 60 + 59), ageShort(48 * 60), ageShort(11 * 1440 + 5)]).toEqual(["42 min", "1 h", "47 h", "2 d", "11 d"]);
    expect([ageLong(1), ageLong(42), ageLong(60), ageLong(48 * 60), ageLong(11 * 1440)]).toEqual(["1 minute", "42 minutes", "1 hour", "2 days", "11 days"]);
  });

  it("writes the full sentence for a queue tile", () => {
    const queue = Array.from({ length: 12 }, (_, i) => row({ id: `q${i}`, ageMinutes: i < 10 ? 2000 + i : 100 }));
    queue[0] = row({ id: "old", ageMinutes: 11 * 1440 + 30 });
    const [tile] = summarize(queue, []);
    expect(tileSentence(tile!)).toBe("Suggestions to review: 12 requests, oldest 11 days, 10 waiting over 24 hours");
    expect(oldestText(tile!)).toBe("oldest 11 d");
  });
});
