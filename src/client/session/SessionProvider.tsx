// Loads /api/health and /api/me once and shares the signed-in employee. A 401 means
// "not signed in"; in dev mode the app sends the visitor to /login.
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { type EmployeeSummary, HealthResponse, MeResponse } from "../../shared/api.ts";
import { ApiClientError, api } from "../api/client.ts";

export type SessionState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "anonymous"; health: HealthResponse }
  | { status: "ready"; health: HealthResponse; employee: EmployeeSummary };

interface SessionContextValue {
  session: SessionState;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState>({ status: "loading" });

  const refresh = useCallback(async () => {
    try {
      const health = await api.get("/api/health", HealthResponse);
      try {
        const me = await api.get("/api/me", MeResponse);
        setSession({ status: "ready", health, employee: me.employee });
      } catch (err) {
        if (err instanceof ApiClientError && (err.status === 401 || err.status === 403)) setSession({ status: "anonymous", health });
        else throw err;
      }
    } catch (err) {
      setSession({ status: "error", message: err instanceof Error ? err.message : "Could not reach the server." });
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.postRaw("/api/dev/logout");
    } finally {
      await refresh();
    }
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(() => ({ session, refresh, signOut }), [session, refresh, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession outside SessionProvider");
  return ctx;
}

/** The signed-in employee and health; only valid under RequireSession. */
export function useReadySession(): { employee: EmployeeSummary; health: HealthResponse } {
  const { session } = useSession();
  if (session.status !== "ready") throw new Error("useReadySession without a session");
  return { employee: session.employee, health: session.health };
}
