// Page chrome: skip links, header with the signed-in employee, role-based navigation
// (a bottom bar under 640 px) and the main landmark. Not part of the UI kit.
// On Find a space and a resource calendar a second skip link jumps past the date picker
// and filters to the slot grid (#slots). When the pathname changes (not on first load,
// a redirect, or a search-parameter change) focus moves to the new page's h1, or to
// main while the page has none yet, instead of staying on the link that was used.
import { useEffect, useRef } from "react";
import { Link, Outlet, useLocation, useNavigationType } from "react-router";
import { ROLE_LABELS } from "../../shared/roles.ts";
import { useReadySession, useSession } from "../session/SessionProvider.tsx";
import { Button } from "../ui/Button.tsx";
import styles from "./AppShell.module.css";
import { Nav } from "./Nav.tsx";
import { StatusBanner, StatusBannerProvider } from "./StatusBanner.tsx";

/** The second skip link's text for a path, or null when the page has no slot grid. */
export function gridSkipLabel(pathname: string): string | null {
  if (pathname === "/find") return "Skip to availability";
  if (/^\/resources\/[^/]+$/.test(pathname)) return "Skip to week grid";
  return null;
}

export function AppShell() {
  const { employee, health } = useReadySession();
  const { signOut } = useSession();
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const lastPath = useRef(pathname);

  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    if (navigationType === "REPLACE") return;
    const heading = document.querySelector<HTMLElement>("#main h1");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus();
    } else {
      document.getElementById("main")?.focus();
    }
  }, [pathname, navigationType]);

  const gridSkip = gridSkipLabel(pathname);
  return (
    <StatusBannerProvider>
      <a href="#main" className={styles.skip}>
        Skip to main content
      </a>
      {gridSkip ? (
        <a href="#slots" className={styles.skip}>
          {gridSkip}
        </a>
      ) : null}
      <header className={styles.header}>
        <Link to="/find" className={styles.brand}>
          PlacesSync
        </Link>
        <div className={styles.user}>
          <span className={styles.userName}>
            {employee.displayName} <span aria-hidden="true">·</span> {ROLE_LABELS[employee.role]}
          </span>
          {health.authMode === "dev" ? (
            <Button variant="secondary" size="sm" onClick={() => void signOut()}>
              Sign out
            </Button>
          ) : null}
        </div>
      </header>
      <Nav role={employee.role} />
      <main id="main" className={styles.main} tabIndex={-1}>
        <StatusBanner />
        <Outlet />
      </main>
      <footer className={styles.footer}>
        <Link to="/ui">UI kit gallery</Link>
      </footer>
    </StatusBannerProvider>
  );
}
