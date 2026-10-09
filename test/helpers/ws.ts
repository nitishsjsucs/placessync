// Event-driven WebSocket helpers for the worker-ws project: no fixed sleeps, every wait
// has a timeout, and closeAll() closes every socket a test opened.
import { exports } from "cloudflare:workers";
import { authHeaders } from "./tokens.ts";

type Msg = Record<string, unknown> & { type: string };

export interface LiveClient {
  ws: WebSocket;
  messages: Msg[];
  closed: Promise<{ code: number; reason: string }>;
  send(msg: unknown): void;
  /** Resolves with the next message (after those already consumed) matching pred. */
  next(pred?: (m: Msg) => boolean, timeoutMs?: number): Promise<Msg>;
  /** Messages received but not yet consumed by next(). */
  pending(): Msg[];
}

const open: WebSocket[] = [];

export async function connect(token: string, path = "/api/sites/hq/live", extraHeaders: Record<string, string> = {}): Promise<LiveClient> {
  const res = await exports.default.fetch(
    new Request(`http://localhost${path}`, { headers: { ...extraHeaders, upgrade: "websocket", ...authHeaders(token) } }),
  );
  const ws = res.webSocket;
  if (res.status !== 101 || !ws) throw new Error(`upgrade failed: ${res.status} ${await res.text()}`);
  ws.accept();
  open.push(ws);
  const messages: Msg[] = [];
  let cursor = 0;
  let waiters: (() => void)[] = [];
  ws.addEventListener("message", (e) => {
    messages.push(JSON.parse(String(e.data)) as Msg);
    const w = waiters;
    waiters = [];
    for (const f of w) f();
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    ws.addEventListener("close", (e) => {
      resolve({ code: e.code, reason: e.reason });
      const w = waiters;
      waiters = [];
      for (const f of w) f();
    });
  });
  return {
    ws,
    messages,
    closed,
    send: (msg) => ws.send(typeof msg === "string" ? msg : JSON.stringify(msg)),
    pending: () => messages.slice(cursor),
    next(pred = () => true, timeoutMs = 3000) {
      return new Promise<Msg>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting for a message; got ${JSON.stringify(messages.slice(cursor))}`)), timeoutMs);
        const check = () => {
          while (cursor < messages.length) {
            const m = messages[cursor++] as Msg;
            if (pred(m)) {
              clearTimeout(timer);
              resolve(m);
              return;
            }
          }
          waiters.push(check);
        };
        check();
      });
    },
  };
}

/** Round trip through the object: messages sent to this socket before now have arrived. */
export async function flush(client: LiveClient): Promise<void> {
  client.send({ type: "subscribe", date: "1999-01-04" });
  await client.next((m) => m.type === "snapshot" && m.date === "1999-01-04");
  client.send({ type: "unsubscribe", date: "1999-01-04" });
}

export async function closeAll(): Promise<void> {
  for (const ws of open.splice(0)) {
    try {
      ws.close(1000, "test done");
    } catch {
      // Already closed.
    }
  }
}
