import { describe, expect, it } from "vitest";
import type { PreviewServer, ViteDevServer } from "vite";
import { loopbackOnly, offLoopbackHost } from "../../scripts/lib/loopback-only.ts";

// The dev server and preview must not listen beyond loopback, because dev mode's host
// guard trusts the client's Host header (security review of 8a54cb4).
describe("loopbackOnly Vite plugin", () => {
  it.each([undefined, false, "localhost", "127.0.0.1", "::1", "[::1]", "LOCALHOST"])("accepts %s", (host) => {
    expect(offLoopbackHost(host)).toBeNull();
  });

  it.each([true, "0.0.0.0", "::", "192.168.1.20", "placessync.local"])("refuses %s", (host) => {
    expect(offLoopbackHost(host)).not.toBeNull();
  });

  it("throws from the dev server and preview hooks for an off-loopback host, before Vite listens", () => {
    const plugin = loopbackOnly();
    const dev = (host: string | boolean | undefined) => ({ config: { server: { host } } }) as unknown as ViteDevServer;
    const preview = (host: string | boolean | undefined) => ({ config: { preview: { host } } }) as unknown as PreviewServer;
    const configureServer = plugin.configureServer as (s: ViteDevServer) => void;
    const configurePreviewServer = plugin.configurePreviewServer as (s: PreviewServer) => void;
    expect(() => configureServer(dev(true))).toThrow(/dev server must listen on loopback only/);
    expect(() => configurePreviewServer(preview("0.0.0.0"))).toThrow(/preview server must listen on loopback only/);
    expect(() => configureServer(dev(undefined))).not.toThrow();
    expect(() => configurePreviewServer(preview("localhost"))).not.toThrow();
  });
});
