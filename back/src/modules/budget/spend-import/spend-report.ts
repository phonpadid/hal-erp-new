import type { SpendImportOptions, SpendImportResult } from './spend-import.service';

/** `--company`, `--fiscal-year`, `--doc-type`, `--dry-run`, and the workbook path. */
export function parseSpendArgs(argv: string[]): SpendImportOptions {
  let companyCode = '';
  let year = 0;
  let docTypeCode: string | undefined;
  let dryRun = false;
  const files: string[] = [];

  const take = (arg: string, i: number): [string, number] =>
    arg.includes('=') ? [arg.slice(arg.indexOf('=') + 1), i] : [argv[i + 1] ?? '', i + 1];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--company' || arg.startsWith('--company=') || arg === '-c') {
      [companyCode, i] = take(arg, i);
      continue;
    }
    if (arg === '--fiscal-year' || arg.startsWith('--fiscal-year=') || arg === '-y') {
      let raw = '';
      [raw, i] = take(arg, i);
      year = Number(raw);
      continue;
    }
    if (arg === '--doc-type' || arg.startsWith('--doc-type=')) {
      [docTypeCode, i] = take(arg, i);
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg.startsWith('-')) throw new Error(`Unknown option '${arg}'`);
    files.push(arg);
  }

  if (!companyCode) throw new Error('A company is required: --company <code>');
  if (!year || Number.isNaN(year)) {
    throw new Error('A fiscal year is required: --fiscal-year <year>');
  }
  if (files.length !== 1) throw new Error('Exactly one workbook path is required');
  return { companyCode, year, file: files[0], docTypeCode, dryRun };
}

const line = (label: string, value: string | number) => `  ${label.padEnd(32)}${value}`;
const kip = (v: string) => Number(v).toLocaleString('en-US');
const REASONS: Record<string, string> = {
  NO_AMOUNT: 'states no amount',
  NO_MONTH: 'month cannot be read',
  NO_CODE: 'names no plan code',
};

/**
 * What happened, ordered so what was left out cannot be skipped.
 *
 * The quarterly and departmental totals are here because they are what the operator compares
 * against the customer's own sheet before anybody relies on the figures. A report of "1,187
 * documents written" says the run finished; it does not say the run was right.
 */
export function formatSpendReport(r: SpendImportResult): string {
  const out: string[] = [];
  out.push(
    r.dryRun
      ? `DRY RUN — nothing was written to company '${r.companyCode}' for ${r.year}`
      : `Imported the ${r.year} spend history into company '${r.companyCode}'`,
  );
  out.push(line('documents', r.documentsCreated));
  out.push(line('  already present, untouched', r.documentsUnchanged));
  out.push(line('document lines', r.linesCreated));
  out.push(line('budget_txn rows', `${r.ledgerRows}  (one RESERVE + one ACTUAL each)`));
  out.push(line('total charged (LAK)', kip(r.plan.total)));

  out.push('');
  out.push('By quarter — compare these against the customer’s own sheet before relying on them:');
  for (const [i, q] of r.plan.byQuarter.entries()) out.push(line(`  Q${i + 1}`, kip(q)));

  out.push('');
  out.push('By department (the plan code’s department, which is whose money was spent):');
  for (const [code, amount] of [...r.plan.byDepartment].sort(
    (a, b) => Number(b[1]) - Number(a[1]),
  )) {
    out.push(line(`  ${code}`, kip(amount)));
  }

  if (r.budgetsCreatedAtZero.length) {
    const total = r.budgetsCreatedAtZero.reduce((s, b) => s + BigInt(b.charged), 0n);
    out.push(
      '',
      `Budgets created at ZERO because the plan funded nothing here (${r.budgetsCreatedAtZero.length}, ` +
        `charged ${kip(total.toString())} between them — every kip of it overspending):`,
    );
    out.push(
      line(
        '  control points minted',
        `${r.controlPointsCreated}  (BLOCK at the ceiling — a budget nothing governs is one nothing checks)`,
      ),
    );
    for (const b of [...r.budgetsCreatedAtZero].sort((a, b) => Number(b.charged) - Number(a.charged))) {
      out.push(`  ${b.code.padEnd(10)}dept ${b.departmentCode.padEnd(4)}charged ${kip(b.charged)}`);
    }
  }

  if (r.plan.skipped.length) {
    const money = r.plan.skipped
      .filter((s) => s.amount)
      .reduce((s, x) => s + BigInt(x.amount!), 0n);
    out.push(
      '',
      `Rows left out (${r.plan.skipped.length}, stating ${kip(money.toString())} between them). ` +
        'Nothing here was guessed at — each needs a person:',
    );
    for (const s of r.plan.skipped) {
      out.push(
        `  row ${String(s.row).padEnd(6)}${REASONS[s.reason].padEnd(22)}` +
          `${(s.amount ? kip(s.amount) : '—').padStart(16)}  ${s.description.slice(0, 40)}`,
      );
    }
  }

  if (r.descriptionsTruncated) {
    out.push(
      '',
      `${r.descriptionsTruncated} line(s) stated more than a description can hold and were cut, ` +
        'keeping the sheet reference that leads back to the full text.',
    );
  }

  if (r.descriptionsSupplied) {
    out.push(
      '',
      `${r.descriptionsSupplied} line(s) carried no description and were named by the sheet row they came from.`,
    );
  }

  if (r.plan.crossDepartment.length) {
    const total = r.plan.crossDepartment.reduce((s, x) => s + BigInt(x.amount), 0n);
    out.push(
      '',
      `${r.plan.crossDepartment.length} row(s) were spent by one department against another’s plan ` +
        `line (${kip(total.toString())}). The CODE decided the budget; the department column is on ` +
        'the document:',
    );
    for (const x of r.plan.crossDepartment) {
      out.push(`  row ${String(x.sheetRow).padEnd(6)}dept ${x.departmentCode.padEnd(8)}→ ${x.code.padEnd(10)}${kip(x.amount)}`);
    }
  }

  if (r.plan.outsideFiscalYear.length) {
    out.push(
      '',
      `${r.plan.outsideFiscalYear.length} row(s) fall outside fiscal year ${r.year}, so no quarter of ` +
        'it holds them:',
    );
    for (const x of r.plan.outsideFiscalYear) {
      out.push(`  row ${String(x.sheetRow).padEnd(6)}${x.code.padEnd(10)}${kip(x.amount)}`);
    }
  }

  return out.join('\n');
}
