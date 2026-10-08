// Migrates local D1 and seeds the synthetic world through the dev route (SPEC 12.4).
import { execFileSync } from "node:child_process";
import path from "node:path";

const BASE = "http://localhost:8783";

export default async function globalSetup(): Promise<void> {
  const root = path.join(import.meta.dirname, "..");
  execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--local"], { cwd: root, stdio: "inherit", env: { ...process.env, CI: "1" } });
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) break;
    } catch {
      // Server not up yet.
    }
    if (Date.now() > deadline) throw new Error("preview server did not answer /api/health");
    await new Promise((r) => setTimeout(r, 500));
  }
  const res = await fetch(`${BASE}/api/dev/seed`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reset: true, history: false }) });
  if (!res.ok) throw new Error(`seed failed: ${res.status} ${await res.text()}`);
  console.log("seeded", await res.json());
}
