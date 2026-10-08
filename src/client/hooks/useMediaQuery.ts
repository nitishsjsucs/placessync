// JS media-query switch (SPEC 14.1): used where the breakpoint changes the rendered
// structure (SlotGrid compact mode), so it can be tested in jsdom with a matchMedia stub.
import { useEffect, useState } from "react";

function current(query: string): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => current(query));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export const COMPACT_QUERY = "(max-width: 639px)";
