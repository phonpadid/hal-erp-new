import { describe, expect, it } from 'vitest';
import {
  generatePrefix,
  generateRawSecret,
  hashSecret,
  prefixOf,
  verifySecret,
} from './api-key.crypto';

describe('api-key crypto (custody)', () => {
  it('a raw secret is <prefix>.<random> and verifies against its own hash', () => {
    const prefix = generatePrefix();
    const secret = generateRawSecret(prefix);
    expect(secret.startsWith(`${prefix}.`)).toBe(true);
    expect(prefixOf(secret)).toBe(prefix);
    expect(verifySecret(secret, hashSecret(secret))).toBe(true);
  });

  it('carries high entropy (random part >= 32 bytes / 64 hex chars)', () => {
    const prefix = generatePrefix();
    const random = generateRawSecret(prefix).slice(prefix.length + 1);
    expect(random.length).toBeGreaterThanOrEqual(64);
  });

  it('a wrong secret does not verify against a stored hash', () => {
    const stored = hashSecret(generateRawSecret(generatePrefix()));
    expect(verifySecret(generateRawSecret(generatePrefix()), stored)).toBe(false);
  });

  it('the hash is never the raw secret', () => {
    const secret = generateRawSecret(generatePrefix());
    expect(hashSecret(secret)).not.toContain(secret);
    expect(hashSecret(secret)).toHaveLength(64); // sha-256 hex
  });

  it('generates distinct prefixes and secrets', () => {
    const a = generatePrefix();
    const b = generatePrefix();
    expect(a).not.toBe(b);
    expect(generateRawSecret(a)).not.toBe(generateRawSecret(a));
  });

  it('rejects malformed credentials (no dot / empty parts)', () => {
    expect(prefixOf('no-dot-here')).toBeNull();
    expect(prefixOf('.leading')).toBeNull();
    expect(prefixOf('trailing.')).toBeNull();
  });
});
