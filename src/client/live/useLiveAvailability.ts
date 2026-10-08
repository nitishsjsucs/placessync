// Live availability for the dates a page shows (SPEC 7.2). Subscribes per date, applies
// deltas with per-date versions, resubscribes a date on a gap, and reconnects with
// backoff (including after a 4001 session_expired close).
import { useEffect, useRef, useState } from "react";
import { ServerMessage } from "../../shared/live-protocol.ts";
import { type LiveStatus, LiveSocket, liveUrl } from "./socket.ts";
import { type LiveState, applyDelta, applySnapshot } from "./live-state.ts";

export interface LiveOptions {
  WebSocketImpl?: typeof WebSocket;
  url?: string;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export function useLiveAvailability(siteId: string | null, dates: readonly string[], options: LiveOptions = {}) {
  const [state, setState] = useState<LiveState>({});
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const socket = useRef<LiveSocket | null>(null);
  const subscribed = useRef(new Set<string>());
  const stateRef = useRef<LiveState>({});
  const optionsRef = useRef(options);
  const datesKey = [...dates].sort().join(",");

  useEffect(() => {
    if (!siteId) return;
    const opts = optionsRef.current;
    const s = new LiveSocket({
      url: opts.url ?? liveUrl(siteId),
      WebSocketImpl: opts.WebSocketImpl,
      random: opts.random,
      setTimer: opts.setTimer,
      clearTimer: opts.clearTimer,
      onStatus: setStatus,
      onOpen: () => {
        // A new connection has no subscriptions: subscribe every wanted date again.
        for (const d of subscribed.current) s.send({ type: "subscribe", date: d });
      },
      onMessage: (raw) => {
        const parsed = ServerMessage.safeParse(raw);
        if (!parsed.success) return;
        const msg = parsed.data;
        if (msg.type === "snapshot") {
          if (!subscribed.current.has(msg.date)) return;
          stateRef.current = applySnapshot(stateRef.current, msg);
          setState(stateRef.current);
        } else if (msg.type === "delta") {
          const r = applyDelta(stateRef.current, msg);
          if (r.resubscribe) s.send({ type: "subscribe", date: r.resubscribe });
          if (r.applied) {
            stateRef.current = r.state;
            setState(r.state);
          }
        }
      },
    });
    socket.current = s;
    return () => {
      s.close();
      socket.current = null;
      subscribed.current = new Set();
      stateRef.current = {};
    };
  }, [siteId]);

  useEffect(() => {
    const s = socket.current;
    const want = new Set(datesKey ? datesKey.split(",") : []);
    for (const d of [...subscribed.current]) {
      if (!want.has(d)) {
        subscribed.current.delete(d);
        s?.send({ type: "unsubscribe", date: d });
        const { [d]: _drop, ...rest } = stateRef.current;
        stateRef.current = rest;
        setState(rest);
      }
    }
    for (const d of want) {
      if (!subscribed.current.has(d)) {
        subscribed.current.add(d);
        s?.send({ type: "subscribe", date: d });
      }
    }
  }, [datesKey, siteId]);

  return { status, byDate: state };
}
