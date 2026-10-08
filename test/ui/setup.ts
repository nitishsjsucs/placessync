import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// findBy* and waitFor default to 1 s, which a full-page render can exceed when the
// machine is loaded (other builds, battery). Waits stay event-driven; only the ceiling rises.
configure({ asyncUtilTimeout: 5000 });

// jsdom has no window.matchMedia (SPEC 12.2, m10). This stub lets tests flip media
// queries: setMediaMatches("(max-width: 639px)", true).
type Listener = (e: MediaQueryListEvent) => void;
const state = new Map<string, boolean>();
const listeners = new Map<string, Set<Listener>>();

export function setMediaMatches(query: string, matches: boolean): void {
  state.set(query, matches);
  for (const l of listeners.get(query) ?? []) l({ matches, media: query } as MediaQueryListEvent);
}

Object.defineProperty(window, "matchMedia", {
  writable: true,
  configurable: true,
  value: (query: string): MediaQueryList => {
    const set = listeners.get(query) ?? new Set<Listener>();
    listeners.set(query, set);
    return {
      get matches() {
        return state.get(query) ?? false;
      },
      media: query,
      onchange: null,
      addEventListener: (_: string, l: Listener) => set.add(l),
      removeEventListener: (_: string, l: Listener) => set.delete(l),
      addListener: (l: Listener) => set.add(l),
      removeListener: (l: Listener) => set.delete(l),
      dispatchEvent: () => true,
    } as unknown as MediaQueryList;
  },
});

afterEach(() => {
  cleanup();
  state.clear();
  listeners.clear();
});
