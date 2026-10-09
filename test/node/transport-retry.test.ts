import { describe, expect, it } from "vitest";
import { isProxyFetchFailed, newRetryLog, postWithRetry } from "../../scripts/lib/transport-retry.ts";

// The page vite preview served when its fetch to workerd failed (workerd killed), with
// the local paths in the stack shortened.
const PROXY_PAGE =
  '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Error</title>\n</head>\n<body>\n<pre>TypeError: fetch failed<br> &nbsp; &nbsp;at Object.processResponse (/repo/node_modules/miniflare/node_modules/undici/lib/web/fetch/index.js:237:16)<br> &nbsp; &nbsp;at async fetch4 (/repo/node_modules/miniflare/dist/src/index.js:90260:20)<br> &nbsp; &nbsp;at async _Miniflare.dispatchFetch (/repo/node_modules/miniflare/dist/src/index.js:134947:22)<br> &nbsp; &nbsp;at async file:///repo/node_modules/@cloudflare/vite-plugin/dist/index.mjs:56327:19</pre>\n</body>\n</html>\n';
const html = (text: string, status = 500) => new Response(text, { status, headers: { "content-type": "text/html; charset=utf-8" } });
const ok = () => Response.json({ reservation: { id: "rsv_1" } }, { status: 201 });

function scripted(responses: (Response | Error)[]) {
  const calls: RequestInit[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    calls.push(init);
    const next = responses.shift();
    if (!next) throw new Error("no more scripted responses");
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const refused = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
const init = { method: "POST", headers: { "Idempotency-Key": "att_0001" }, body: "{}" };

describe("contention eval transport retries", () => {
  it("recognises only the proxy's fetch-failed error page", () => {
    expect(isProxyFetchFailed({ status: 500, contentType: "text/html; charset=utf-8", text: PROXY_PAGE })).toBe(true);
    // A production-mode final handler hides the cause: not provably a proxy fetch failure.
    expect(isProxyFetchFailed({ status: 500, contentType: "text/html; charset=utf-8", text: PROXY_PAGE.replace(/<pre>.*<\/pre>/, "<pre>Internal Server Error</pre>") })).toBe(false);
    // A fetch failure anywhere but the proxy's dispatch to workerd is not this case.
    expect(isProxyFetchFailed({ status: 500, contentType: "text/html; charset=utf-8", text: PROXY_PAGE.replace("_Miniflare.dispatchFetch", "handler") })).toBe(false);
    // A runtime error page, plain text 500s and JSON 500s are server errors.
    expect(isProxyFetchFailed({ status: 500, contentType: "text/html", text: "<html><body>Error: boom in worker</body></html>" })).toBe(false);
    expect(isProxyFetchFailed({ status: 500, contentType: "text/plain", text: "Internal Server Error" })).toBe(false);
    expect(isProxyFetchFailed({ status: 500, contentType: "application/json", text: '{"error":"internal"}' })).toBe(false);
    expect(isProxyFetchFailed({ status: 502, contentType: "text/html; charset=utf-8", text: PROXY_PAGE })).toBe(false);
  });

  it("resends refused connects and proxy pages with the same request, counting each cause", async () => {
    const { fetchImpl, calls } = scripted([refused(), html(PROXY_PAGE), refused(), ok()]);
    const log = newRetryLog();
    const res = await postWithRetry("http://localhost:8783/api/reservations", init, log, { fetchImpl, delayMs: () => 0 });
    expect(res.status).toBe(201);
    expect(calls).toHaveLength(4);
    for (const c of calls) expect(c).toBe(init);
    expect(log).toMatchObject({ connectErrors: 2, proxyFetchFailed: 1 });
    expect(log.samples[0]).toBe("connect: ECONNREFUSED");
    expect(log.samples[1]).toBe("proxy: 500 TypeError: fetch failed in Miniflare.dispatchFetch");
    expect(log.samples.join(" ")).not.toContain("/repo/");
    expect(log.samples).toHaveLength(2);
  });

  it("returns any other non-JSON 500 at once, so the eval counts it as a server error", async () => {
    const { fetchImpl, calls } = scripted([html("<html><body>Worker threw</body></html>"), ok()]);
    const log = newRetryLog();
    const res = await postWithRetry("http://x", init, log, { fetchImpl, delayMs: () => 0 });
    expect(res).toEqual({ status: 500, contentType: "text/html; charset=utf-8", text: "<html><body>Worker threw</body></html>" });
    expect(calls).toHaveLength(1);
    expect(log).toEqual({ connectErrors: 0, proxyFetchFailed: 0, samples: [] });
  });

  it("gives up after the retry limit: a proxy page is returned as a 500, a refused connect throws", async () => {
    const pages = scripted(Array.from({ length: 3 }, () => html(PROXY_PAGE)));
    expect((await postWithRetry("http://x", init, newRetryLog(), { fetchImpl: pages.fetchImpl, maxRetries: 2, delayMs: () => 0 })).status).toBe(500);
    const conns = scripted(Array.from({ length: 3 }, refused));
    await expect(postWithRetry("http://x", init, newRetryLog(), { fetchImpl: conns.fetchImpl, maxRetries: 2, delayMs: () => 0 })).rejects.toThrow("fetch failed");
  });
});
