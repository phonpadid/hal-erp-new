import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { signAllUsers } from '../../test/signature-fixture';
import { seedDatabase, SEED_COMPANY_CODE } from '../../seed/seed-data';
import { AccountService } from '../accounting/account.service';
import { WorkflowStep } from '../approval/approval.entities';
import { WorkflowStepResolver } from '../approval/workflow-step.resolver';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { BudgetCoverageService } from '../budget/budget-coverage.service';
import { BudgetLedgerService } from '../budget/budget-ledger.service';
import { BudgetService } from '../budget/budget.service';
import { Budget, BudgetTxn } from '../budget/budget.entities';
import { ExchangeRateService } from '../currency/exchange-rate.service';
import { ItemService } from '../master-data/item.service';
import { VendorService } from '../master-data/vendor.service';
import { Vendor } from '../master-data/master-data.entities';
import { Company } from '../multi-company/multi-company.entities';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { QuotaBalanceService } from '../quota/quota-balance.service';
import { QuotaUsageService } from '../quota/quota-usage.service';
import { ScopeService } from '../rbac/scope.service';
import { AppUser } from '../rbac/rbac.entities';
import { DeptDocTypeService } from './dept-doc-type.service';
import { DocumentService } from './document.service';
import { DocumentSubmitService } from './document-submit.service';
import { NumberingService } from './numbering.service';
import { DeptDocType, Document, DocumentType, FormField, FormTemplate } from './document.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * A document whose workflow engages no step can never be approved — nothing opens, so no approver
 * ever sees it. Routing used to discover that AFTER the submit committed, from an event listener
 * whose own message admits what it costs: *"the budget it reserved stays held"*. The document was
 * left `SUBMITTED`, holding an appropriation that only a settlement or a rejection can release, and
 * neither can happen to a document nobody can act on.
 *
 * The gate asks before any hold is taken. These tests are mostly about WHEN, not about the message.
 */
describe.skipIf(!hasDb)('submit needs somewhere to route (DB-backed)', () => {
  let orm: MikroORM;
  let documents: DocumentService;
  let submit: DocumentSubmitService;
  let ledgerRef: BudgetLedgerService;
  let companyId = '';
  let deptId = '';
  let userId = '';
  let prTypeId = '';
  let budgetId = '';
  let vendorId = '';
  let reasonFieldId = '';

  const asRequester = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId, companyId, departmentId: deptId, grants: [] }, fn);

  /** Push every step of the PR workflow out of reach of `amount`, leaving a band gap. */
  async function makeUnroutable(): Promise<void> {
    const em = orm.em.fork();
    const steps = await em.find(WorkflowStep, {}, FILTER_OFF);
    for (const s of steps) s.amountMin = '99999999';
    await em.flush();
  }

  async function restoreBands(): Promise<void> {
    const em = orm.em.fork();
    const steps = await em.find(WorkflowStep, {}, FILTER_OFF);
    for (const s of steps) s.amountMin = undefined;
    await em.flush();
  }

  /** Every step engages only at or above `min` — a workflow whose lowest band is not zero. */
  async function bandFrom(min: string): Promise<void> {
    const em = orm.em.fork();
    const steps = await em.find(WorkflowStep, {}, FILTER_OFF);
    for (const s of steps) s.amountMin = min;
    await em.flush();
  }

  async function draftPr(amount: string): Promise<string> {
    const doc = await asRequester(() =>
      documents.createDraft({
        documentTypeId: prTypeId,
        vendorId,
        // PR's form template requires a reason; the gate under test runs after the field checks,
        // so an incomplete draft would be refused for the wrong thing.
        fieldValues: [{ formFieldId: reasonFieldId, value: 'stationery for the quarter' }],
        lines: [{ lineNo: 1, description: 'stationery', qty: '1', unitPrice: amount, lineAmount: amount, budgetId }],
      } as never),
    );
    return doc.id;
  }

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());

    const em = orm.em.fork();
    companyId = (await em.findOneOrFail(Company, { code: SEED_COMPANY_CODE }, FILTER_OFF)).id;
    // The department PR is actually mapped to — dept_doc_type decides which department may raise
    // which type, and picking any department of the company is not the same thing.
    prTypeId = (await em.findOneOrFail(DocumentType, { code: 'PR' }, FILTER_OFF)).id;
    deptId = (await em.findOneOrFail(DeptDocType, { documentType: prTypeId }, { ...FILTER_OFF, populate: ['department'] })).department.id;
    userId = (await em.findOneOrFail(AppUser, { username: 'requester' }, FILTER_OFF)).id;
    budgetId = (await em.find(Budget, {}, { ...FILTER_OFF, limit: 1 }))[0].id;
    vendorId = (await em.find(Vendor, {}, { ...FILTER_OFF, limit: 1 }))[0].id;
    const prTemplate = await em.findOneOrFail(FormTemplate, { documentType: prTypeId }, FILTER_OFF);
    reasonFieldId = (await em.findOneOrFail(FormField, { formTemplate: prTemplate.id, fieldName: 'reason' }, FILTER_OFF)).id;

    const scope = new CompanyScopeService(orm.em);
    const accounts = new AccountService(orm.em, scope);
    const items = new ItemService(orm.em, scope, new ScopeService(), accounts);
    const balance = new BudgetBalanceService(orm.em);
    const ledger = new BudgetLedgerService(orm.em, balance, new BudgetCoverageService(orm.em));
    ledgerRef = ledger;
    const fiscalYears = new FiscalYearService(scope);

    documents = new DocumentService(
      orm.em, scope, new DeptDocTypeService(orm.em), new NumberingService(orm.em),
      items, new BudgetService(orm.em, accounts, balance), fiscalYears,
    );
    submit = new DocumentSubmitService(
      orm.em,
      new ExchangeRateService(orm.em),
      fiscalYears,
      new VendorService(orm.em, scope, new ScopeService()),
      items,
      ledger,
      new QuotaUsageService(orm.em, new QuotaBalanceService(orm.em)),
      undefined, // matching
      undefined, // stock
      undefined, // warehouses
      undefined, // events
      new WorkflowStepResolver(orm.em),
    );
    // Submitting and approving need a signature on file; not this spec's subject, so everyone gets one.
    await signAllUsers(orm.em);
  });

  beforeEach(restoreBands);

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  it('refuses a document its workflow has no step for', async () => {
    await makeUnroutable();
    const id = await draftPr('1000');
    await expect(asRequester(() => submit.submit(id))).rejects.toThrow(BadRequestException);
  });

  it('leaves that document DRAFT', async () => {
    await makeUnroutable();
    const id = await draftPr('1000');
    await expect(asRequester(() => submit.submit(id))).rejects.toThrow();

    const after = await orm.em.fork().findOneOrFail(Document, { id }, FILTER_OFF);
    expect(after.status).toBe(DocStatus.DRAFT);
  });

  it('reserves nothing when it refuses', async () => {
    // THE point of the gate. Detecting this after the commit — which is what the event listener
    // does today — leaves an appropriation held by a route that never started, and only a
    // settlement or a rejection releases one.
    await makeUnroutable();
    const id = await draftPr('1000');
    await expect(asRequester(() => submit.submit(id))).rejects.toThrow();

    const txns = await orm.em.fork().find(BudgetTxn, { document: id }, FILTER_OFF);
    expect(txns).toHaveLength(0);
  });

  it('never even attempts the reservation', async () => {
    // The one assertion that distinguishes WHERE the gate sits. Every other test here passes just
    // as well with the gate moved inside the transaction, because the rollback leaves the same
    // observable state — verified by mutation. Only a spy sees the difference between "refused
    // before the work" and "did the work, then undid it".
    await makeUnroutable();
    const id = await draftPr('1000');
    const reserve = vi.spyOn(ledgerRef, 'reserve');
    try {
      await expect(asRequester(() => submit.submit(id))).rejects.toThrow();
      expect(reserve).not.toHaveBeenCalled();
    } finally {
      reserve.mockRestore();
    }
  });

  it('still submits a document the workflow does have a step for', async () => {
    // The gate must not refuse the normal case.
    const id = await draftPr('1000');
    await asRequester(() => submit.submit(id));

    const after = await orm.em.fork().findOneOrFail(Document, { id }, FILTER_OFF);
    expect(after.status).toBe(DocStatus.SUBMITTED);
    const txns = await orm.em.fork().find(BudgetTxn, { document: id }, FILTER_OFF);
    expect(txns.length).toBeGreaterThan(0);
  });

  it('accepts a first submission inside a band that does not start at zero', async () => {
    // The gate reads the amount this submission computes, not `budget_base_total_amount` — which
    // submit stamps further down, inside a transaction the gate deliberately runs above. Reading
    // the column here saw null on a first submission, compared every band against zero, and made a
    // workflow whose lowest step starts above zero refuse every document it ever received.
    await bandFrom('5000');
    const id = await draftPr('10000');
    await asRequester(() => submit.submit(id));

    const after = await orm.em.fork().findOneOrFail(Document, { id }, FILTER_OFF);
    expect(after.status).toBe(DocStatus.SUBMITTED);
  });

  it('still refuses a first submission below that band', async () => {
    await bandFrom('5000');
    const id = await draftPr('1000');
    await expect(asRequester(() => submit.submit(id))).rejects.toThrow(BadRequestException);

    const after = await orm.em.fork().findOneOrFail(Document, { id }, FILTER_OFF);
    expect(after.status).toBe(DocStatus.DRAFT);
    expect(await orm.em.fork().find(BudgetTxn, { document: id }, FILTER_OFF)).toHaveLength(0);
  });

  it('judges a resubmission on the amount it now carries, not the one it used to', async () => {
    // A returned document keeps the figure its previous attempt stamped. If the gate reads that
    // column, a document whose lines were cut below the band is waved through on the strength of
    // what it was worth last time — and the router, which resolves after the fresh stamp, then
    // finds nothing applicable and strands it.
    await bandFrom('5000');
    const id = await draftPr('1000');

    const em = orm.em.fork();
    const doc = await em.findOneOrFail(Document, { id }, FILTER_OFF);
    doc.budgetBaseTotalAmount = '10000'; // what the earlier, larger attempt stamped
    doc.baseTotalAmount = '10000';
    await em.flush();

    await expect(asRequester(() => submit.submit(id))).rejects.toThrow(BadRequestException);
    expect(await orm.em.fork().find(BudgetTxn, { document: id }, FILTER_OFF)).toHaveLength(0);
  });

  it('agrees with the router about what is routable', async () => {
    // The gate and `routing.start()` must never disagree — a document the gate accepts and routing
    // then refuses is exactly the stranding this change exists to prevent, reached by a longer
    // road. Both ask `applicableSteps`; this asserts they are asking the same thing.
    const resolver = new WorkflowStepResolver(orm.em);
    const load = async (id: string) => {
      // A FRESH fork each time: an EM that read the steps before the bands moved keeps them in its
      // identity map and answers from the state it already saw.
      const em = orm.em.fork();
      const doc = await em.findOneOrFail(Document, { id }, { ...FILTER_OFF, populate: ['workflow', 'createdBy', 'company'] });
      return { em, doc };
    };

    await makeUnroutable();
    const blockedId = await draftPr('1000');
    const blocked = await load(blockedId);
    expect(await resolver.applicableSteps(blocked.doc, blocked.em)).toHaveLength(0);

    await restoreBands();
    const okId = await draftPr('1000');
    const ok = await load(okId);
    expect((await resolver.applicableSteps(ok.doc, ok.em)).length).toBeGreaterThan(0);
  });
});
