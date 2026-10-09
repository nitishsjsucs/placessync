import { runInDurableObject } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SiteLedger } from "../../src/worker/ledger/site-ledger.ts";
import { EMPLOYEE } from "../helpers/tokens.ts";
import { bizDay, hqLedger, seed } from "../helpers/world.ts";

beforeAll(async () => {
  await seed();
});
beforeEach(async () => {
  await hqLedger().resetForDev();
});

const emp = { employeeId: EMPLOYEE, role: "employee" as const };

describe("transactional slot claims (SPEC 7.1, ADR 0002)", () => {
  it("rolls back the reservation when the slot PK backstop fires", async () => {
    const date = bizDay(2);
    const stub = hqLedger();
    await stub.syncCatalog();
    const first = await stub.reserve({ employeeId: "emp_002", role: "employee" }, { resourceId: "res_2a02", date, startMin: 540, endMin: 600 }, "backstop-0");
    if (!first.ok) throw new Error("setup booking failed");
    const before = await stub.ledgerStats();
    const versionsBefore = await stub.dateVersions();
    // The alarm may flush outbox rows at any time, so compare the outbox's AUTOINCREMENT
    // high-water mark (rows ever inserted) and the reservation ids of the rows present.
    const outbox = () =>
      runInDurableObject(stub, (_i: SiteLedger, state) => ({
        inserted: Number(state.storage.sql.exec("SELECT COALESCE(MAX(seq), 0) AS n FROM sqlite_sequence WHERE name = 'outbox'").one().n),
        reservationIds: [...new Set(state.storage.sql.exec("SELECT reservation_id FROM outbox").toArray().map((row) => String(row.reservation_id)))],
      }));
    const outboxBefore = await outbox();
    expect(outboxBefore.inserted).toBe(1);
    // A stray slot claim with no reservation: the overlap SELECT sees nothing, so only
    // the PRIMARY KEY can stop the booking.
    await runInDurableObject(stub, (_i: SiteLedger, state) => {
      state.storage.sql.exec("INSERT INTO resource_slots (resource_id, date, slot, reservation_id) VALUES ('res_2a01', ?, 38, 'stray')", date);
    });
    const r = await stub.reserve(emp, { resourceId: "res_2a01", date, startMin: 540, endMin: 660 }, "backstop-1");
    expect(r).toMatchObject({ ok: false, status: 409, error: "resource_conflict" });
    const after = await stub.ledgerStats();
    expect(after.ledgerVersion).toBe(before.ledgerVersion);
    expect(after.backstopHits).toBe(before.backstopHits + 1);
    expect(await stub.dateVersions()).toEqual(versionsBefore);
    const outboxAfter = await outbox();
    expect(outboxAfter.inserted).toBe(outboxBefore.inserted);
    for (const id of outboxAfter.reservationIds) expect(id).toBe(first.reservation.id);
    const counts = await runInDurableObject(stub, (_i: SiteLedger, state) => ({
      reservations: state.storage.sql.exec("SELECT COUNT(*) AS n FROM reservations").one().n,
      slots: state.storage.sql.exec("SELECT COUNT(*) AS n FROM resource_slots").one().n,
      employeeSlots: state.storage.sql.exec("SELECT COUNT(*) AS n FROM employee_slots").one().n,
    }));
    // Only the earlier res_2a02 booking (4 slots) and the stray row remain.
    expect(counts).toEqual({ reservations: 1, slots: 5, employeeSlots: 4 });
  });

  it("claims one resource slot per 15 minutes", async () => {
    const stub = hqLedger();
    const r = await stub.reserve(emp, { resourceId: "res_2a01", date: bizDay(2), startMin: 540, endMin: 600 }, "slots-1");
    expect(r.ok).toBe(true);
    const slots = await runInDurableObject(stub, (_i: SiteLedger, state) =>
      state.storage.sql.exec("SELECT slot FROM resource_slots ORDER BY slot").toArray().map((row) => row.slot),
    );
    expect(slots).toEqual([36, 37, 38, 39]);
  });
});

describe("single-flight catalog sync (SPEC 7.1, m5)", () => {
  it("50 concurrent first reserves after a reset trigger exactly one syncCatalog", async () => {
    const stub = hqLedger();
    const before = await runInDurableObject(stub, (i: SiteLedger) => i.catalogSyncCount);
    const date = bizDay(3);
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, n) =>
        stub.reserve({ employeeId: `emp_${String(n + 1).padStart(3, "0")}`, role: "employee" }, { resourceId: "res_2a01", date, startMin: 420 + (n % 10) * 60, endMin: 480 + (n % 10) * 60 }, `sf-${n}`),
      ),
    );
    const after = await runInDurableObject(stub, (i: SiteLedger) => i.catalogSyncCount);
    expect(after - before).toBe(1);
    expect(results.filter((r) => r.ok)).toHaveLength(10);
    expect(results.filter((r) => !r.ok && r.error === "resource_conflict")).toHaveLength(40);
  });

  it("syncCatalog copies the D1 site row into the ledger", async () => {
    const stub = hqLedger();
    expect(await stub.syncCatalog()).toEqual({ resources: 20 });
    const site = await runInDurableObject(stub, (_i: SiteLedger, state) => state.storage.sql.exec("SELECT * FROM site").one());
    expect(site).toEqual({ id: "hq", timezone: "America/Los_Angeles", open_min: 420, close_min: 1140, horizon_days: 14 });
  });
});
