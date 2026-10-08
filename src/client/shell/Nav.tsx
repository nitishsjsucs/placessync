import { NavLink } from "react-router";
import type { Role } from "../../shared/roles.ts";
import styles from "./AppShell.module.css";

interface Item {
  to: string;
  label: string;
  roles?: readonly Role[];
}

const ITEMS: readonly Item[] = [
  { to: "/find", label: "Find a space" },
  { to: "/bookings", label: "My bookings" },
  { to: "/requests/new", label: "Report issue" },
  { to: "/requests", label: "My requests" },
  { to: "/staff", label: "Staff", roles: ["facilities_staff", "facilities_admin"] },
  { to: "/admin", label: "Admin", roles: ["facilities_admin"] },
];

export function Nav({ role }: { role: Role }) {
  return (
    <nav aria-label="Main" className={styles.nav}>
      <ul className={styles.navList}>
        {ITEMS.filter((i) => !i.roles || i.roles.includes(role)).map((i) => (
          <li key={i.to}>
            <NavLink to={i.to} end className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navActive : ""}`}>
              {i.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
