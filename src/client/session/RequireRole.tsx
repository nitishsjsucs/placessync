// Route guards: RequireSession sends anonymous visitors to sign in; RequireRole
// redirects employees away from staff and admin pages (the API enforces it too).
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import type { Role } from "../../shared/roles.ts";
import { useSession } from "./SessionProvider.tsx";

export function RequireSession({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const location = useLocation();
  if (session.status === "loading") return <p role="status">Loading your session…</p>;
  if (session.status === "error") return <p role="alert">Could not load PlacesSync: {session.message}</p>;
  if (session.status === "anonymous") {
    if (session.health.authMode === "dev") return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
    return <p role="alert">Sign in through Cloudflare Access to use PlacesSync.</p>;
  }
  return <>{children}</>;
}

export function RequireRole({ roles, children }: { roles: readonly Role[]; children: ReactNode }) {
  const { session } = useSession();
  if (session.status !== "ready") return null;
  if (!roles.includes(session.employee.role)) return <Navigate to="/find" replace />;
  return <>{children}</>;
}
