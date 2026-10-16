// The suggestion matrix's sequential ramp (VIZ-09): every step prints its count in an
// ink chosen for that step, so the text must clear WCAG's 4.5:1 on it in both themes, and
// the steps must get darker (light) or lighter (dark) as the share grows.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(import.meta.dirname, "../../src/client/ui/tokens.css"), "utf8");
const matrixCss = readFileSync(path.join(import.meta.dirname, "../../src/client/charts/matrix.module.css"), "utf8");

function block(source: string, start: number): string {
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error("unbalanced braces");
}

function vars(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(m[1] as string, (m[2] as string).trim());
  return out;
}

const light = vars(block(css, css.indexOf(":root")));
const darkMedia = block(css, css.indexOf("@media (prefers-color-scheme: dark)"));
const dark = vars(block(darkMedia, darkMedia.indexOf(":root")));

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

describe("chart sequential ramp tokens (VIZ-09)", () => {
  for (const [mode, tokens] of [
    ["light", light],
    ["dark", dark],
  ] as const) {
    it(`${mode}: each of the five steps has an ink at 4.5:1 or more`, () => {
      for (let n = 1; n <= 5; n++) {
        const fill = tokens.get(`--chart-seq-${n}`);
        const ink = tokens.get(`--chart-seq-${n}-ink`);
        expect(fill, `--chart-seq-${n} in ${mode}`).toMatch(/^#[0-9a-f]{6}$/i);
        expect(ink, `--chart-seq-${n}-ink in ${mode}`).toMatch(/^#[0-9a-f]{6}$/i);
        expect(contrast(fill as string, ink as string), `step ${n} in ${mode}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it("orders the steps by lightness: darker as the share grows in light, lighter in dark", () => {
    const l = [1, 2, 3, 4, 5].map((n) => luminance(light.get(`--chart-seq-${n}`) as string));
    const d = [1, 2, 3, 4, 5].map((n) => luminance(dark.get(`--chart-seq-${n}`) as string));
    for (let i = 1; i < 5; i++) {
      expect(l[i]).toBeLessThan(l[i - 1] as number);
      expect(d[i]).toBeGreaterThan(d[i - 1] as number);
    }
  });

  it("the lightest light step and the darkest dark step stay visible on the table surface (2:1, the ordinal floor)", () => {
    expect(contrast(light.get("--chart-seq-1") as string, light.get("--color-surface") as string)).toBeGreaterThanOrEqual(2);
    expect(contrast(dark.get("--chart-seq-1") as string, dark.get("--color-surface") as string)).toBeGreaterThanOrEqual(2);
  });

  it("the kept outline is a --color-text ring with a surface gap inside it, on the surface table, at 3:1 or more in both themes", () => {
    // The ring touches only the surface: the table's 2px border spacing outside it and its own
    // gap inside it. Drawn straight on the fill it fell to 1.39:1 on the darkest light step.
    const rule = block(matrixCss, matrixCss.indexOf(".diagonal {"));
    const shadow = /box-shadow:\s*inset 0 0 0 2px var\(--color-text\),\s*inset 0 0 0 (\d+)px var\(--color-surface\);/.exec(rule);
    expect(shadow, ".diagonal box-shadow").not.toBeNull();
    expect(Number(shadow?.[1])).toBeGreaterThanOrEqual(4);
    expect(block(matrixCss, matrixCss.indexOf(".matrix {"))).toMatch(/background: var\(--color-surface\);/);
    for (const tokens of [light, dark]) {
      expect(contrast(tokens.get("--color-text") as string, tokens.get("--color-surface") as string)).toBeGreaterThanOrEqual(3);
    }
    // Forced colors drop the shadow; an outline keeps the mark.
    expect(block(matrixCss, matrixCss.indexOf("@media (forced-colors: active)"))).toMatch(/\.diagonal\s*\{\s*outline: 2px solid CanvasText;/);
  });
});
