// Custom Playwright reporter (SPEC 12.4): collects the JSON attachments the specs add
// (axe, overflow, keyboard, latency) and writes evals/results/e2e.json with the same
// meta block as the evals.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";
import { ROOT, runMeta } from "../scripts/lib/meta.ts";

interface Collected {
  test: string;
  status: string;
  data: unknown;
}

export default class ResultsReporter implements Reporter {
  private readonly out: string;
  private readonly meta = runMeta({ extra: { command: "npm run test:e2e", runner: "playwright 1.63.0", browser: "chromium (Playwright build 1243)" } });
  private readonly attachments: Record<string, Collected[]> = { axe: [], overflow: [], keyboard: [], latency: [] };
  private readonly outcomes: { title: string; status: string }[] = [];

  constructor(options: { out?: string } = {}) {
    this.out = path.join(ROOT, options.out ?? "evals/results/e2e.json");
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const title = test.titlePath().slice(1).join(" > ");
    this.outcomes.push({ title, status: result.status });
    for (const a of result.attachments) {
      if (!(a.name in this.attachments) || !a.body) continue;
      this.attachments[a.name]?.push({ test: title, status: result.status, data: JSON.parse(a.body.toString("utf8")) });
    }
  }

  onEnd(result: FullResult): void {
    const axe = this.attachments.axe ?? [];
    const overflow = this.attachments.overflow ?? [];
    const summary = {
      status: result.status,
      tests: this.outcomes.length,
      passed: this.outcomes.filter((o) => o.status === "passed").length,
      failed: this.outcomes.filter((o) => o.status === "failed" || o.status === "timedOut").length,
      axeScans: axe.length,
      axeViolations: axe.reduce((n, a) => n + Number((a.data as { violations?: number }).violations ?? 0), 0),
      overflowChecks: overflow.length,
      overflowFailures: overflow.filter((o) => !(o.data as { ok?: boolean }).ok).length,
      keyboardPaths: (this.attachments.keyboard ?? []).map((k) => ({ test: k.test, passed: k.status === "passed" })),
      realtimeLatencyMs: (this.attachments.latency ?? []).map((l) => {
        const d = l.data as { bookings: number; p50: number; p95: number };
        return { bookings: d.bookings, p50: d.p50, p95: d.p95 };
      })[0] ?? null,
    };
    mkdirSync(path.dirname(this.out), { recursive: true });
    writeFileSync(this.out, `${JSON.stringify({ meta: this.meta, summary, attachments: this.attachments, outcomes: this.outcomes }, null, 2)}\n`);
  }
}
