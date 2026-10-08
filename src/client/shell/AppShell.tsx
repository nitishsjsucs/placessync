// Page chrome: skip link, header with the signed-in employee, role-based navigation
// (a bottom bar under 640 px) and the main landmark. Not part of the UI kit.
import { Link, Outlet } from "react-router";
import { ROLE_LABELS } from "../../shared/roles.ts";
import { useReadySession, useSession } from "../session/SessionProvider.tsx";
import { Button } from "../ui/Button.tsx";
import styles from "./AppShell.module.css";
import { Nav } from "./Nav.tsx";

export function AppShell() {
  const { employee, health } = useReadySession();
  const { signOut } = useSession();
  return (
    <>
      <a href="#main" className={styles.skip}>
        Skip to main content
      </a>
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
        <Outlet />
      </main>
      <footer className={styles.footer}>
        <Link to="/ui">UI kit gallery</Link>
      </footer>
    </>
  );
}
