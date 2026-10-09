// Transport retries for the contention eval (SPEC 13.1). Two failures below the Worker
// are resent with the same Idempotency-Key, which the ledger replays safely:
// - a connect that throws (a burst of 1,000 connects can overflow the local listen
//   queue, macOS kern.ipc.somaxconn, so the connection is refused or reset);
// - the vite preview proxy's own error page: when its fetch to workerd fails, connect's
//   final handler answers 500 with an HTML document whose <pre> holds "TypeError: fetch
//   failed". The Worker never sends that document.
// Every other response is returned as it is, including any other non-JSON 500, which
// the eval then counts as a server error. Each retry's cause is counted and sampled.

export interface RetryLog {
  /** fetch threw: the connection was refused, reset or failed before a response. */
  connectErrors: number;
  /** The preview proxy's HTML 500 "fetch failed" page. */
  proxyFetchFailed: number;
  /** Up to 10 distinct causes, for the results file. */
  samples: string[];
}

export function newRetryLog(): RetryLog {
  return { connectErrors: 0, proxyFetchFailed: 0, samples: [] };
}

export interface RawResponse {
  status: number;
  contentType: string;
  text: string;
}

/**
 * True only for connect's final-handler error document reporting that Miniflare's
 * dispatchFetch (the preview proxy's fetch to workerd) failed. Checked against the page
 * vite preview served after its workerd process was killed (2026-10-08).
 */
export function isProxyFetchFailed(r: RawResponse): boolean {
  return (
    r.status === 500 &&
    r.contentType.startsWith("text/html") &&
    r.text.startsWith("<!DOCTYPE html>") &&
    r.text.includes("<title>Error</title>") &&
    r.text.includes("<pre>TypeError: fetch failed<br>") &&
    r.text.includes("Miniflare.dispatchFetch")
  );
}

function note(log: RetryLog, cause: string): void {
  if (log.samples.length < 10 && !log.samples.includes(cause)) log.samples.push(cause);
}

function connectCause(err: unknown): string {
  const e = err as { message?: string; cause?: { code?: string; name?: string; message?: string } };
  return `connect: ${e.cause?.code ?? e.cause?.name ?? e.cause?.message ?? e.message ?? String(err)}`;
}

export async function postWithRetry(
  url: string,
  init: RequestInit,
  log: RetryLog,
  opts: { fetchImpl?: typeof fetch; maxRetries?: number; delayMs?: (attempt: number) => number } = {},
): Promise<RawResponse> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxRetries = opts.maxRetries ?? 8;
  const delayMs = opts.delayMs ?? ((attempt: number) => 50 * 2 ** Math.min(attempt, 5));
  for (let attempt = 0; ; attempt++) {
    let raw: RawResponse | null = null;
    try {
      const res = await fetchImpl(url, init);
      raw = { status: res.status, contentType: res.headers.get("content-type") ?? "", text: await res.text() };
    } catch (err) {
      if (attempt >= maxRetries) throw err;
      log.connectErrors++;
      note(log, connectCause(err));
    }
    if (raw) {
      if (!isProxyFetchFailed(raw) || attempt >= maxRetries) return raw;
      log.proxyFetchFailed++;
      // The page's first line only: the stack below it holds local file paths.
      note(log, `proxy: ${raw.status} ${raw.text.match(/<pre>([^<]*)/)?.[1] ?? ""} in Miniflare.dispatchFetch`);
    }
    await new Promise((r) => setTimeout(r, delayMs(attempt)));
  }
}
