// SHA-256 pins of the canonical JSON of each generator's output at SEED (SPEC 11).
// Any change to a generator shows up here in review. The same pins are asserted in
// workerd (test/worker/synthetic.test.ts) and in Node (test/node/generators-node.test.ts).
export const PINNED_HASHES = {
  employees: "2b0aeb64c66140e23bd68e3f0d60e570ca0cf70cc7e337a899a758447ef35fc8",
  resources: "70a400aefaf2ca86800823e005ff00f23e6fa0f00502f000a686b99d59821514",
  labeledRequests: "7991302812837696e0385a293ad34cc5f722658047e3953739ea46c344050999",
  seedRequests: "e4ef8922f4a3a7d87c9728608faf6eefa86d4d2c6e9fa4c0fbe92268b3513696",
  contentionAttempts: "6d0b1ef53403b1c92fdc569221edb508f5093baac74cc6e82590c275a463ef32",
  /** generateHistory at HISTORY_PIN_DATE (2026-10-08). */
  history: "89f969050c0ae15421ce426873487806c5e6c5cf85d9d93e46793fe156c73266",
} as const;
