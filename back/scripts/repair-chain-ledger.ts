import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { AppModule } from '../src/app.module';
import { RequestContext } from '../src/common/context/request-context';
import { BudgetTxnType, StockTxnType } from '../src/common/enums';
import { StockTxn } from '../src/modules/inventory/inventory.entities';
import { Money } from '../src/common/money/money';
import { BudgetLedgerService } from '../src/modules/budget/budget-ledger.service';
import { BudgetTxn } from '../src/modules/budget/budget.entities';
import { Document } from '../src/modules/document/document.entities';
import { GlPostingService } from '../src/modules/gl/gl-posting.service';
import { JournalEntry } from '../src/modules/gl/gl.entities';
import { Payment } from '../src/modules/payment-handoff/payment.entities';
import { AppUser } from '../src/modules/rbac/rbac.entities';

/**
 * One-off repair for data written before `chain-single-budget-reservation`.
 *
 * Two defects left rows behind, and both are repaired by APPENDING — `budget_txn` and
 * `journal_entry` are append-only (invariant 2), so nothing here updates or deletes:
 *
 * 1. Every budget-controlled document in a reference chain took its own RESERVE, but settlement
 *    only ever converts the chain's holder. The duplicate hold can never be settled (a COMPLETED
 *    document is released only on reject/cancel), so it is released here with a RELEASE row.
 * 2. GL posting looked for the paid document's own ACTUAL rows. When the chain's hold sat on an
 *    ancestor it found none and skipped the entry, leaving a payment with no journal entry.
 * 3. A goods receipt wrote its `stock_txn` without announcing `stock.moved`, so the receipt was
 *    never capitalized (Dr INVENTORY / Cr GRNI) and the GRNI debit taken at payment never cleared.
 *
 * Dry-run by default — prints the plan and writes nothing. Pass `--apply` to write.
 *   pnpm --filter back exec ts-node -P tsconfig.json scripts/repair-chain-ledger.ts [--apply]
 */

const APPLY = process.argv.includes('--apply');
const FILTER_OFF = { filters: { company: false } } as const;

interface StrandedHold {
  documentId: string;
  docNo: string;
  budgetId: string;
  outstanding: string;
  settledBy: string;
}

/** Outstanding reserve per document+budget: Σ RESERVE − Σ RELEASE − Σ ACTUAL. */
function outstandingByDocBudget(txns: BudgetTxn[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const t of txns) {
    const key = `${t.document.id}|${t.budget.id}`;
    const cur = out.get(key) ?? '0';
    out.set(
      key,
      t.txnType === BudgetTxnType.RESERVE ? Money.add(cur, t.amount) : Money.subtract(cur, t.amount),
    );
  }
  return out;
}

/**
 * Holds that can never be settled: an outstanding reserve on a COMPLETED document whose ref-chain
 * DESCENDANT already recorded an ACTUAL on the same budget — i.e. the chain was settled elsewhere
 * and this is the duplicate. A hold on a document still moving through approval is left alone.
 */
async function findStrandedHolds(em: EntityManager): Promise<StrandedHold[]> {
  const txns = await em.find(BudgetTxn, {}, FILTER_OFF);
  const outstanding = outstandingByDocBudget(txns);
  const actualsByDocBudget = new Set(
    txns.filter((t) => t.txnType === BudgetTxnType.ACTUAL).map((t) => `${t.document.id}|${t.budget.id}`),
  );
  const documents = await em.find(Document, {}, { ...FILTER_OFF, populate: ['refDocument'] });
  const byId = new Map(documents.map((d) => [d.id, d]));
  const childrenOf = new Map<string, string[]>();
  for (const d of documents) {
    const parent = d.refDocument?.id;
    if (parent) childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), d.id]);
  }

  const stranded: StrandedHold[] = [];
  for (const [key, amount] of outstanding) {
    if (Money.compare(amount, '0') <= 0) continue;
    const [documentId, budgetId] = key.split('|');
    const doc = byId.get(documentId);
    if (!doc || doc.status !== 'COMPLETED') continue;

    // Breadth-first over descendants; the first one carrying an ACTUAL on this budget settled it.
    const queue = [...(childrenOf.get(documentId) ?? [])];
    const seen = new Set<string>([documentId]);
    let settledBy: string | undefined;
    while (queue.length && !settledBy) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      if (actualsByDocBudget.has(`${id}|${budgetId}`)) settledBy = byId.get(id)?.docNo ?? id;
      else queue.push(...(childrenOf.get(id) ?? []));
    }
    if (settledBy) {
      stranded.push({ documentId, docNo: doc.docNo, budgetId, outstanding: amount, settledBy });
    }
  }
  return stranded;
}

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  await app.init();
  const em = app.get(EntityManager).fork();
  const ledger = app.get(BudgetLedgerService);
  const posting = app.get(GlPostingService);

  // 1. Stranded duplicate holds -------------------------------------------------
  const stranded = await findStrandedHolds(em);
  console.log(`\n[1] Stranded duplicate budget holds: ${stranded.length}`);
  for (const s of stranded) {
    console.log(`    ${s.docNo}  RELEASE ${s.outstanding}  (chain settled by ${s.settledBy})`);
  }

  // 2. Settled payments with no journal entry -----------------------------------
  const payments = await em.find(Payment, {}, { ...FILTER_OFF, populate: ['document'] });
  const posted = new Set(
    (await em.find(JournalEntry, { sourceType: 'PAYMENT' }, FILTER_OFF)).map((e) => e.sourceId),
  );
  const unposted = payments.filter((p) => !posted.has(p.document.id));
  console.log(`\n[2] Payments with no journal entry: ${unposted.length}`);
  for (const p of unposted) {
    const doc = await em.findOne(Document, { id: p.document.id }, FILTER_OFF);
    console.log(`    ${doc?.docNo ?? p.document.id}  base_actual ${p.baseActual}`);
  }

  // 3. Value-bearing stock movements with no journal entry ----------------------
  // Goods receipts written before ReceivingService announced `stock.moved`: the stock ledger has
  // them, the GL never heard. RESERVE/RELEASE move no value and never post.
  const stockTxns = await em.find(
    StockTxn,
    { txnType: { $nin: [StockTxnType.RESERVE, StockTxnType.RELEASE] } },
    { ...FILTER_OFF, populate: ['item', 'warehouse'] },
  );
  const postedStock = new Set(
    (await em.find(JournalEntry, { sourceType: 'STOCK_TXN' }, FILTER_OFF)).map((e) => e.sourceId),
  );
  const unpostedStock = stockTxns.filter((t) => !postedStock.has(t.id));
  console.log(`\n[3] Stock movements with no journal entry: ${unpostedStock.length}`);
  for (const t of unpostedStock) {
    console.log(`    ${t.txnType} ${t.qty} ${t.item.itemCode} @ ${t.warehouse.code}  unit_cost ${t.unitCost ?? '—'}`);
  }

  if (!APPLY) {
    console.log('\nDry run — nothing written. Re-run with --apply to write these rows.');
    await app.close();
    return;
  }

  // Attribute the corrections to a real user so `budget_txn.created_by` is not null.
  const actor = await em.findOneOrFail(AppUser, { username: 'admin' }, FILTER_OFF);
  for (const s of stranded) {
    const doc = await em.findOneOrFail(Document, { id: s.documentId }, { ...FILTER_OFF, populate: ['company'] });
    await RequestContext.run(
      { userId: actor.id, companyId: doc.company.id, departmentId: doc.department.id, grants: [] },
      () => ledger.releaseAll(s.documentId),
    );
    console.log(`    released ${s.outstanding} on ${s.docNo}`);
  }
  for (const p of unposted) {
    // Idempotent per source, and a no-op when the chain has no ACTUAL to post from.
    await posting.postForPayment(p.document.id);
  }
  const stillUnposted = (
    await em.fork().find(JournalEntry, { sourceType: 'PAYMENT' }, FILTER_OFF)
  ).map((e) => e.sourceId);
  for (const p of unposted) {
    const doc = await em.findOne(Document, { id: p.document.id }, FILTER_OFF);
    const ok = stillUnposted.includes(p.document.id);
    console.log(`    ${ok ? 'posted' : 'skipped (no ACTUAL in the chain)'}: ${doc?.docNo}`);
  }

  for (const t of unpostedStock) {
    try {
      await posting.postForStockTxn(t.id);
      // A zero-value movement legitimately posts nothing, so report what actually landed.
      const wrote = await em
        .fork()
        .findOne(JournalEntry, { sourceType: 'STOCK_TXN', sourceId: t.id }, FILTER_OFF);
      console.log(
        `    ${wrote ? 'posted' : 'no entry (zero value)'}: ${t.txnType} ${t.qty} ${t.item.itemCode}`,
      );
    } catch (err) {
      // A movement whose account roles are unmapped stays unposted rather than aborting the rest.
      console.log(`    failed ${t.txnType} ${t.qty} ${t.item.itemCode}: ${(err as Error).message}`);
    }
  }

  console.log('\nDone.');
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
