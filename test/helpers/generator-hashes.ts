import {
  SEED,
  generateEmployees,
  generateLabeledRequests,
  generateResources,
  generateSeedRequests,
  sha256Hex,
} from "../../src/shared/synthetic/index.ts";
import type { PINNED_HASHES } from "./pins.ts";

/** Hashes every pinned generator at the given seed; used by the workerd and Node tests. */
export async function generatorHashes(seed: number = SEED): Promise<Record<keyof typeof PINNED_HASHES, string>> {
  return {
    employees: await sha256Hex(generateEmployees(seed)),
    resources: await sha256Hex(generateResources()),
    labeledRequests: await sha256Hex(generateLabeledRequests(seed)),
    seedRequests: await sha256Hex(generateSeedRequests(seed)),
  };
}
