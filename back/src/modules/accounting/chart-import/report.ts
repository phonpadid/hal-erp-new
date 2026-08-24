import type { ImportOptions, ImportResult } from './chart-import.service';

/**
 * `--company <code>`, `--dry-run`, and one or more file paths.
 *
 * Kept out of the script file so the argument rules and the report can be tested without booting
 * an ORM — the parts most likely to be wrong are the ones a run only exercises once.
 */
export function parseImportArgs(argv: string[]): ImportOptions {
  let companyCode = '';
  let dryRun = false;
  const files: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--company' || arg === '-c') {
      companyCode = argv[++i] ?? '';
      continue;
    }
    if (arg.startsWith('--company=')) {
      companyCode = arg.slice('--company='.length);
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg.startsWith('-')) throw new Error(`Unknown option '${arg}'`);
    files.push(arg);
  }

  if (!companyCode) {
    throw new Error(
      'A company is required: --company <code>. This import never picks one for you, however ' +
        'few companies exist.',
    );
  }
  if (!files.length) throw new Error('At least one chart file is required');
  return { companyCode, files, dryRun };
}

const line = (label: string, value: string | number) => `  ${label.padEnd(28)}${value}`;

/**
 * What happened, in the order someone reading it needs: the counts, then everything that was NOT
 * straightforward. A report that prints only totals lets 16 dropped accounts pass as success.
 */
export function formatImportReport(r: ImportResult): string {
  const out: string[] = [];
  out.push(
    r.dryRun
      ? `DRY RUN — nothing was written to company '${r.companyCode}'`
      : `Imported into company '${r.companyCode}'`,
  );
  out.push(line('accounts created', r.created));
  out.push(line('already present, untouched', r.unchanged));
  out.push(line('skipped', r.plan.skipped.length));
  out.push(line('headers (not postable)', r.plan.accounts.filter((a) => !a.isPostable).length));
  out.push(line('roots', r.plan.roots.join(', ') || '—'));

  if (r.plan.skipped.length) {
    out.push('', `Skipped — no account was created for these ${r.plan.skipped.length} rows:`);
    for (const s of r.plan.skipped) {
      out.push(`  ${s.code.padEnd(14)}${s.reason}  [${s.file} row ${s.row}]`);
    }
  }

  const inherited = r.plan.accounts.filter((a) => a.typeFromAncestor);
  if (inherited.length) {
    out.push('', `Type taken from an ancestor, because the row states a class this system does not hold (${inherited.length}):`);
    for (const a of inherited) {
      out.push(`  ${a.code.padEnd(14)}${a.accountType} from ${a.typeFromAncestor}`);
    }
  }

  const named = r.plan.accounts.filter((a) => a.namedByCode);
  if (named.length) {
    out.push('', `Carried no name; the code stands in for one (${named.length}):`);
    for (const a of named) out.push(`  ${a.code}`);
  }

  if (r.plan.crossType.length) {
    out.push('', `Filed under a head of another type (${r.plan.crossType.length}) — contra accounts, reported not refused:`);
    for (const c of r.plan.crossType) {
      out.push(`  ${c.code.padEnd(14)}${c.accountType} under ${c.parentCode} (${c.parentType})`);
    }
  }

  return out.join('\n');
}
