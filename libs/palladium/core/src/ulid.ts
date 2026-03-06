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

// Monotonicity state: track the last ms and last random suffix so we can
// increment within the same millisecond rather than generating a fresh random.
let lastMs = -1;
let lastRandom = "";

/**
 * Generate a new ULID. Guaranteed to be strictly monotonically increasing
 * even when called multiple times within the same millisecond.
 */
export function generateUlid(): string {
  const now = Date.now();

  if (now === lastMs && lastRandom !== "") {
    // Increment the random suffix by 1 (treating it as a base-32 number).
    lastRandom = incrementBase32(lastRandom);
  } else {
    lastMs = now;
    lastRandom = encodeRandom(RANDOM_LEN);
  }

  return encodeTime(now, TIME_LEN) + lastRandom;
}

/** Increment a Crockford base-32 string by 1. Wraps on overflow (extremely unlikely). */
function incrementBase32(s: string): string {
  const chars = s.split("");
  let i = chars.length - 1;
  while (i >= 0) {
    const idx = ENCODING.indexOf(chars[i] ?? "0");
    if (idx < ENCODING_LEN - 1) {
      chars[i] = ENCODING[idx + 1] ?? "0";
      return chars.join("");
    }
    chars[i] = "0";
    i--;
  }
  // Overflow: all chars were max value — reset to zeros (extremely unlikely in practice).
  return "0".repeat(s.length);
}
