import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards what a catalog value is written in — the companion to `i18n.parity.spec.ts`
 * (which checks that the key sets match) and `no-literal-text.spec.ts` (which checks
 * that views go through the catalog at all).
 *
 * Two rules, both learned from strings that shipped:
 *
 *  1. A value is written in its own locale's script. Lao and Thai are close enough to
 *     read past — `ພາສີຫັກ ณ ທີ່ຈ່າຍ` carried a Thai `ณ` through review on three keys,
 *     and `ຍັງບໍ່ໄດ້ກรอก` carried Thai `รอก` *inside* a Lao word on a fourth. The eye
 *     does not catch this; a codepoint range does.
 *
 *  2. A Lao value does not present a bare English acronym as display text. `WHT` and
 *     `SLA` were column headers — the acronym was the whole cell. Technical tokens and
 *     codes quoted as examples are exempt; see ALLOWED_TOKENS.
 *
 * Escape hatches, matching the inline-marker convention `no-literal-text.spec.ts` uses:
 * put `i18n-allow-script` or `i18n-allow-token` in a comment on the same line.
 */
const LOCALES_DIR = join(__dirname, 'locales');

const THAI = /[\u0E00-\u0E7F]/;
/** Thai and Lao together — what an English value may not contain. */
const THAI_OR_LAO = /[\u0E00-\u0EFF]/;

/**
 * Runs of ASCII capitals that stay as they are in a Lao value.
 *
 * File formats, protocols and standards — nobody translates these:
 *   API ERP PDF PNG JPEG CSV MB ISO
 * Codes quoted as an example of what the user himself types into a field
 * (`ລະຫັດສັ້ນ (ເຊັ່ນ FINANCE)`, `ຕົວຢ່າງ PR → PO`), and a locale tag (`ຊື່ (TH)`):
 *   FINANCE PR PO TH
 * Finance and org abbreviations Lao offices use unchanged in speech. These are a
 * judgement call rather than a technical exemption — revisit with a Lao-speaking
 * accountant if any of them reads as jargon on the screen it appears on:
 *   VAT GL FX HR
 */
const ALLOWED_TOKENS = new Set([
  'API', 'ERP', 'PDF', 'PNG', 'JPEG', 'CSV', 'MB', 'ISO',
  'FINANCE', 'PR', 'PO', 'TH',
  'VAT', 'GL', 'FX', 'HR',
]);

/**
 * A standalone run of two or more ASCII capitals. Both boundaries reject any letter, so a
 * CamelCase brand contributes nothing: `HALLogistic` would otherwise backtrack to `HAL`.
 */
const CAPITAL_RUN = /(?<![A-Za-z])[A-Z]{2,}(?![A-Za-z])/g;

type Line = { file: string; no: number; text: string };

function catalogLines(locale: string): Line[] {
  const dir = join(LOCALES_DIR, locale);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.ts'))
    .flatMap((name) =>
      readFileSync(join(dir, name), 'utf8')
        .split('\n')
        .map((text, i) => ({ file: `${locale}/${name}`, no: i + 1, text })),
    );
}

/** Quoted string literals on a line — the values, never the keys. */
function quotedValues(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)"|`([^`]*)`/g)) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '');
  }
  return out;
}

/** `foo: 'text'` -> `foo`, so a failure names the key rather than only a line. */
function keyOf(text: string): string {
  return text.match(/^\s*'?([A-Za-z_$][\w$]*)'?\s*:/)?.[1] ?? '(value)';
}

function isImport(text: string): boolean {
  return /^\s*(import|export)\b/.test(text);
}

/** Lines carrying a script from outside the locale's own. */
export function foreignScript(lines: Line[], forbidden: RegExp): string[] {
  return lines
    .filter((l) => !isImport(l.text) && !l.text.includes('i18n-allow-script'))
    .flatMap((l) =>
      quotedValues(l.text)
        .filter((v) => forbidden.test(v))
        .map(
          (v) =>
            `${l.file}:${l.no} ${keyOf(l.text)} — ${[...v]
              .filter((ch) => forbidden.test(ch))
              .join('')} in "${v}"`,
        ),
    );
}

/** Lines showing an acronym that is neither allowed nor marked. */
export function bareAcronyms(lines: Line[]): string[] {
  return lines
    .filter((l) => !isImport(l.text) && !l.text.includes('i18n-allow-token'))
    .flatMap((l) =>
      quotedValues(l.text).flatMap((v) =>
        [...v.matchAll(CAPITAL_RUN)]
          .map((m) => m[0])
          .filter((token) => !ALLOWED_TOKENS.has(token))
          .map((token) => `${l.file}:${l.no} ${keyOf(l.text)} — ${token} in "${v}"`),
      ),
    );
}

const line = (text: string): Line => ({ file: 'synthetic.ts', no: 1, text });

describe('i18n catalog script', () => {
  it('no Lao value contains a Thai character', () => {
    const offenders = foreignScript(catalogLines('la'), THAI);
    expect(offenders, `Thai script in the la catalog:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('no English value contains a Lao or Thai character', () => {
    const offenders = foreignScript(catalogLines('en'), THAI_OR_LAO);
    expect(offenders, `Lao or Thai script in the en catalog:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('no Lao value shows a bare English acronym as display text', () => {
    const offenders = bareAcronyms(catalogLines('la'));
    expect(
      offenders,
      `untranslated acronyms in the la catalog:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

describe('i18n catalog script guard itself', () => {
  it('catches a Thai character spliced inside a Lao word', () => {
    expect(foreignScript([line("  missingRequired: 'ຍັງບໍ່ໄດ້ກรอก',")], THAI)).toHaveLength(1);
  });

  it('lets a marked foreign script through', () => {
    expect(
      foreignScript([line("  thaiSample: 'ตัวอย่าง', // i18n-allow-script brand name")], THAI),
    ).toEqual([]);
  });

  it('catches a bare acronym', () => {
    expect(bareAcronyms([line("  sla: 'SLA',")])).toHaveLength(1);
  });

  it('lets an allowed token through', () => {
    expect(bareAcronyms([line("  vatSummary: 'ສະຫຼຸບ VAT',")])).toEqual([]);
  });

  it('lets a marked token through', () => {
    expect(bareAcronyms([line("  code: 'ລະຫັດ XYZ', // i18n-allow-token")])).toEqual([]);
  });

  it('reads the value, never the key', () => {
    expect(bareAcronyms([line("  WHT: 'ອາກອນຫັກ ຢູ່ທີ່ຕົ້ນທາງ',")])).toEqual([]);
  });

  it('ignores a mixed-case word that merely starts with capitals', () => {
    expect(bareAcronyms([line("  brand: 'HALLogistic',")])).toEqual([]);
  });
});
