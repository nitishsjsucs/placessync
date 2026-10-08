// Reconnecting WebSocket with jittered exponential backoff (0.5 s to 15 s, SPEC 7.2).
// The constructor, timers and randomness are injectable so tests can drive it.

export type LiveStatus = "connecting" | "live" | "offline";

export interface LiveSocketOptions {
  url: string;
  onMessage: (data: unknown) => void;
  onOpen?: () => void;
  onStatus?: (status: LiveStatus) => void;
  WebSocketImpl?: typeof WebSocket;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export const BACKOFF_MIN_MS = 500;
export const BACKOFF_MAX_MS = 15_000;

/**
 * Delay before reconnect attempt n (0-based): min(15 s, 0.5 s * 2^n) scaled by jitter in
 * [0.5, 1], never below 0.5 s, so every delay lies between 0.5 s and 15 s.
 */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** attempt);
  return Math.max(BACKOFF_MIN_MS, Math.round(ceiling * (0.5 + random() / 2)));
}

export class LiveSocket {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private timer: unknown = null;
  private closed = false;
  private readonly opts: Required<Omit<LiveSocketOptions, "onOpen" | "onStatus">> & Pick<LiveSocketOptions, "onOpen" | "onStatus">;

  constructor(opts: LiveSocketOptions) {
    this.opts = {
      ...opts,
      WebSocketImpl: opts.WebSocketImpl ?? globalThis.WebSocket,
      random: opts.random ?? Math.random,
      setTimer: opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms)),
      clearTimer: opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)),
    };
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;
    this.opts.onStatus?.("connecting");
    const ws = new this.opts.WebSocketImpl(this.opts.url);
    this.ws = ws;
    ws.addEventListener("open", () => {
      this.attempt = 0;
      this.opts.onStatus?.("live");
      this.opts.onOpen?.();
    });
    ws.addEventListener("message", (e: MessageEvent) => {
      let data: unknown;
      try {
        data = JSON.parse(String(e.data));
      } catch {
        return;
      }
      this.opts.onMessage(data);
    });
    ws.addEventListener("close", () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.closed) return;
      // Covers session_expired (4001) too: reconnecting re-authenticates the upgrade.
      this.opts.onStatus?.("offline");
      const delay = backoffDelay(this.attempt++, this.opts.random);
      this.timer = this.opts.setTimer(() => this.connect(), delay);
    });
  }

  send(message: unknown): boolean {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  close(): void {
    this.closed = true;
    if (this.timer !== null) this.opts.clearTimer(this.timer);
    this.ws?.close(1000, "done");
    this.ws = null;
  }
}

export function liveUrl(siteId: string, location: Pick<Location, "protocol" | "host"> = window.location): string {
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/sites/${encodeURIComponent(siteId)}/live`;
}
