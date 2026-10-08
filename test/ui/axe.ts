import axe from "axe-core";
import { expect } from "vitest";

/**
 * Component-level axe check. Two rules are off here, and only here: color-contrast
 * (jsdom has no layout or computed colors) and region (a bare component is rendered
 * without page landmarks). The Playwright a11y gate runs every rule on real pages.
 */
export async function expectNoAxeViolations(container: Element = document.body): Promise<void> {
  const results = await axe.run(container, {
    rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
  });
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(" | ")}`)).toEqual([]);
}
