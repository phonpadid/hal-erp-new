import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Custody helpers for API-key secrets. The raw secret has the shape
 * `<prefix>.<random>`: the prefix is a public, indexed identifier (safe to display),
 * the random part carries the entropy. Only the SHA-256 hash of the full raw secret is
 * stored — the raw value lives solely in the caller's config. The secret is high-entropy,
 * so a fast hash is sufficient (mirrors password_reset_token / email_verification_token).
 */

/** Public prefix, e.g. `ak_8f3d1a2b`. Non-secret; used for the indexed row lookup. */
export function generatePrefix(): string {
  return `ak_${randomBytes(4).toString('hex')}`;
}

/** Issue a fresh raw secret `<prefix>.<random>` with >=32 bytes of CSPRNG entropy. */
export function generateRawSecret(prefix: string): string {
  const random = randomBytes(32).toString('hex');
  return `${prefix}.${random}`;
}

export function hashSecret(rawSecret: string): string {
  return createHash('sha256').update(rawSecret).digest('hex');
}

/** The public prefix embedded in a presented credential (part before the first dot). */
export function prefixOf(rawSecret: string): string | null {
  const dot = rawSecret.indexOf('.');
  if (dot <= 0 || dot === rawSecret.length - 1) return null;
  return rawSecret.slice(0, dot);
}

/** Constant-time comparison of a presented secret against a stored hash. */
export function verifySecret(rawSecret: string, storedHash: string): boolean {
  const presented = Buffer.from(hashSecret(rawSecret), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  if (presented.length !== stored.length) return false;
  return timingSafeEqual(presented, stored);
}
