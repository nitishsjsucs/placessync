// Seeds a running local server through the dev route:
//   node scripts/seed-local.ts --base-url http://localhost:8783 [--history] [--no-reset]
// --history also imports 20 business days of past bookings for the admin reports.
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { "base-url": { type: "string", default: "http://localhost:8783" }, "no-reset": { type: "boolean", default: false }, history: { type: "boolean", default: false } },
});
const base = String(values["base-url"]).replace(/\/$/, "");
const res = await fetch(`${base}/api/dev/seed`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ reset: !values["no-reset"], history: values.history }),
});
const text = await res.text();
if (!res.ok) {
  console.error(`seed failed: ${res.status} ${text}`);
  process.exit(1);
}
console.log(`seeded ${base}: ${text}`);
