// Dev-only sign in: pick one of the 100 synthetic employees (SPEC 14.1). In access mode
// this page is never reached, and the dev routes answer 404 anyway.
//
// It is also the first page a developer sees on a fresh checkout, so it says what to do
// when the database has no tables (health answers 503 schema_missing) or no synthetic
// employees yet (health reports seeded: false), with a Check again button. Check again
// is disabled while it checks and goes away once the problem is fixed, so focus then
// moves to the Employee field (or back to Check again when the problem remains).
// After a sign-in that expired mid-session (?expired=1) it says so, and signing in
// returns to the page with focus on its heading (the AppShell reads focusHeading).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { DevLoginResponse, DevUsersResponse } from "../../shared/api.ts";
import { ROLE_LABELS, type Role } from "../../shared/roles.ts";
import { api } from "../api/client.ts";
import { useSession } from "../session/SessionProvider.tsx";
import { Button } from "../ui/Button.tsx";
import { Combobox, type ComboboxOption } from "../ui/Combobox.tsx";
import styles from "./pages.module.css";
import { usePageTitle } from "./usePageTitle.ts";

const ROLE_ORDER: Role[] = ["facilities_admin", "facilities_staff", "employee"];
const EMPLOYEE_FIELD_ID = "login-employee";
const AFTER_SIGN_IN = { focusHeading: true };

/**
 * Only a same-origin path: "/x" but never "//host" or "/\host", which browsers treat as
 * another origin. A backslash or a control character anywhere is refused too: browsers
 * drop tab and newline when they parse a URL, so "/<tab>/host" becomes "//host". What is
 * left must still resolve to this origin.
 */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || /[\u0000-\u001f\u007f\\]/.test(next)) return "/find";
  try {
    return new URL(next, window.location.origin).origin === window.location.origin ? next : "/find";
  } catch {
    return "/find";
  }
}

export function DevLoginPage() {
  usePageTitle("Sign in");
  const { session, refresh } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const expired = params.get("expired") === "1";
  const [users, setUsers] = useState<DevUsersResponse["users"] | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const checkRef = useRef<HTMLButtonElement>(null);
  const checked = useRef(false);

  const loadUsers = useCallback(
    () =>
      api
        .get("/api/dev/users", DevUsersResponse)
        .then((r) => {
          setUsers(r.users);
          setLoadError(null);
        })
        .catch(() => setLoadError("Could not load the synthetic users. Seed the database first (npm run seed:local).")),
    [],
  );

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    if (checking || !checked.current) return;
    if (document.activeElement && document.activeElement !== document.body) return;
    if (checkRef.current?.isConnected) checkRef.current.focus();
    else document.getElementById(EMPLOYEE_FIELD_ID)?.focus();
  }, [checking]);

  async function checkAgain() {
    checked.current = true;
    setChecking(true);
    try {
      await Promise.all([loadUsers(), refresh()]);
    } finally {
      setChecking(false);
    }
  }

  const options: ComboboxOption[] = useMemo(
    () =>
      [...(users ?? [])]
        .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.id.localeCompare(b.id))
        .map((u) => ({ value: u.id, label: u.displayName, hint: `${ROLE_LABELS[u.role]}, ${u.department} (${u.id})` })),
    [users],
  );

  const quick = ROLE_ORDER.map((role) => (users ?? []).find((u) => u.role === role)).filter((u): u is DevUsersResponse["users"][number] => Boolean(u));
  const health = session.status === "anonymous" || session.status === "ready" ? session.health : null;
  const schemaProblem = session.status === "error" ? session.message : null;
  const unseeded = !schemaProblem && (health?.seeded === false || (users !== null && users.length === 0));

  async function signIn(employeeId: string | null) {
    if (!employeeId) {
      setError("Choose who to sign in as.");
      return;
    }
    setBusy(true);
    try {
      await api.post("/api/dev/login", { employeeId }, DevLoginResponse);
      await refresh();
      navigate(next, { replace: true, state: AFTER_SIGN_IN });
    } catch {
      setError("Sign in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="main" className={styles.narrow}>
      <h1>Sign in (local development)</h1>
      <p>
        This local build has no Cloudflare Access in front of it. Pick one of the 100 synthetic employees; the server signs a short-lived RS256 token
        with a locally generated key.
      </p>
      {expired && session.status !== "ready" ? (
        <p role="alert" className={styles.notice}>
          Your sign-in expired, so your last action was not saved. Sign in again to continue where you were.
        </p>
      ) : null}
      {session.status === "ready" ? (
        <p className={styles.row}>
          <span>Signed in as {session.employee.displayName}.</span>
          <Link to={next} state={AFTER_SIGN_IN}>
            Continue as {session.employee.displayName}
          </Link>
        </p>
      ) : null}
      {schemaProblem || unseeded ? (
        <div role="alert" className={`${styles.notice} ${styles.stack}`}>
          <p>{schemaProblem ? `Could not load PlacesSync: ${schemaProblem}` : "No synthetic employees yet. Run npm run seed:local in another terminal, then press Check again."}</p>
          <div>
            <Button ref={checkRef} variant="secondary" loading={checking} onClick={() => void checkAgain()}>
              Check again
            </Button>
          </div>
        </div>
      ) : loadError ? (
        <p role="alert">{loadError}</p>
      ) : null}
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          void signIn(choice);
        }}
      >
        <Combobox id={EMPLOYEE_FIELD_ID} label="Employee" options={options} value={choice} onChange={setChoice} placeholder="Type a name" error={error} hint="Grouped by role: admins, staff, then employees." />
        <Button type="submit" loading={busy}>
          Sign in
        </Button>
      </form>
      {quick.length > 0 ? (
        <>
          <h2>Quick picks</h2>
          <ul className={styles.inlineList}>
            {quick.map((u) => (
              <li key={u.id}>
                <Button variant="secondary" onClick={() => void signIn(u.id)}>
                  {ROLE_LABELS[u.role]}: {u.displayName}
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </main>
  );
}
