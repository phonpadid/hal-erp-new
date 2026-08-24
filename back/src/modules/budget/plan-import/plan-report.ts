import type { PlanImportOptions, PlanImportResult } from './plan-import.service';

/** `--company`, `--fiscal-year`, `--parent-dept`, `--dry-run`, and the workbook path. */
export function parsePlanArgs(argv: string[]): PlanImportOptions {
  let companyCode = '';
  let year = 0;
  let parentDeptCode: string | undefined;
  let dryRun = false;
  const files: string[] = [];

  const take = (arg: string, name: string, i: number): [string, number] =>
    arg.includes('=') ? [arg.slice(arg.indexOf('=') + 1), i] : [argv[i + 1] ?? '', i + 1];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--company' || arg.startsWith('--company=') || arg === '-c') {
      [companyCode, i] = take(arg, 'company', i);
      continue;
    }
    if (arg === '--fiscal-year' || arg.startsWith('--fiscal-year=') || arg === '-y') {
      let raw = '';
      [raw, i] = take(arg, 'fiscal-year', i);
      year = Number(raw);
      continue;
    }
    if (arg === '--parent-dept' || arg.startsWith('--parent-dept=')) {
      [parentDeptCode, i] = take(arg, 'parent-dept', i);
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
  return { companyCode, year, file: files[0], parentDeptCode, dryRun };
}

const line = (label: string, value: string | number) => `  ${label.padEnd(30)}${value}`;
const kip = (v: string) => Number(v).toLocaleString('en-US');

/**
 * What happened, ordered so the unresolved parts cannot be skipped.
 *
 * A report of totals alone would read as complete success while 21 rows of the plan were left out
 * and seven departments zeroed. Both are deliberate; neither is invisible here.
 */
export function formatPlanReport(r: PlanImportResult): string {
  const out: string[] = [];
  out.push(
    r.dryRun
      ? `DRY RUN — nothing was written to company '${r.companyCode}' for ${r.year}`
      : `Imported the ${r.year} plan into company '${r.companyCode}'`,
  );
  out.push(line('departments created', r.departmentsCreated.join(', ') || 'none'));
  out.push(line('plan nodes', r.plan.nodes.length));
  out.push(line('budgets created', r.budgetsCreated));
  out.push(line('already present, untouched', r.budgetsUnchanged));
  out.push(line('budgets in the plan', r.budgetsPlanned));
  out.push(line('budgets total (LAK)', kip(r.budgetsTotal)));
  out.push('');
  out.push('The workbook states its own subtotals, and this run read:');
  out.push(line('  ມີງົບ (budgeted)', kip(r.plan.sectionCheck.budgeted)));
  out.push(line('  ບໍ່ມີງົບ (not budgeted)', kip(r.plan.sectionCheck.unbudgeted)));
  out.push(line('  ທັງໝົດ (total)', kip(r.plan.sectionCheck.total)));

  const zeroed = r.plan.budgets.filter((b) => b.unbudgeted && b.statedAmount);
  if (zeroed.length) {
    const total = zeroed.reduce((s, b) => s + BigInt(b.statedAmount!), 0n);
    out.push('', `Created at ZERO because the workbook calls them unbudgeted (${zeroed.length}, stating ${kip(total.toString())} between them):`);
    for (const b of zeroed) out.push(`  ${b.code.padEnd(10)}stated ${kip(b.statedAmount!)}`);
  }

  if (r.plan.duplicates.length) {
    out.push('', `Stated more than once — the FIRST row was kept and the other set aside (${r.plan.duplicates.length}):`);
    for (const d of r.plan.duplicates) {
      out.push(
        `  ${d.code.padEnd(10)}kept    row ${String(d.keptRow).padStart(4)}  ${d.keptAmount ? kip(d.keptAmount).padStart(16) : '—'.padStart(16)}  ${d.keptName.slice(0, 26)}`,
      );
      out.push(
        `  ${''.padEnd(10)}dropped row ${String(d.droppedRow).padStart(4)}  ${d.droppedAmount ? kip(d.droppedAmount).padStart(16) : '—'.padStart(16)}  ${d.droppedName.slice(0, 26)}`,
      );
    }
  }

  if (r.plan.conflicts.length) {
    out.push('', `NOT created — the workbook states two different figures (${r.plan.conflicts.length}):`);
    for (const c of r.plan.conflicts) {
      out.push(
        `  ${c.code.padEnd(10)}states ${kip(c.states).padStart(18)}   beneath it ${kip(c.beneath).padStart(18)}   row ${c.row}  ${c.name.slice(0, 24)}`,
      );
    }
  }

  out.push('', 'Departments — what the plan states, and what was created beneath it:');
  for (const d of r.plan.departments) {
    const mark = d.agrees ? '  ' : '!!';
    const tag = d.unbudgeted ? 'unbudgeted' : '          ';
    out.push(
      `  ${mark} ${d.departmentCode.padStart(3)} ${tag} states ${kip(d.stated).padStart(18)}   created ${kip(d.created).padStart(18)}   ${d.name.slice(0, 22)}`,
    );
  }
  const off = r.plan.departments.filter((d) => !d.agrees);
  out.push('', `${r.plan.departments.length - off.length} of ${r.plan.departments.length} departments came out as intended; ${off.length} did not and are marked !!`);
  return out.join('\n');
}
