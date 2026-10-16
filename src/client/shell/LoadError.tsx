// A failed load with a way on: the message and a "Try again" button that calls the
// page's load again. Used by every page's load path and by RequireSession. Not part of
// the UI kit.
import { useState } from "react";
import { Button } from "../ui/Button.tsx";
import styles from "./AppShell.module.css";

export function LoadError({ message, onRetry }: { message: string; onRetry: () => unknown }) {
  const [pending, setPending] = useState(false);
  return (
    <div role="alert" className={styles.loadError}>
      <p className={styles.bannerText}>{message}</p>
      <Button
        variant="secondary"
        loading={pending}
        onClick={async () => {
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
