// The result of the last action, shown at the top of main with a next step: "Booked
// Desk 2A-01 ... See My bookings". Pages call show() next to announce(). It is not a
// live region (the Announcer speaks); a page passes focus: true when the control that
// was used is gone or disabled, so keyboard users land on the result instead of body.
// Not part of the UI kit (test/ui/ui-kit.test.ts counts exactly eight components).
//
// The banner belongs to the page it was shown on: it clears when the pathname changes
// or another message replaces it, and has no timer. It focuses itself in a passive
// effect, which runs after a closing Dialog's focus-restore cleanup in the same commit.
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { Button } from "../ui/Button.tsx";
import styles from "./AppShell.module.css";

export interface BannerMessage {
  text: string;
  link?: { to: string; label: string };
  /** Move focus to the banner (use when the trigger is gone or disabled). */
  focus?: boolean;
}

interface Shown extends BannerMessage {
  id: number;
  path: string;
}

interface BannerContextValue {
  shown: Shown | null;
  show: (message: BannerMessage) => void;
  dismiss: () => void;
}

const BannerContext = createContext<BannerContextValue>({ shown: null, show: () => {}, dismiss: () => {} });

export function StatusBannerProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const seq = useRef(0);
  const [state, setState] = useState<Shown | null>(null);
  const show = useCallback((message: BannerMessage) => {
    seq.current += 1;
    setState({ ...message, id: seq.current, path: pathRef.current });
  }, []);
  const dismiss = useCallback(() => setState(null), []);

  // A message never follows the viewer to another page, or back to this one.
  useEffect(() => {
    setState((s) => (s && s.path !== pathname ? null : s));
  }, [pathname]);

  const shown = state && state.path === pathname ? state : null;
  const value = useMemo(() => ({ shown, show, dismiss }), [shown, show, dismiss]);
  return <BannerContext.Provider value={value}>{children}</BannerContext.Provider>;
}

export function useStatusBanner(): { show: (message: BannerMessage) => void; dismiss: () => void } {
  const { show, dismiss } = useContext(BannerContext);
  return useMemo(() => ({ show, dismiss }), [show, dismiss]);
}

function focusMain() {
  document.getElementById("main")?.focus();
}

export function StatusBanner() {
  const { shown, dismiss } = useContext(BannerContext);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (shown?.focus) ref.current?.focus();
  }, [shown]);

  if (!shown) return null;
  return (
    <div ref={ref} tabIndex={-1} className={styles.banner} data-testid="status-banner">
      <p className={styles.bannerText}>
        {shown.text}
        {shown.link ? (
          <>
            {" "}
            <Link
              to={shown.link.to}
              onClick={() => {
                dismiss();
                focusMain();
              }}
            >
              {shown.link.label}
            </Link>
          </>
        ) : null}
      </p>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          dismiss();
          focusMain();
        }}
      >
        Dismiss
      </Button>
    </div>
  );
}
