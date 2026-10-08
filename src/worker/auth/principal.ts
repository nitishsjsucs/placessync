import type { Role } from "../../shared/roles.ts";

/** The authenticated caller. The role always comes from D1, never from a token claim. */
export interface Principal {
  employeeId: string;
  email: string;
  displayName: string;
  department: string;
  role: Role;
  /** Token expiry in seconds since the epoch; WebSocket attachments carry it (SPEC 7.1). */
  exp: number;
}
