import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards i18n coverage: no view template may contain a hardcoded display string.
 * All user-facing text must go through $t(...). Heuristic but strict — it scans
 * text nodes between tags (after removing {{ }} mustaches and HTML comments) for
 * Latin / Lao / Thai letters.
 *
 * Escape hatch: put an inline HTML comment containing "i18n-ignore" anywhere on
 * the same line as a genuinely non-translatable token (a code, symbol, or brand).
 */
const VIEWS_DIR = join(__dirname, '..', 'views');
const LETTER = /[A-Za-z฀-๿຀-໿]/; // Latin, Thai, Lao

function vueFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return vueFiles(full);
    return name.endsWith('.vue') ? [full] : [];
  });
}

function templateBlock(src: string): string {
  const m = src.match(/<template>([\s\S]*)<\/template>/);
  return m ? m[1] : '';
}

/** Lines with literal text nodes that aren't fully covered by $t / mustaches. */
function violations(src: string): string[] {
  const out: string[] = [];
  // drop multi-line mustache interpolation first, but keep comments so the
  // per-line i18n-ignore escape hatch can still be detected.
  const tmpl = templateBlock(src).replace(/\{\{[\s\S]*?\}\}/g, '');
  for (const raw of tmpl.split('\n')) {
    if (/i18n-ignore/.test(raw)) continue; // explicit escape hatch
    const line = raw.replace(/<!--.*?-->/g, ''); // drop inline comments
    // text nodes: content between a closing ">" and the next opening "<"
    const texts = line.match(/>([^<>]+)</g) ?? [];
    for (const t of texts) {
      const text = t.slice(1, -1).trim();
      if (text && LETTER.test(text)) out.push(text);
    }
  }
  return out;
}

describe('view templates have no hardcoded display text', () => {
  for (const file of vueFiles(VIEWS_DIR)) {
    const rel = file.slice(file.indexOf('/views/'));
    it(rel, () => {
      const found = violations(readFileSync(file, 'utf8'));
      expect(found, `hardcoded text in ${rel}: ${found.join(' | ')}`).toEqual([]);
    });
  }
});
