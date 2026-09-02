import { quarterOf, type QuarterIndex } from '../budget-period';
import type { SkippedRow, SpendRow } from './spend-reader';

/** One spend row, ready to become a `document_line`. */
export interface PlannedLine {
  /** Their `ເລກລຳດັບ`, kept so a figure in the system can be traced back to a row in the sheet. */
  sequence?: string;
  description: string;
  amount: string;
  /** The day the row states, `YYYY-MM-DD` — kept on the line, though the document carries a month. */
  spentOn: string;
  sheetRow: number;
}

/** One document to be created: a budget, a month, and the rows that charged it. */
export interface PlannedDocument {
  /** The plan code — which budget is charged. */
  code: string;
  /** 1–12. */
  month: number;
  year: number;
  /** The date the document and its ledger rows carry: the first day of the month. */
  date: string;
  /**
   * The department that spent, from `CODE ພະແນກ` — the requester, not the budget's owner.
   *
   * Undefined when the sheet leaves it blank — which this file never does — and taken from the
   * first row of the group when the rows within one disagree.
   */
  departmentCode?: string;
  lines: PlannedLine[];
  amount: string;
  /** The identity a re-run finds this document by. */
  sourceId: string;
}

/** A row whose department column names something other than its plan code's own department. */
export interface CrossDepartmentRow {
  sheetRow: number;
  departmentCode: string;
  code: string;
  amount: string;
}

export interface SpendPlan {
  documents: PlannedDocument[];
  /** Every plan code the sheet charges, with what it charged. */
  chargedByCode: Map<string, string>;
  skipped: SkippedRow[];
  crossDepartment: CrossDepartmentRow[];
  /**
   * Rows dated outside the fiscal year being imported.
   *
   * Kept and reported rather than dropped: they still charge a budget, and their money still has
   * to be accounted for — but no quarter of this year holds them, so a report of the year would
   * not show them and the operator needs to be told. This file has none.
   */
  outsideFiscalYear: CrossDepartmentRow[];
  lineCount: number;
  total: string;
  /** Totals by quarter of the fiscal year, for comparison against the customer's sheet. */
  byQuarter: [string, string, string, string];
  byDepartment: Map<string, string>;
}

const add = (a: string, b: string): string => (BigInt(a) + BigInt(b)).toString();
const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * The department a plan code belongs to: everything left of the dot.
 *
 * Their codes encode it — `7.301` is department 7's line — which is what lets a budget be found
 * from a code alone. `budget_node` carries no department precisely so that this stays a property
 * of their numbering rather than of the table.
 */
export const departmentOf = (code: string): string => code.split('.')[0];

/**
 * Group the sheet's rows into the documents that will carry them.
 *
 * The grain is (plan code, month), and both halves of it are load-bearing. The code, because it is
 * what says which budget was consumed — the department column says who spent, and 16 rows show the
 * two are not the same question. The month, because a document carries one date: grouping a year
 * onto one date leaves every figure right and every period wrong.
 */
export function planSpendImport(
  rows: SpendRow[],
  skipped: SkippedRow[] = [],
  /**
   * The fiscal year's first day, which decides where the quarter boundaries fall.
   *
   * Defaulted to nothing rather than to January: a quarter is a property of the year the company
   * declared, and this customer's happens to start on 1 January. Passing the year's own start is
   * what keeps the figures right for a company whose year starts in October.
   */
  fiscalYearStart?: string,
): SpendPlan {
  const byKey = new Map<string, PlannedDocument>();
  const chargedByCode = new Map<string, string>();
  const byDepartment = new Map<string, string>();
  const crossDepartment: CrossDepartmentRow[] = [];
  const outsideFiscalYear: CrossDepartmentRow[] = [];
  const byQuarter: [string, string, string, string] = ['0', '0', '0', '0'];
  let total = '0';
  let lineCount = 0;

  for (const row of rows) {
    const amount = row.amount;
    if (!amount) continue;
    const key = `${row.code}|${row.year}|${row.month}`;
    let doc = byKey.get(key);
    if (!doc) {
      doc = {
        code: row.code,
        month: row.month,
        year: row.year,
        date: `${row.year}-${pad(row.month)}-01`,
        departmentCode: row.departmentCode || undefined,
        lines: [],
        amount: '0',
        // The budget, the month and the year — not the row. A re-run has to find the DOCUMENT it
        // created, and the document is per month; `ເລກລຳດັບ` identifies a line inside it, and is
        // blank on 40 rows and repeated on others, so it could not identify anything on its own.
        sourceId: `${row.code}:${row.year}-${pad(row.month)}`,
      };
      byKey.set(key, doc);
    }
    doc.lines.push({
      sequence: row.sequence,
      description: row.description,
      amount,
      spentOn: `${row.year}-${pad(row.month)}-${pad(row.day)}`,
      sheetRow: row.row,
    });
    doc.amount = add(doc.amount, amount);
    lineCount += 1;
    total = add(total, amount);

    const department = departmentOf(row.code);
    chargedByCode.set(row.code, add(chargedByCode.get(row.code) ?? '0', amount));
    byDepartment.set(department, add(byDepartment.get(department) ?? '0', amount));
    const quarter: QuarterIndex | undefined = fiscalYearStart
      ? quarterOf(fiscalYearStart, `${row.year}-${pad(row.month)}-${pad(row.day)}`)
      : ((Math.ceil(row.month / 3) as QuarterIndex));
    if (quarter) byQuarter[quarter - 1] = add(byQuarter[quarter - 1], amount);
    else {
      outsideFiscalYear.push({
        sheetRow: row.row,
        departmentCode: row.departmentCode,
        code: row.code,
        amount,
      });
    }

    if (row.departmentCode && row.departmentCode !== department) {
      crossDepartment.push({
        sheetRow: row.row,
        departmentCode: row.departmentCode,
        code: row.code,
        amount,
      });
    }
  }

  const documents = [...byKey.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.code.localeCompare(b.code),
  );
  return {
    documents,
    chargedByCode,
    skipped,
    crossDepartment,
    outsideFiscalYear,
    lineCount,
    total,
    byQuarter,
    byDepartment,
  };
}

/**
 * The plan codes charged that no budget exists for — the budgets to create at zero.
 *
 * A node with no spending is not in this list: this creates what the money needs to land on, and
 * nothing else.
 */
export function budgetsToCreate(plan: SpendPlan, existingCodes: Set<string>): string[] {
  return [...plan.chargedByCode.keys()].filter((code) => !existingCodes.has(code)).sort();
}
