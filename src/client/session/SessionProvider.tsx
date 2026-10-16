// Loads /api/health and /api/me and shares the signed-in employee. A 401 means "not
// signed in"; in dev mode the app sends the visitor to /login. It checks again whenever
// a data route answers 401 (api/client.ts onUnauthorized), so an expired sign-in leads
// back to sign-in instead of failing every action.
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { type EmployeeSummary, HealthResponse, MeResponse } from "../../shared/api.ts";
import { ApiClientError, api, onUnauthorized } from "../api/client.ts";

/**
 * Why there is no session: never signed in (or signed out), a sign-in that expired while
 * the app was open, or an identity PlacesSync does not know (403 unknown_user).
 */
export type AnonymousReason = "signed_out" | "expired" | "unknown_user";

export type SessionState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "anonymous"; health: HealthResponse; reason: AnonymousReason }
  | { status: "ready"; health: HealthResponse; employee: EmployeeSummary };

interface SessionContextValue {
  session: SessionState;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState>({ status: "loading" });
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const inflight = useRef<Promise<void> | null>(null);

  const check = useCallback(async (signedOut: boolean) => {
    try {
      const health = await api.get("/api/health", HealthResponse);
      try {
        const me = await api.get("/api/me", MeResponse);
        setSession({ status: "ready", health, employee: me.employee });
      } catch (err) {
        if (err instanceof ApiClientError && (err.status === 401 || err.status === 403)) {
          const reason: AnonymousReason =
            err.code === "unknown_user" ? "unknown_user" : !signedOut && sessionRef.current.status === "ready" ? "expired" : "signed_out";
          setSession({ status: "anonymous", health, reason });
        } else throw err;
      }
    } catch (err) {
      setSession({ status: "error", message: err instanceof Error ? err.message : "Could not reach the server." });
    }
  }, []);

  const refresh = useCallback(() => {
    const p: Promise<void> = check(false).finally(() => {
      if (inflight.current === p) inflight.current = null;
    });
    inflight.current = p;
    return p;
  }, [check]);

  const signOut = useCallback(async () => {
    try {
      await api.postRaw("/api/dev/logout");
    } finally {
      await check(true);
    }
  }, [check]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Several 401s at once (a page loading in parallel) share one check.
  useEffect(
    () =>
      onUnauthorized(() => {
        if (!inflight.current) void refresh();
      }),
    [refresh],
  );

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
