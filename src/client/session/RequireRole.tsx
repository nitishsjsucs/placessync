// Route guards: RequireSession sends anonymous visitors to sign in; RequireRole
// redirects employees away from staff and admin pages (the API enforces it too).
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import type { Role } from "../../shared/roles.ts";
import pageStyles from "../pages/pages.module.css";
import { LoadError } from "../shell/LoadError.tsx";
import { Button } from "../ui/Button.tsx";
import { useSession } from "./SessionProvider.tsx";

function Standalone({ children }: { children: ReactNode }) {
  return (
    <main id="main" className={pageStyles.narrow} tabIndex={-1}>
      <h1>PlacesSync</h1>
      {children}
    </main>
  );
}

export function RequireSession({ children }: { children: ReactNode }) {
  const { session, refresh } = useSession();
  const location = useLocation();
  if (session.status === "loading") return <p role="status">Loading your session…</p>;
  if (session.status === "error") {
    return (
      <Standalone>
        <LoadError message={`Could not load PlacesSync: ${session.message}`} onRetry={refresh} />
      </Standalone>
    );
  }
  if (session.status === "anonymous") {
    if (session.health.authMode === "dev") return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
    if (session.reason === "unknown_user") {
      return (
        <Standalone>
          <p role="alert">This account is not set up in PlacesSync. Ask a facilities admin.</p>
        </Standalone>
      );
    }
    if (session.reason === "expired") {
      return (
        <Standalone>
          <div role="alert" className={pageStyles.stack}>
            <p>Your sign-in has expired. Reload to sign in again.</p>
            <div>
              <Button onClick={() => window.location.reload()}>Reload</Button>
            </div>
          </div>
        </Standalone>
      );
    }
    return (
      <Standalone>
        <p role="alert">Sign in through Cloudflare Access to use PlacesSync.</p>
      </Standalone>
    );
  }
  return <>{children}</>;
}

export function RequireRole({ roles, children }: { roles: readonly Role[]; children: ReactNode }) {
  const { session } = useSession();
  if (session.status !== "ready") return null;
  if (!roles.includes(session.employee.role)) return <Navigate to="/find" replace />;
  return <>{children}</>;
}
