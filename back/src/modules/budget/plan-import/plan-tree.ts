import { Money } from '../../../common/money/money';
import type { PlanRow } from './plan-reader';

/** A place in the plan: a department root, a category, or a line. */
export interface PlannedNode {
  code: string;
  name: string;
  /** The department's plan code — the part before the separator, or the code itself at a root. */
  departmentCode: string;
  /** Parent's CODE. Undefined at a department root. */
  parentCode?: string;
  isDepartmentRoot: boolean;
}

/** Money to be created at a node, as a decimal string. */
export interface PlannedBudget {
  code: string;
  /** The plan line's own name. A budget without one cannot be identified on any screen. */
  name: string;
  departmentCode: string;
  amountTotal: string;
  /** True when the row states a figure that this import deliberately zeroes. */
  unbudgeted: boolean;
  /** What the row actually said, kept so the report can show what was zeroed. */
  statedAmount?: string;
}

/** A code the workbook states twice. The first statement stands; the second is set aside. */
export interface PlanDuplicate {
  code: string;
  keptName: string;
  keptAmount?: string;
  keptRow: number;
  droppedName: string;
  droppedAmount?: string;
  droppedRow: number;
}

/** A row stating an amount that disagrees with the money beneath it. Reported, never resolved. */
export interface PlanConflict {
  code: string;
  name: string;
  states: string;
  beneath: string;
  row: number;
}

export interface DepartmentReconciliation {
  departmentCode: string;
  name: string;
  /** What the department row states for the year. */
  stated: string;
  /** What the budgets created beneath it add up to. */
  created: string;
  /**
   * Whether the department came out as intended: for a budgeted one, the budgets created beneath
   * it equal what its row states; for an unbudgeted one, nothing was created. A false here is a
   * question for a person — it is never the ordinary case.
   */
  agrees: boolean;
  unbudgeted: boolean;
}

export interface PlanImportPlan {
  nodes: PlannedNode[];
  budgets: PlannedBudget[];
  /** Rows that state an amount equal to the money beneath them: structure, no budget. */
  summaries: string[];
  conflicts: PlanConflict[];
  /** Codes stated more than once. The first row won; the rest are listed here. */
  duplicates: PlanDuplicate[];
  departments: DepartmentReconciliation[];
  /** The subtotals the worksheet states for itself, and what was read against them. */
  sectionCheck: { budgeted: string; unbudgeted: string; total: string };
}

export class PlanSectionError extends Error {}

/** The worksheet's own subtotal rows, which divide the plan into its two sections. */
const BUDGETED_TOTAL = /ລວມ\s*ຍອດ\s*ມີງົບ/;
const UNBUDGETED_TOTAL = /ລວມ\s*ຍອດ\s*ບໍ່ມີງົບ/;

/**
 * Every proper prefix of a plan code, longest first, WITHIN its department.
 *
 * `1.111` offers `1.11`, `1.1`, then the department `1`. The department is never trimmed further:
 * `10` is the tenth department, not a child of `1`. That is the difference between these codes and
 * the chart of accounts', where `1011` really does sit under `101`.
 */
export function planPrefixes(code: string): string[] {
  if (!code.includes('.')) return [];
  const [dept, tail] = code.split('.', 2);
  const out: string[] = [];
  for (let i = tail.length - 1; i > 0; i--) out.push(`${dept}.${tail.slice(0, i)}`);
  out.push(dept);
  return out;
}

/**
 * Turn the plan's rows into the structure and the money to create.
 *
 * Two things are separated here that the spreadsheet keeps in one column: where a line sits, and
 * whether the figure against it is money of its own or a total of what lies beneath. Getting the
 * second wrong doubles a subtree inside every control point that governs it, which raises a
 * ceiling silently — the defect `budget_node` exists to make impossible to express, and this is
 * the one place it can still be reintroduced.
 */
export function planImport(rows: PlanRow[], ignored: { raw: string; row: number }[]): PlanImportPlan {
  // ── the two sections, from the worksheet's own totals ────────────────────────────────────
  const budgetedTotalRow = ignored.find((i) => BUDGETED_TOTAL.test(i.raw));
  const unbudgetedTotalRow = ignored.find((i) => UNBUDGETED_TOTAL.test(i.raw));
  if (!budgetedTotalRow || !unbudgetedTotalRow) {
    throw new PlanSectionError(
      'The worksheet does not state its own ມີງົບ / ບໍ່ມີງົບ subtotals, so the budgeted and ' +
        'unbudgeted halves of the plan cannot be told apart. Refusing rather than treating every ' +
        'line as budgeted.',
    );
  }
  const unbudgetedFrom = budgetedTotalRow.row;

  // ── merge, keeping the first statement of a code and setting the rest aside ──────────────
  //
  // This refused the whole run until the customer asked for the plan to come in regardless. A
  // duplicate is a question about their spreadsheet, not a fault in the data around it, and
  // holding 552 plan lines hostage to one of them helps nobody. The row that wins is the FIRST —
  // an arbitrary rule, chosen because it is stable and stated, so a later re-run of the same file
  // produces the same plan. Both rows are reported.
  const by = new Map<string, PlanRow>();
  const duplicates: PlanDuplicate[] = [];
  for (const row of rows) {
    const seen = by.get(row.code);
    if (!seen) {
      by.set(row.code, row);
      continue;
    }
    if (seen.name === row.name && seen.amount === row.amount) continue;
    duplicates.push({
      code: row.code,
      keptName: seen.name,
      keptAmount: seen.amount,
      keptRow: seen.row,
      droppedName: row.name,
      droppedAmount: row.amount,
      droppedRow: row.row,
    });
  }

  const codes = new Set(by.keys());
  const parentOf = new Map<string, string | undefined>();
  for (const code of codes) {
    parentOf.set(code, planPrefixes(code).find((p) => codes.has(p)));
  }
  const childrenOf = new Map<string, string[]>();
  for (const [code, parent] of parentOf) {
    if (!parent) continue;
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), code]);
  }

  const deptOf = (code: string) => code.split('.')[0];
  const isUnbudgeted = (code: string) => by.get(code)!.row > unbudgetedFrom;

  /** Every descendant of a code, each once. */
  const descend = (code: string): string[] => {
    const out: string[] = [];
    for (const child of childrenOf.get(code) ?? []) {
      out.push(child, ...descend(child));
    }
    return out;
  };

  // ── who holds money ──────────────────────────────────────────────────────────────────────
  // A row holds money when it states an amount and no row beneath it states one. A row stating
  // what its descendants already state is a summary of them, not a second allocation.
  const holders = new Set<string>();
  for (const [code, row] of by) {
    if (!row.amount) continue;
    if (descend(code).some((d) => by.get(d)!.amount)) continue;
    holders.add(code);
  }

  const summaries: string[] = [];
  const conflicts: PlanConflict[] = [];
  for (const [code, row] of by) {
    if (!row.amount || holders.has(code)) continue;
    let beneath = '0';
    for (const d of descend(code)) if (holders.has(d)) beneath = Money.add(beneath, by.get(d)!.amount!);
    if (Money.compare(row.amount, beneath) === 0) summaries.push(code);
    else conflicts.push({ code, name: row.name, states: row.amount, beneath, row: row.row });
  }

  // ── what to create ───────────────────────────────────────────────────────────────────────
  const nodes: PlannedNode[] = [...by.values()]
    .map((row) => ({
      code: row.code,
      name: row.name || row.code,
      departmentCode: deptOf(row.code),
      parentCode: parentOf.get(row.code),
      isDepartmentRoot: !row.code.includes('.'),
    }))
    .sort((a, b) => a.code.localeCompare(b.code, 'en'));

  const budgets: PlannedBudget[] = [...holders]
    .sort((a, b) => a.localeCompare(b, 'en'))
    .map((code) => {
      const stated = by.get(code)!.amount!;
      const unbudgeted = isUnbudgeted(code);
      return {
        code,
        name: by.get(code)!.name || code,
        departmentCode: deptOf(code),
        // The unbudgeted section states figures that are NOT appropriations — the worksheet's own
        // subtotal says so. Creating them as written would make 16 billion kip spendable out of
        // rows their owner classified as having no budget.
        amountTotal: unbudgeted ? '0' : stated,
        unbudgeted,
        statedAmount: unbudgeted ? stated : undefined,
      };
    });

  // ── reconcile each department against what will be created beneath it ────────────────────
  const departments: DepartmentReconciliation[] = nodes
    .filter((n) => n.isDepartmentRoot)
    .map((n) => {
      let created = '0';
      for (const b of budgets) if (b.departmentCode === n.code) created = Money.add(created, b.amountTotal);
      const stated = by.get(n.code)!.amount ?? '0';
      const unbudgeted = isUnbudgeted(n.code);
      return {
        departmentCode: n.code,
        name: n.name,
        stated,
        created,
        // An unbudgeted department is right when it created nothing — comparing it against the
        // figure its row states would flag the decision itself as a discrepancy on all seven.
        agrees: unbudgeted
          ? Money.compare(created, '0') === 0
          : Money.compare(stated, created) === 0,
        unbudgeted,
      };
    })
    .sort((a, b) => Number(a.departmentCode) - Number(b.departmentCode));

  let budgeted = '0';
  let unbudgetedTotal = '0';
  for (const d of departments) {
    const stated = by.get(d.departmentCode)!.amount ?? '0';
    if (d.unbudgeted) unbudgetedTotal = Money.add(unbudgetedTotal, stated);
    else budgeted = Money.add(budgeted, stated);
  }

  return {
    nodes,
    budgets,
    summaries: summaries.sort(),
    conflicts: conflicts.sort((a, b) => a.code.localeCompare(b.code, 'en')),
    duplicates: duplicates.sort((a, b) => a.code.localeCompare(b.code, 'en')),
    departments,
    sectionCheck: {
      budgeted,
      unbudgeted: unbudgetedTotal,
      total: Money.add(budgeted, unbudgetedTotal),
    },
  };
}
