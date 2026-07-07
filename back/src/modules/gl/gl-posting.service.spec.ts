import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BudgetTxnType, DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Workflow } from '../approval/approval.entities';
import { Budget, BudgetTxn } from '../budget/budget.entities';
import { Currency } from '../currency/currency.entities';
import { DeptDocType, Document, DocumentType, FormTemplate } from '../document/document.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { Payment } from '../payment-handoff/payment.entities';
import { AppUser } from '../rbac/rbac.entities';
import { seedDatabase } from '../../seed/seed-data';
import { AccountRoleService } from './account-role.service';
import { GlPostingService } from './gl-posting.service';
import { AccountRole, JournalEntry } from './gl.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

describe.skipIf(!hasDb)('GL posting on payment.settled (DB-backed)', () => {
  let orm: MikroORM;
  let posting: GlPostingService;
  let companyId = '';
  let budgetId = '';
  let seq = 0;

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());
    posting = new GlPostingService(orm.em, new AccountRoleService(orm.em));

    const em = orm.em.fork();
    companyId = (await em.findOneOrFail(Company, { code: 'DEMO' }, FILTER_OFF)).id;
    budgetId = (await em.findOneOrFail(Budget, { glAccount: '5000' }, { ...FILTER_OFF, populate: ['fiscalYear'] })).id;
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  /** Build a settled document: one ACTUAL cut against budget 5000 + a Payment with the given FX. */
  async function settle(lockedBase: string, actualBase: string, fxDelta: string, fxKind: string, baseTaxTotal = '0', whtAmount = '0'): Promise<string> {
    const em = orm.em.fork();
    const dept = await em.findOneOrFail(Department, { company: companyId, deptCode: 'PROC' }, FILTER_OFF);
    const prType = await em.findOneOrFail(DocumentType, { code: 'PR' }, FILTER_OFF);
    const mapping = await em.findOneOrFail(DeptDocType, { department: dept.id, documentType: prType.id }, { ...FILTER_OFF, populate: ['formTemplate', 'workflow'] });
    const requester = await em.findOneOrFail(AppUser, { username: 'requester' }, FILTER_OFF);
    const doc = em.create(Document, {
      docNo: `GL-${++seq}`, company: em.getReference(Company, companyId), department: dept,
      documentType: prType, formTemplate: em.getReference(FormTemplate, mapping.formTemplate.id),
      workflow: em.getReference(Workflow, mapping.workflow.id), createdBy: requester,
      status: DocStatus.COMPLETED, currentStepNo: 1, baseTotalAmount: lockedBase, baseTaxTotal, createdAt: new Date(),
    });
    await em.flush();
    // Expense (net) = base_locked − base_tax_total; the VAT line closes the entry to base_locked.
    const expenseNet = (Number(lockedBase) - Number(baseTaxTotal)).toFixed(2);
    em.create(BudgetTxn, { budget: em.getReference(Budget, budgetId), document: doc, txnType: BudgetTxnType.ACTUAL, amount: expenseNet, createdAt: new Date() });
    em.create(Payment, {
      company: em.getReference(Company, companyId), document: doc,
      lockedRate: '1', actualRate: '1', baseLocked: lockedBase, baseActual: actualBase,
      fxDelta, fxKind, whtAmount, paidAt: new Date(), createdAt: new Date(),
    });
    await em.flush();
    return doc.id;
  }

  async function entryFor(documentId: string) {
    return orm.em.fork().findOne(JournalEntry, { sourceType: 'PAYMENT', sourceId: documentId }, { ...FILTER_OFF, populate: ['lines', 'lines.account'] });
  }
  const sideFor = (entry: JournalEntry, code: string, side: 'debit' | 'credit') =>
    entry.lines.getItems().filter((l) => l.account.code === code).reduce((s, l) => s + Number(l[side]), 0);

  it('posts a balanced 2-line entry when there is no FX difference', async () => {
    const doc = await settle('100000.00', '100000.00', '0.00', 'NONE');
    await posting.postForPayment(doc);
    const entry = await entryFor(doc);
    expect(entry).toBeTruthy();
    const lines = entry!.lines.getItems();
    expect(lines).toHaveLength(2);
    expect(sideFor(entry!, '5000', 'debit')).toBe(100000);
    expect(sideFor(entry!, '1000', 'credit')).toBe(100000);
    const dr = lines.reduce((s, l) => s + Number(l.debit), 0);
    const cr = lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(dr).toBe(cr);
  });

  it('posts an FX loss on the debit side', async () => {
    const doc = await settle('100000.00', '102000.00', '2000.00', 'LOSS');
    await posting.postForPayment(doc);
    const entry = await entryFor(doc);
    expect(sideFor(entry!, '5000', 'debit')).toBe(100000);
    expect(sideFor(entry!, '7100', 'debit')).toBe(2000); // FX loss
    expect(sideFor(entry!, '1000', 'credit')).toBe(102000);
  });

  it('posts an FX gain on the credit side', async () => {
    const doc = await settle('100000.00', '98000.00', '-2000.00', 'GAIN');
    await posting.postForPayment(doc);
    const entry = await entryFor(doc);
    expect(sideFor(entry!, '5000', 'debit')).toBe(100000);
    expect(sideFor(entry!, '1000', 'credit')).toBe(98000);
    expect(sideFor(entry!, '4900', 'credit')).toBe(2000); // FX gain
  });

  it('posts input VAT: Dr expense + Dr VAT_INPUT, Cr cash, balanced', async () => {
    // net 100000 + VAT 7000 → base_locked = base_actual = 107000, base_tax_total = 7000.
    const doc = await settle('107000.00', '107000.00', '0.00', 'NONE', '7000.00');
    await posting.postForPayment(doc);
    const entry = await entryFor(doc);
    expect(sideFor(entry!, '5000', 'debit')).toBe(100000); // expense net
    expect(sideFor(entry!, '1150', 'debit')).toBe(7000); // VAT_INPUT
    expect(sideFor(entry!, '1000', 'credit')).toBe(107000); // cash
    const lines = entry!.lines.getItems();
    const dr = lines.reduce((s, l) => s + Number(l.debit), 0);
    const cr = lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(dr).toBe(cr);
  });

  it('posts input VAT and WHT: Dr expense+VAT, Cr cash(net)+WHT_PAYABLE, balanced', async () => {
    // net 100000 + VAT 7000 → base 107000, base_tax_total 7000; WHT 3000 withheld.
    const doc = await settle('107000.00', '107000.00', '0.00', 'NONE', '7000.00', '3000.00');
    await posting.postForPayment(doc);
    const entry = await entryFor(doc);
    expect(sideFor(entry!, '5000', 'debit')).toBe(100000); // expense net
    expect(sideFor(entry!, '1150', 'debit')).toBe(7000); // VAT_INPUT
    expect(sideFor(entry!, '2100', 'credit')).toBe(3000); // WHT_PAYABLE
    expect(sideFor(entry!, '1000', 'credit')).toBe(104000); // cash net of WHT (107000 − 3000)
    const lines = entry!.lines.getItems();
    const dr = lines.reduce((s, l) => s + Number(l.debit), 0);
    const cr = lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(dr).toBe(cr);
  });

  it('omits the WHT line for a settlement with no WHT', async () => {
    const doc = await settle('60000.00', '60000.00', '0.00', 'NONE'); // whtAmount defaults to 0
    await posting.postForPayment(doc);
    const entry = await entryFor(doc);
    expect(sideFor(entry!, '2100', 'credit')).toBe(0); // no WHT_PAYABLE line
    expect(sideFor(entry!, '1000', 'credit')).toBe(60000); // full cash
  });

  it('omits the VAT line for a tax-free settlement', async () => {
    const doc = await settle('80000.00', '80000.00', '0.00', 'NONE'); // baseTaxTotal defaults to 0
    await posting.postForPayment(doc);
    const entry = await entryFor(doc);
    expect(sideFor(entry!, '1150', 'debit')).toBe(0); // no VAT_INPUT line
    expect(entry!.lines.getItems()).toHaveLength(2);
  });

  it('is idempotent — a second settle event posts no second entry', async () => {
    const doc = await settle('50000.00', '50000.00', '0.00', 'NONE');
    await posting.postForPayment(doc);
    await posting.postForPayment(doc);
    const count = await orm.em.fork().count(JournalEntry, { sourceType: 'PAYMENT', sourceId: doc }, FILTER_OFF);
    expect(count).toBe(1);
  });

  it('fails the posting (no entry) when a required role is unmapped', async () => {
    // Remove the CASH_CLEARING mapping, then attempt to post.
    const em = orm.em.fork();
    em.setFilterParams('company', { companyId });
    await em.nativeDelete(AccountRole, { company: companyId, role: 'CASH_CLEARING' });
    const doc = await settle('10000.00', '10000.00', '0.00', 'NONE');
    await expect(posting.postForPayment(doc)).rejects.toThrow(/CASH_CLEARING/);
    const entry = await entryFor(doc);
    expect(entry).toBeNull();
  });

  it('rejects mutating a journal entry (append-only)', async () => {
    // Insert a bare entry directly, then attempt to update it — the ledger guard must reject.
    const em = orm.em.fork();
    const entry = em.create(JournalEntry, {
      company: em.getReference(Company, companyId),
      entryDate: '2026-07-07', sourceType: 'PAYMENT', sourceId: '00000000-0000-4000-8000-000000000001',
      createdAt: new Date(),
    });
    await em.flush();
    entry.memo = 'tampered';
    await expect(em.flush()).rejects.toThrow(/append-only|update/i);
  });
});
