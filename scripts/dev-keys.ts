// Writes .dev.vars with a fresh RS256 dev keypair (SPEC 5, 9.2). Other lines already in
// .dev.vars (for example TRIAGE_PROVIDER=openai-compat) are kept.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { exportJWK, generateKeyPair } from "jose";

const file = path.join(import.meta.dirname, "..", ".dev.vars");
const kid = `dev-${new Date().toISOString().slice(0, 10)}`;
const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" };
const privateJwk = { ...(await exportJWK(privateKey)), kid, alg: "RS256" };

const kept = existsSync(file)
  ? readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "" && !l.startsWith("DEV_ACCESS_PRIVATE_JWK=") && !l.startsWith("DEV_ACCESS_JWKS="))
  : [];

const lines = [
  `DEV_ACCESS_PRIVATE_JWK='${JSON.stringify(privateJwk)}'`,
  `DEV_ACCESS_JWKS='${JSON.stringify({ keys: [publicJwk] })}'`,
  ...kept,
];
writeFileSync(file, `${lines.join("\n")}\n`, { mode: 0o600 });
console.log(`wrote ${path.relative(process.cwd(), file)} with a fresh RS256 dev key (kid ${kid})`);
