import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // The Workers inspector uses 9233 so this repo never collides with other local
  // projects on the default 9229.
  plugins: [react(), cloudflare({ inspectorPort: 9233 })],
  preview: { port: 8783, strictPort: true },
  server: { port: 8783, strictPort: true },
});
