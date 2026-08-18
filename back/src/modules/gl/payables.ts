import type { EntityManager } from '@mikro-orm/postgresql';
import { AccountRoleType } from '../../common/enums';
import { Money } from '../../common/money/money';
import { SOURCE_ACCRUAL } from './gl-posting.service';
import { AccountRole, JournalEntry, JournalLine } from './gl.entities';

const FILTER_OFF = { filters: { company: false } } as const;

/** Which payable an accrual raised: owed to a supplier, or owed to a person. */
export type PayableKind = 'TRADE' | 'CLAIM';

/**
 * The account roles a payable can be raised against, and what to call each on a report.
 *
 * A TABLE rather than a branch. "Open" means the same thing for every row — an accrual credited
 * this account and no payment has cleared it — so a third payable is a row here, not a third code
 * path. Order is the reporting order: trade first, then other, the way IAS 1 names them.
 */
export const PAYABLE_KINDS: ReadonlyArray<{ kind: PayableKind; role: AccountRoleType }> = [
  { kind: 'TRADE', role: AccountRoleType.ACCOUNTS_PAYABLE },
  { kind: 'CLAIM', role: AccountRoleType.CLAIM_PAYABLE },
];

/**
 * The payable account ids this company maps, by kind.
 *
 * A role the company has not mapped contributes nothing rather than raising: no accrual can have
 * credited an account that does not exist, and `CLAIM_PAYABLE` is mapped only by a company that
 * pays people. A read that failed without it would take the trade ageing — the figure most
 * companies actually use — down with it.
 */
export async function payableAccountsOf(
  em: EntityManager,
  companyId: string,
): Promise<Map<string, PayableKind>> {
  const roles = await em.find(
    AccountRole,
    { company: companyId, role: { $in: PAYABLE_KINDS.map((p) => p.role) } },
    { ...FILTER_OFF, populate: ['account'] },
  );
  const kindByRole = new Map<string, PayableKind>(
    PAYABLE_KINDS.map((p) => [p.role as string, p.kind]),
  );
  const out = new Map<string, PayableKind>();
  for (const r of roles) {
    const kind = kindByRole.get(r.role as string);
    if (kind) out.set(r.account.id, kind);
  }
  return out;
}

/** What one document's approval accrual raised, and how much of it. */
export interface AccruedPayable {
  documentId: string;
  kind: PayableKind;
  /** The payable account the accrual credited. */
  accountId: string;
  amount: string;
  /** The accrual's `entry_date` — the day the obligation was recognised. */
  entryDate: string;
}

/**
 * The payables this company's approval accruals raised, keyed by document.
 *
 * Read from the accrual's own credit lines rather than from whether the document carries a vendor:
 * the accrual made that decision and wrote it into the ledger, and re-deriving it from the document
 * would be a second opinion about a fact the entry records.
 *
 * One pass over the company's accruals, so a caller that needs many documents does not ask per row.
 */
export async function accruedPayablesOf(
  em: EntityManager,
  companyId: string,
  documentIds?: string[],
): Promise<Map<string, AccruedPayable>> {
  const out = new Map<string, AccruedPayable>();
  const payableAccounts = await payableAccountsOf(em, companyId);
  if (!payableAccounts.size) return out;

  const where: Record<string, unknown> = { company: companyId, sourceType: SOURCE_ACCRUAL };
  if (documentIds) {
    if (!documentIds.length) return out;
    where.sourceId = { $in: documentIds };
  }
  const accruals = await em.find(JournalEntry, where, FILTER_OFF);
  if (!accruals.length) return out;

  const lines = await em.find(
    JournalLine,
    { journalEntry: { $in: accruals.map((a) => a.id) } },
    FILTER_OFF,
  );
  const entryById = new Map(accruals.map((a) => [a.id, a]));
  for (const line of lines) {
    const kind = payableAccounts.get(line.account.id);
    // An expense, VAT or GRNI debit — not the payable side.
    if (!kind || Money.compare(line.credit, '0') <= 0) continue;
    const entry = entryById.get(line.journalEntry.id);
    if (!entry) continue;
    const cur = out.get(entry.sourceId);
    out.set(entry.sourceId, {
      documentId: entry.sourceId,
      kind,
      accountId: line.account.id,
      amount: cur ? Money.add(cur.amount, line.credit) : line.credit,
      entryDate: entry.entryDate,
    });
  }
  return out;
}
