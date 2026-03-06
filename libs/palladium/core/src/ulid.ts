/**
 * ULID — Universally Unique Lexicographically Sortable Identifier.
 *
 * Format: 48-bit timestamp (ms) + 80 random bits, encoded in Crockford
 * base-32. Total: 26 characters.
 *
 * Spec: https://github.com/ulid/spec
 */

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ENCODING_LEN = ENCODING.length;
const TIME_LEN = 10;
const RANDOM_LEN = 16;

function encodeTime(now: number, len: number): string {
  let t = now;
  let out = "";
  for (let i = len - 1; i >= 0; i--) {
    const mod = t % ENCODING_LEN;
    out = (ENCODING[mod] ?? "0") + out;
    t = Math.floor(t / ENCODING_LEN);
  }
  return out;
}

function encodeRandom(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) {
    // 256 / 32 = 8; map each byte to a single base-32 character.
    out += ENCODING[b % ENCODING_LEN] ?? "0";
  }
  return out;
}

/** Generate a new ULID. Monotonically sortable within the same process. */
export function generateUlid(): string {
  return encodeTime(Date.now(), TIME_LEN) + encodeRandom(RANDOM_LEN);
}
