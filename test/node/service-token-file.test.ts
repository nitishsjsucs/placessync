// The verification service token's credentials on this Mac: written 0600 in a 0700 folder
// that git ignores, read back only when well-formed, and never described with the secret.
import { execFileSync } from "node:child_process";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SERVICE_TOKEN_FILE, credentialsFromEnv, describeCredentials, readServiceToken, serviceTokenHeaders, writeServiceToken } from "../../scripts/lib/service-token-file.ts";

const CLIENT_ID = "0123456789abcdef0123456789abcdef.access";
const SECRET = "s3cret_value_that_must_not_print";

describe("service token credentials file", () => {
  it("round-trips with owner-only permissions", () => {
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), "placessync-sv-")), "nested", "token.json");
    writeServiceToken({ tokenId: "tok-1", clientId: CLIENT_ID, clientSecret: SECRET }, file, new Date("2026-10-15T00:00:00Z"));
    expect(readServiceToken(file)).toEqual({ tokenId: "tok-1", clientId: CLIENT_ID, clientSecret: SECRET, writtenAt: "2026-10-15T00:00:00.000Z" });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
  });

  it("reads nothing from a missing or malformed file, and refuses to store a malformed token", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "placessync-sv-"));
    expect(readServiceToken(path.join(dir, "absent.json"))).toBeNull();
    const bad = path.join(dir, "bad.json");
    writeFileSync(bad, JSON.stringify({ tokenId: "t", clientId: "not-a-client-id", clientSecret: "x" }));
    expect(readServiceToken(bad)).toBeNull();
    writeFileSync(bad, "{");
    expect(readServiceToken(bad)).toBeNull();
    expect(() => writeServiceToken({ tokenId: "t", clientId: CLIENT_ID, clientSecret: "" }, path.join(dir, "x.json"))).toThrow();
  });

  it("describes the credentials and builds Access headers without printing the secret in the description", () => {
    expect(describeCredentials({ clientId: CLIENT_ID })).not.toContain(SECRET);
    expect(serviceTokenHeaders({ clientId: CLIENT_ID, clientSecret: SECRET })).toEqual({ "CF-Access-Client-Id": CLIENT_ID, "CF-Access-Client-Secret": SECRET });
  });

  it("takes both values from the environment or neither", () => {
    expect(credentialsFromEnv({ PLACESSYNC_VERIFY_CLIENT_ID: CLIENT_ID, PLACESSYNC_VERIFY_CLIENT_SECRET: SECRET })).toEqual({ clientId: CLIENT_ID, clientSecret: SECRET });
    expect(credentialsFromEnv({ PLACESSYNC_VERIFY_CLIENT_ID: CLIENT_ID })).toBeNull();
  });

  it("lives in a folder git ignores", () => {
    const root = path.join(import.meta.dirname, "..", "..");
    const rel = path.relative(root, SERVICE_TOKEN_FILE);
    expect(rel).toBe(path.join(".prod", "verify-service-token.json"));
    expect(execFileSync("git", ["check-ignore", rel], { cwd: root, encoding: "utf8" }).trim()).toBe(rel);
  });
});
