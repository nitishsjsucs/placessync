import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { loopbackOnly } from "./scripts/lib/loopback-only.ts";

export default defineConfig({
  // The Workers inspector uses 9233 so this repo never collides with other local
  // projects on the default 9229. loopbackOnly refuses to start the dev server or the
  // preview on a non-loopback host, where dev mode's localhost guard would not hold.
  plugins: [loopbackOnly(), react(), cloudflare({ inspectorPort: 9233 })],
  preview: { port: 8783, strictPort: true },
  server: { port: 8783, strictPort: true },
});
