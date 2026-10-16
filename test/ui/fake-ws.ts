// A controllable WebSocket stand-in for jsdom tests.
type Listener = (e: { data?: unknown; code?: number; reason?: string }) => void;

export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static reset(): void {
    FakeWebSocket.instances = [];
  }
  static last(): FakeWebSocket {
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("no FakeWebSocket opened");
    return ws;
  }
  /** Opens every socket that is not open yet (call inside act). */
  static openAll(): void {
    for (const ws of FakeWebSocket.instances) if (ws.readyState === 0) ws.open();
  }
  /**
   * The open socket that subscribed to a date: the live availability socket. The staff page also opens a
   * staff-events socket on the same URL, and which of the two is created last depends on which query
   * resolves first, so tests on that page must not rely on last().
   */
  static availability(): FakeWebSocket {
    const ws = FakeWebSocket.instances.find((s) => s.readyState === 1 && s.sent.some((m) => m["type"] === "subscribe"));
    if (!ws) throw new Error("no open FakeWebSocket subscribed to a date");
    return ws;
  }

  readonly url: string;
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  closedByClient: { code?: number; reason?: string } | null = null;
  private listeners = new Map<string, Set<Listener>>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, fn: Listener): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(fn);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn);
  }

  private emit(type: string, e: Parameters<Listener>[0]): void {
    for (const fn of this.listeners.get(type) ?? []) fn(e);
  }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error("send before open");
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === 3) return;
    this.closedByClient = { code, reason };
    this.readyState = 3;
    this.emit("close", { code: code ?? 1000, reason: reason ?? "" });
  }

  // Test controls.
  open(): void {
    this.readyState = 1;
    this.emit("open", {});
  }
  receive(msg: unknown): void {
    this.emit("message", { data: JSON.stringify(msg) });
  }
  serverClose(code: number, reason = ""): void {
    this.readyState = 3;
    this.emit("close", { code, reason });
  }
  subscriptions(): string[] {
    return this.sent.filter((m) => m.type === "subscribe").map((m) => String(m.date));
  }
}
