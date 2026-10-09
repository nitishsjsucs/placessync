import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FullResult, TestCase, TestResult } from "@playwright/test/reporter";
import { describe, expect, it } from "vitest";
import ResultsReporter from "../../e2e/results-reporter.ts";

// Just enough of Playwright's TestCase and TestResult for the reporter.
function testCase(file: string, title: string): TestCase {
  return { titlePath: () => ["", file, title], location: { file: path.join("/repo/e2e", file), line: 1, column: 1 } } as unknown as TestCase;
}
function result(status: TestResult["status"], attachments: TestResult["attachments"] = []): TestResult {
  return { status, attachments } as unknown as TestResult;
}

function run(events: [TestCase, TestResult][]) {
  const out = path.join(mkdtempSync(path.join(os.tmpdir(), "placessync-reporter-")), "e2e.json");
  const reporter = new ResultsReporter({ out });
  for (const [t, r] of events) reporter.onTestEnd(t, r);
  reporter.onEnd({ status: "passed" } as FullResult);
  return JSON.parse(readFileSync(out, "utf8")) as { summary: { keyboardPaths: { test: string; passed: boolean }[]; tests: number } };
}

describe("e2e results reporter (SPEC 12.4)", () => {
  const keyboard = testCase("keyboard-booking.spec.ts", "book a desk and cancel it using only the keyboard");
  const attachment = { name: "keyboard", contentType: "application/json", body: Buffer.from(JSON.stringify({ ok: true })) };

  it("records a passing keyboard path", () => {
    expect(run([[keyboard, result("passed", [attachment])]]).summary.keyboardPaths).toEqual([{ test: "keyboard-booking.spec.ts > book a desk and cancel it using only the keyboard", passed: true }]);
  });

  it("records a failed keyboard test as failed even though it attached nothing", () => {
    expect(run([[keyboard, result("failed")]]).summary.keyboardPaths).toEqual([{ test: "keyboard-booking.spec.ts > book a desk and cancel it using only the keyboard", passed: false }]);
  });

  it("records no keyboard path when the keyboard spec did not run", () => {
    const other = testCase("a11y.spec.ts", "login page");
    const json = run([[other, result("passed")]]);
    expect(json.summary.tests).toBe(1);
    expect(json.summary.keyboardPaths).toEqual([]);
  });
});
