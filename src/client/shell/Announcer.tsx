// One polite live region for the whole app: pages call announce() after actions such
// as a booking or a cancellation. Not part of the UI kit.
import { type ReactNode, createContext, useCallback, useContext, useRef, useState } from "react";

const AnnouncerContext = createContext<(message: string) => void>(() => {});

export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announce = useCallback((text: string) => {
    // Clear first so repeating the same text is announced again.
    setMessage("");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(text), 30);
  }, []);
  return (
    <AnnouncerContext.Provider value={announce}>
      {children}
      <div className="visually-hidden" role="status" aria-live="polite" data-testid="announcer">
        {message}
      </div>
    </AnnouncerContext.Provider>
  );
}

export function useAnnounce(): (message: string) => void {
  return useContext(AnnouncerContext);
}
