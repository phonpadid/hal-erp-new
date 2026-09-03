import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BANKS, bankDisplay, bankLogoFor, bankLogoUrl, bankOptions, findBank } from './banks';

describe('bank catalog', () => {
  it('ships a logo file for every entry', () => {
    for (const b of BANKS) {
      expect(existsSync(resolve(__dirname, '../../public/banks', b.logoFile)), b.logoFile).toBe(true);
    }
  });

  it('has unique codes and names', () => {
    expect(new Set(BANKS.map((b) => b.code)).size).toBe(BANKS.length);
    expect(new Set(BANKS.map((b) => b.name)).size).toBe(BANKS.length);
  });

  // The app is served from a sub-path, and a bound :src is not rewritten by Vite's asset transform.
  it('resolves logos against the app base', () => {
    expect(bankLogoUrl(BANKS[0])).toBe(`${import.meta.env.BASE_URL}banks/${BANKS[0].logoFile}`);
  });

  it('keys options on the field the form sends', () => {
    expect(bankOptions('code').map((o) => o.value)).toEqual(BANKS.map((b) => b.code));
    expect(bankOptions('name').map((o) => o.value)).toEqual(BANKS.map((b) => b.name));
  });

  it('appends a stored value the catalog does not know, without a logo', () => {
    const opts = bankOptions('code', 'MYSTERY BANK');
    expect(opts).toHaveLength(BANKS.length + 1);
    expect(opts.at(-1)).toEqual({ value: 'MYSTERY BANK', label: 'MYSTERY BANK' });
  });

  it('appends nothing for an empty or already-known value', () => {
    expect(bankOptions('code')).toHaveLength(BANKS.length);
    expect(bankOptions('code', '   ')).toHaveLength(BANKS.length);
    expect(bankOptions('code', 'BCEL')).toHaveLength(BANKS.length);
    expect(bankOptions('name', 'BCEL')).toHaveLength(BANKS.length);
  });

  it('shows a known value in a list with its name and logo', () => {
    expect(bankDisplay('code', 'BCEL')).toEqual({ label: 'BCEL', logo: bankLogoUrl(BANKS[1]) });
    expect(bankDisplay('name', 'ACLEDA Bank').logo).toBeTruthy();
    // No second line in a table column — that belongs in a picker read one option at a time.
    expect(bankDisplay('code', 'BCEL')).not.toHaveProperty('sublabel');
  });

  it('shows an unknown or missing value as text with no logo', () => {
    expect(bankDisplay('code', 'SOME OLD BANK')).toEqual({ label: 'SOME OLD BANK' });
    expect(bankDisplay('code', null)).toEqual({ label: '—' });
    expect(bankLogoFor('code', 'SOME OLD BANK')).toBeUndefined();
    expect(bankLogoFor('code', 'JDB')).toBe(bankLogoUrl(BANKS[3]));
  });

  it('finds a bank by either key', () => {
    expect(findBank('code', 'BCEL')?.name).toBe('BCEL');
    expect(findBank('name', 'ACLEDA Bank')?.code).toBe('ACLEDA');
    expect(findBank('code', 'nope')).toBeUndefined();
  });
});
