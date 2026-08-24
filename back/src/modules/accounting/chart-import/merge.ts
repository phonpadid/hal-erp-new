import { AccountType } from '../../../common/enums';
import type { SourceAccount } from './workbook-reader';

/** An account the import will create, with everything derived that the files do not state. */
export interface PlannedAccount {
  code: string;
  name: string;
  accountType: AccountType;
  /** Parent's CODE, not an id — nothing has been written yet. Undefined at a class head. */
  parentCode?: string;
  isPostable: boolean;
  /** Set when the type came from an ancestor because the row's own class is unmapped. */
  typeFromAncestor?: string;
  /** Set when the row carried no name and its code stands in for one. */
  namedByCode?: boolean;
}

export interface SkippedAccount {
  code: string;
  klass: string;
  file: string;
  row: number;
  reason: string;
}

/** A child whose type differs from its parent's — reported, never refused. */
export interface CrossTypePair {
  code: string;
  accountType: AccountType;
  parentCode: string;
  parentType: AccountType;
}

export interface ChartPlan {
  accounts: PlannedAccount[];
  skipped: SkippedAccount[];
  crossType: CrossTypePair[];
  /** Codes with no parent — the class heads. */
  roots: string[];
}

/**
 * The class words the customer's chart uses, and what each is in this system.
 *
 * `ອື່ນໆ` ("other") is deliberately absent. It is not a class — it is the absence of one — and a
 * row carrying it takes its type from an ancestor or is left out entirely. See {@link planChart}.
 */
const CLASS_TO_TYPE: Record<string, AccountType> = {
  ຊັບສິນ: AccountType.ASSET,
  ໜີ້ສິນ: AccountType.LIABILITY,
  ລາຍຮັບ: AccountType.REVENUE,
  ລາຍຈ່າຍ: AccountType.EXPENSE,
};

/**
 * Every proper prefix of a code, longest first.
 *
 * The dotted tail goes first, then digits come off one at a time: `1213110.20` offers `1213110`,
 * `121311`, `12131`, `1213`, `121`, `12`, `1`. Which of them is the parent is decided by which one
 * EXISTS — never by how long the code is or where its separator falls. Their budget plan taught
 * that lesson at some cost: there `1.1` is a category and `1.101` a line beneath it, and both
 * carry exactly one dot.
 */
export function codePrefixes(code: string): string[] {
  const head = code.includes('.') ? code.split('.')[0] : code;
  const out: string[] = [];
  if (code.includes('.')) out.push(head);
  for (let i = head.length - 1; i > 0; i--) out.push(head.slice(0, i));
  return out.filter((c) => c && c !== code);
}

/** Thrown when two files disagree about one code. The run stops rather than picking a winner. */
export class ChartCollisionError extends Error {}

/**
 * Merge the files, then derive the three things they do not state: the hierarchy, postability, and
 * the type of a row whose class this system does not hold.
 *
 * Merging FIRST is what makes the customer's two exports usable at all: their company-specific
 * chart holds 742 accounts whose parents exist only in the parent chart, so a per-file derivation
 * would leave every one of them at the root.
 */
export function planChart(sources: SourceAccount[]): ChartPlan {
  // ── merge ────────────────────────────────────────────────────────────────────────────────
  const byCode = new Map<string, SourceAccount>();
  for (const row of sources) {
    const seen = byCode.get(row.code);
    if (!seen) {
      byCode.set(row.code, row);
      continue;
    }
    if (seen.name !== row.name || seen.klass !== row.klass) {
      throw new ChartCollisionError(
        `Account ${row.code} appears twice with different content: ` +
          `'${seen.name}' (${seen.klass}) in ${seen.file} row ${seen.row}, ` +
          `'${row.name}' (${row.klass}) in ${row.file} row ${row.row}`,
      );
    }
  }

  // ── hierarchy: the longest prefix that is itself an account here ─────────────────────────
  const parentOf = new Map<string, string | undefined>();
  for (const code of byCode.keys()) {
    parentOf.set(code, codePrefixes(code).find((p) => byCode.has(p)));
  }

  // ── postability: a node with children is a header ────────────────────────────────────────
  const hasChildren = new Set<string>();
  for (const parent of parentOf.values()) if (parent) hasChildren.add(parent);

  // ── type: the row's own class, else the nearest ancestor's, else the row is left out ─────
  const typeOf = new Map<string, AccountType>();
  const fromAncestor = new Map<string, string>();
  const skipped: SkippedAccount[] = [];
  for (const [code, row] of byCode) {
    const own = CLASS_TO_TYPE[row.klass];
    if (own) {
      typeOf.set(code, own);
      continue;
    }
    let walk = parentOf.get(code);
    while (walk && !CLASS_TO_TYPE[byCode.get(walk)!.klass]) walk = parentOf.get(walk);
    if (walk) {
      typeOf.set(code, CLASS_TO_TYPE[byCode.get(walk)!.klass]);
      fromAncestor.set(code, walk);
      continue;
    }
    // No ancestor states a class either. Guessing one would file a real account under a class its
    // owner did not put it in, which is worse than leaving it out and saying so.
    skipped.push({
      code,
      klass: row.klass,
      file: row.file,
      row: row.row,
      reason: row.klass
        ? `class '${row.klass}' is not one this system holds, and no ancestor states one`
        : 'no class, and no ancestor states one',
    });
  }

  // A skipped account must not be left as somebody's parent.
  const skippedCodes = new Set(skipped.map((s) => s.code));
  const accounts: PlannedAccount[] = [];
  for (const [code, row] of byCode) {
    if (skippedCodes.has(code)) continue;
    let parentCode = parentOf.get(code);
    while (parentCode && skippedCodes.has(parentCode)) parentCode = parentOf.get(parentCode);
    accounts.push({
      code,
      name: row.name || code,
      accountType: typeOf.get(code)!,
      parentCode,
      isPostable: !hasChildren.has(code),
      typeFromAncestor: fromAncestor.get(code),
      namedByCode: row.name ? undefined : true,
    });
  }
  accounts.sort((a, b) => a.code.localeCompare(b.code, 'en'));

  const typeByCode = new Map(accounts.map((a) => [a.code, a.accountType]));
  const crossType: CrossTypePair[] = accounts
    .filter((a) => a.parentCode && typeByCode.get(a.parentCode) !== a.accountType)
    .map((a) => ({
      code: a.code,
      accountType: a.accountType,
      parentCode: a.parentCode!,
      parentType: typeByCode.get(a.parentCode!)!,
    }));

  return {
    accounts,
    skipped,
    crossType,
    roots: accounts.filter((a) => !a.parentCode).map((a) => a.code),
  };
}
