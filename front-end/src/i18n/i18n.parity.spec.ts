import { describe, expect, it } from 'vitest';
import en from './locales/en';
import la from './locales/la';

/** Recursively collect dotted key paths of a nested message object. */
function keyPaths(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === 'object'
      ? keyPaths(v as Record<string, unknown>, path)
      : [path];
  });
}

describe('i18n catalog parity', () => {
  it('la and en have identical key sets', () => {
    const enKeys = keyPaths(en).sort();
    const laKeys = keyPaths(la).sort();
    const onlyEn = enKeys.filter((k) => !laKeys.includes(k));
    const onlyLa = laKeys.filter((k) => !enKeys.includes(k));
    expect(onlyEn, `keys missing from la: ${onlyEn.join(', ')}`).toEqual([]);
    expect(onlyLa, `keys missing from en: ${onlyLa.join(', ')}`).toEqual([]);
  });
});
