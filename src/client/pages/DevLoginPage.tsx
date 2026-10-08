// Dev-only sign in: pick one of the 100 synthetic employees (SPEC 14.1). In access mode
// this page is never reached, and the dev routes answer 404 anyway.
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { DevLoginResponse, DevUsersResponse } from "../../shared/api.ts";
import { ROLE_LABELS, type Role } from "../../shared/roles.ts";
import { api } from "../api/client.ts";
import { useSession } from "../session/SessionProvider.tsx";
import { Button } from "../ui/Button.tsx";
import { Combobox, type ComboboxOption } from "../ui/Combobox.tsx";
import styles from "./pages.module.css";
import { usePageTitle } from "./usePageTitle.ts";

const ROLE_ORDER: Role[] = ["facilities_admin", "facilities_staff", "employee"];

export function DevLoginPage() {
  usePageTitle("Sign in");
  const { session, refresh } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [users, setUsers] = useState<DevUsersResponse["users"]>([]);
  const [choice, setChoice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get("/api/dev/users", DevUsersResponse)
      .then((r) => setUsers(r.users))
      .catch(() => setLoadError("Could not load the synthetic users. Seed the database first (npm run seed:local)."));
  }, []);

  const options: ComboboxOption[] = useMemo(
    () =>
      [...users]
        .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.id.localeCompare(b.id))
        .map((u) => ({ value: u.id, label: u.displayName, hint: `${ROLE_LABELS[u.role]}, ${u.department} (${u.id})` })),
    [users],
  );

  const quick = ROLE_ORDER.map((role) => users.find((u) => u.role === role)).filter((u): u is DevUsersResponse["users"][number] => Boolean(u));

  async function signIn(employeeId: string | null) {
    if (!employeeId) {
      setError("Choose who to sign in as.");
      return;
    }
    setBusy(true);
    try {
      await api.post("/api/dev/login", { employeeId }, DevLoginResponse);
      await refresh();
      navigate(params.get("next") || "/find", { replace: true });
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
      {session.status === "ready" ? <p>Signed in as {session.employee.displayName}.</p> : null}
      {loadError ? <p role="alert">{loadError}</p> : null}
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          void signIn(choice);
        }}
      >
        <Combobox label="Employee" options={options} value={choice} onChange={setChoice} placeholder="Type a name" error={error} hint="Grouped by role: admins, staff, then employees." />
        <Button type="submit" loading={busy}>
          Sign in
        </Button>
      </form>
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
    </main>
  );
}
