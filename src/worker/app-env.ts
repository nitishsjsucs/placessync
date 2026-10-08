import type { AccessVerifier, VerifierFactory } from "./auth/access-verifier.ts";
import type { Principal } from "./auth/principal.ts";
import type { Config } from "./config.ts";
import type { TriageWorkflowBinding } from "./triage/start-triage.ts";

export interface AppDeps {
  verifierFactory: VerifierFactory;
  now: () => number;
  newId: (prefix: string) => string;
  /** The Workflow binding used to start triage; a test seam for create() failures. */
  triageWorkflow: (env: Env) => TriageWorkflowBinding;
}

export interface AppEnv {
  Bindings: Env;
  Variables: {
    config: Config;
    deps: AppDeps;
    verifier: AccessVerifier;
    principal: Principal;
  };
}
