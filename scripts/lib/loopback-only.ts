// Vite plugin: the dev server and `vite preview` listen on loopback only.
//
// In dev mode the Worker's host guard (src/worker/auth/middleware.ts) checks the request
// URL's hostname, and @cloudflare/vite-plugin builds that URL from the client's Host
// header. So once the server listens beyond loopback (`--host`, `host: true`, 0.0.0.0, a
// LAN address), any peer that can reach the port can send `Host: localhost`, pass the
// guard, mint a facilities_admin session at POST /api/dev/login and wipe every table with
// POST /api/dev/seed. Production runs on Cloudflare, where none of this applies, so this
// repo's local servers have no reason to listen anywhere else: starting one off loopback
// fails before it binds.
import type { Plugin } from "vite";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Describes a listen host that is not loopback, or returns null for a loopback (or unset) host. */
export function offLoopbackHost(host: string | boolean | undefined): string | null {
  // Unset and false both mean Vite's default, localhost.
  if (host === undefined || host === false) return null;
  if (host === true) return "every interface (host: true or --host)";
  return LOOPBACK_HOSTS.has(host.toLowerCase()) ? null : host;
}

export function assertLoopback(server: "dev server" | "preview server", host: string | boolean | undefined): void {
  const off = offLoopbackHost(host);
  if (off === null) return;
  throw new Error(
    `placessync: the ${server} must listen on loopback only (localhost, 127.0.0.1 or ::1), not ${off}. ` +
      "In dev mode anyone who can reach the port can send Host: localhost, sign in as any employee " +
      "(admins included) and reset the database. See scripts/lib/loopback-only.ts.",
  );
}

export function loopbackOnly(): Plugin {
  return {
    name: "placessync:loopback-only",
    configureServer(server) {
      assertLoopback("dev server", server.config.server.host);
    },
    configurePreviewServer(server) {
      assertLoopback("preview server", server.config.preview.host);
    },
  };
}
