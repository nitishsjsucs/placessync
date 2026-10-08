import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backoffDelay } from "../../src/client/live/socket.ts";
import { type LiveOptions, useLiveAvailability } from "../../src/client/live/useLiveAvailability.ts";
import { FakeWebSocket } from "./fake-ws.ts";

const A = "2026-10-12";
const B = "2026-10-13";
let latest: ReturnType<typeof useLiveAvailability> | null = null;
const timers: { fn: () => void; ms: number }[] = [];

function Probe({ dates, options }: { dates: string[]; options: LiveOptions }) {
  latest = useLiveAvailability("hq", dates, options);
  return null;
}

const options: LiveOptions = {
  WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
  url: "ws://localhost/api/sites/hq/live",
  random: () => 1,
  setTimer: (fn, ms) => {
    timers.push({ fn, ms });
    return timers.length;
  },
  clearTimer: () => {},
};

const snapshot = (date: string, dateVersion: number, ledgerVersion: number, busy: Record<string, unknown[]> = { res_2a01: [] }) => ({
  type: "snapshot",
  date,
  dateVersion,
  ledgerVersion,
  busy,
});
const delta = (date: string, dateVersion: number, ledgerVersion: number, op: "booked" | "released", startMin = 540, endMin = 600) => ({
  type: "delta",
  date,
  dateVersion,
  ledgerVersion,
  op,
  resourceId: "res_2a01",
  startMin,
  endMin,
  mine: false,
});

beforeEach(() => {
  FakeWebSocket.reset();
  timers.length = 0;
  latest = null;
});
afterEach(() => {
  latest = null;
});

async function connected(dates = [A, B]) {
  const view = render(<Probe dates={dates} options={options} />);
  const ws = FakeWebSocket.last();
  await act(async () => ws.open());
  return { ws, view };
}

describe("useLiveAvailability (SPEC 7.2)", () => {
  it("subscribes per date, applies the snapshot, then in-order deltas", async () => {
    const { ws } = await connected();
    expect(ws.subscriptions()).toEqual([A, B]);
    expect(latest?.status).toBe("live");
    await act(async () => ws.receive(snapshot(A, 3, 10)));
    await act(async () => ws.receive(delta(A, 4, 11, "booked")));
    expect(latest?.byDate[A]).toEqual({ dateVersion: 4, ledgerVersion: 11, busy: { res_2a01: [{ startMin: 540, endMin: 600, mine: false }] } });
    await act(async () => ws.receive(delta(A, 5, 12, "released")));
    expect(latest?.byDate[A]?.busy.res_2a01).toEqual([]);
  });

  it("a dateVersion gap on A resubscribes A only", async () => {
    const { ws } = await connected();
    await act(async () => {
      ws.receive(snapshot(A, 3, 10));
      ws.receive(snapshot(B, 1, 10));
    });
    ws.sent.length = 0;
    await act(async () => ws.receive(delta(A, 5, 12, "booked")));
    expect(ws.sent).toEqual([{ type: "subscribe", date: A }]);
    expect(latest?.byDate[A]?.dateVersion).toBe(3);
  });

  it("ignores a duplicate delta", async () => {
    const { ws } = await connected();
    await act(async () => {
      ws.receive(snapshot(A, 3, 10));
      ws.receive(delta(A, 4, 11, "booked"));
      ws.receive(delta(A, 4, 11, "booked"));
    });
    expect(latest?.byDate[A]?.busy.res_2a01).toHaveLength(1);
    expect(ws.sent.filter((m) => m.type === "subscribe")).toHaveLength(2);
  });

  it("deltas for B never touch A, and a ledgerVersion jump alone triggers nothing", async () => {
    const { ws } = await connected();
    await act(async () => {
      ws.receive(snapshot(A, 3, 10));
      ws.receive(snapshot(B, 1, 10));
    });
    const before = latest?.byDate[A];
    ws.sent.length = 0;
    await act(async () => ws.receive(delta(B, 2, 40, "booked")));
    expect(latest?.byDate[A]).toBe(before);
    // Ledger version jumped from 10 to 41 across dates; A's next delta is still in order.
    await act(async () => ws.receive(delta(A, 4, 41, "booked")));
    expect(ws.sent).toEqual([]);
    expect(latest?.byDate[A]?.dateVersion).toBe(4);
    expect(latest?.byDate[B]?.dateVersion).toBe(2);
  });

  it("reconnects after a session_expired close and subscribes again", async () => {
    const { ws } = await connected([A]);
    await act(async () => ws.serverClose(4001, "session expired"));
    expect(latest?.status).toBe("offline");
    expect(timers).toHaveLength(1);
    await act(async () => timers[0]?.fn());
    const second = FakeWebSocket.last();
    expect(second).not.toBe(ws);
    await act(async () => second.open());
    expect(second.subscriptions()).toEqual([A]);
    expect(latest?.status).toBe("live");
  });

  it("backs off exponentially with jitter between 0.5 s and 15 s", async () => {
    const { ws } = await connected([A]);
    await act(async () => ws.serverClose(1006));
    for (let i = 0; i < 7; i++) {
      await act(async () => timers.at(-1)?.fn());
      await act(async () => FakeWebSocket.last().serverClose(1006));
    }
    expect(timers.map((t) => t.ms)).toEqual([500, 1000, 2000, 4000, 8000, 15000, 15000, 15000]);
    expect(backoffDelay(0, () => 0)).toBe(500);
    expect(backoffDelay(3, () => 0)).toBe(2000);
    expect(backoffDelay(10, () => 0)).toBe(7500);
  });

  it("closes the socket on unmount", async () => {
    const { ws, view } = await connected([A]);
    view.unmount();
    expect(ws.closedByClient).toEqual({ code: 1000, reason: "done" });
    expect(timers).toHaveLength(0);
  });
});
