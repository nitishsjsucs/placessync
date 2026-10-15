// The production verification identity (README "Production setup"). `npm run prod:verify`
// calls the deployed Worker with an Access service token, through a Service Auth policy, so
// it needs no One-time PIN sign-in. Access then signs a token with no email whose
// common_name is the service token's Client ID. When that Client ID equals the configured
// ACCESS_SERVICE_CLIENT_ID, the request acts as this one D1 employee; any other service
// token gets 401. The role still comes from D1 (the production seed makes it an employee),
// never from the token.
import { SERVICE_PRINCIPAL_ID } from "../../shared/service-principal.ts";
import { type EmployeeRow, findEmployeeById } from "../repo/employees.ts";

export { SERVICE_PRINCIPAL_ID };

/** The verification employee, if it exists and is active. */
export async function findServicePrincipal(db: D1Database): Promise<EmployeeRow | null> {
  const row = await findEmployeeById(db, SERVICE_PRINCIPAL_ID);
  return row?.active ? row : null;
}
