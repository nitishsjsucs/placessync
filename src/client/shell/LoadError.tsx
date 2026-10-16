// A failed load with a way on: the message and a "Try again" button that calls the
// page's load again. Used by every page's load path and by RequireSession. Not part of
// the UI kit.
//
// Try again is disabled while the retry runs, and the page usually replaces this message
// once it settles, so focus would fall to body either way. It is put back: on Try again
// when the message is still showing (the retry failed), else on focusAfter (the region
// that replaced the message), else on the page's h1, else on main.
import { type RefObject, useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button.tsx";
import styles from "./AppShell.module.css";

const focusLost = () => document.activeElement === null || document.activeElement === document.body;

export function LoadError({ message, onRetry, focusAfter }: { message: string; onRetry: () => unknown; focusAfter?: RefObject<HTMLElement | null> }) {
  const [pending, setPending] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const used = useRef(false);
  const focusAfterRef = useRef(focusAfter);
  focusAfterRef.current = focusAfter;

  useEffect(() => {
    if (!pending && used.current && focusLost()) buttonRef.current?.focus();
  }, [pending]);

  // On unmount, after the content that replaced the message is in the document.
  useEffect(
    () => () => {
      if (!used.current || !focusLost()) return;
      const target = focusAfterRef.current?.current ?? document.querySelector<HTMLElement>("#main h1") ?? document.getElementById("main");
      if (!target) return;
      if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
      target.focus();
    },
    [],
  );

  return (
    <div role="alert" className={styles.loadError}>
      <p className={styles.bannerText}>{message}</p>
      <Button
        ref={buttonRef}
        variant="secondary"
        loading={pending}
        onClick={async () => {
          used.current = true;
          setPending(true);
          try {
            await onRetry();
          } finally {
            setPending(false);
          }
        }}
      >
        Try again
      </Button>
    </div>
  );
}
