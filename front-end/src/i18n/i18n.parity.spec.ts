import { describe, expect, it } from 'vitest';
import en from './locales/en';
import la from './locales/la';
import zh from './locales/zh';

/** Recursively collect dotted key paths of a nested message object. */
function keyPaths(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === 'object'
      ? keyPaths(v as Record<string, unknown>, path)
      : [path];
  });
}

const enKeys = keyPaths(en).sort();

/** Every catalog must carry exactly the same key set as `en`, so a missing key never renders blank. */
describe('i18n catalog parity', () => {
  it.each([
    ['la', la],
    ['zh', zh],
  ])('%s has an identical key set to en', (name, catalog) => {
    const keys = keyPaths(catalog as Record<string, unknown>).sort();
    const missing = enKeys.filter((k) => !keys.includes(k));
    const extra = keys.filter((k) => !enKeys.includes(k));
    expect(missing, `keys missing from ${name}: ${missing.join(', ')}`).toEqual([]);
    expect(extra, `keys in ${name} not in en: ${extra.join(', ')}`).toEqual([]);
  });
});
