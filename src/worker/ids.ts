// ULID-style ids: 48-bit millisecond time plus 80 random bits, Crockford base32.
// Request ids (req_<ulid>) also serve as Workflow instance ids, which allow
// ^[a-zA-Z0-9_][a-zA-Z0-9-_]*$ and at most 100 characters.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function ulid(nowMs: number): string {
  let time = "";
  let t = Math.floor(nowMs);
  for (let i = 0; i < 10; i++) {
    time = (ALPHABET[t % 32] as string) + time;
    t = Math.floor(t / 32);
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let rand = "";
  for (const b of bytes) rand += ALPHABET[b % 32];
  return time + rand;
}

export function newId(prefix: string, nowMs: number = Date.now()): string {
  return `${prefix}_${ulid(nowMs).toLowerCase()}`;
}
