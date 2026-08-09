/**
 * SMS normalization and hashing.
 *
 * Lives in its own module because both the parser and the database layer need
 * it, and smsParserService already imports database — putting it in either would
 * create a circular import.
 */

/**
 * Collapse whitespace and lowercase, so cosmetically different copies of the
 * same SMS (e.g. a non-breaking space) hash to the same value.
 */
export function normalizeSmsBody(str: string): string {
  return str.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * FNV-1a 64-bit hash (emulated with two 32-bit halves) for SMS deduplication.
 * Input is normalized before hashing to prevent trivial whitespace differences
 * from producing different hashes.
 */
export function hashSms(str: string): string {
  const normalized = normalizeSmsBody(str);
  const FNV_PRIME = 0x01000193;
  let hHi = 0x811c9dc5 ^ 0xdeadbeef;
  let hLo = 0x811c9dc5;

  for (let i = 0; i < normalized.length; i++) {
    const c = normalized.charCodeAt(i);
    hLo ^= c;
    hLo = Math.imul(hLo, FNV_PRIME) >>> 0;
    hHi ^= (c << 4) ^ (c >> 4);
    hHi = Math.imul(hHi, FNV_PRIME) >>> 0;
  }

  return hLo.toString(16).padStart(8, '0') + hHi.toString(16).padStart(8, '0');
}
