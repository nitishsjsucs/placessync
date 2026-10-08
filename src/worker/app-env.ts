import type { AccessVerifier, VerifierFactory } from "./auth/access-verifier.ts";
import type { Principal } from "./auth/principal.ts";
import type { Config } from "./config.ts";

export interface AppDeps {
  verifierFactory: VerifierFactory;
  now: () => number;
  newId: (prefix: string) => string;
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
