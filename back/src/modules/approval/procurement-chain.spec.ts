import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { DocCategory, DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { BudgetLedgerService } from '../budget/budget-ledger.service';
import { Budget, BudgetTxn } from '../budget/budget.entities';
import { Currency } from '../currency/currency.entities';
import { MatchingService } from '../document/matching.service';
import { Document, DocumentLine, DocumentType, FormTemplate } from '../document/document.entities';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { Workflow } from './approval.entities';
import { PostActionService } from './post-action.service';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

describe.skipIf(!hasDb)('procurement chain: matching + ancestor settlement (DB-backed)', () => {
  let orm: MikroORM;
  let budgetBalance: BudgetBalanceService;
  let budgetLedger: BudgetLedgerService;
  const ids = { company: '', dept: '', fy: '', user: '', poType: '', disbType: '', poTmpl: '', disbTmpl: '', wf: '', budget: '' };
  let seq = 0;

  function asUser<T>(fn: () => Promise<T>): Promise<T> {
    return RequestContext.run({ userId: ids.user, companyId: ids.company, departmentId: ids.dept, grants: [] }, fn);
  }

  /** Make a document of a type with one line; returns the doc id. */
  async function doc(
    typeId: string, tmplId: string, status: DocStatus,
    line: { budgetId?: string; qty: string; lineAmount: string; baseLineAmount?: string; receivedQty?: string },
    refDocumentId?: string,
  ): Promise<string> {
    const em = orm.em.fork();
    const d = em.create(Document, {
      docNo: `D-${seq++}`,
      company: em.getReference(Company, ids.company),
      department: em.getReference(Department, ids.dept),
      documentType: em.getReference(DocumentType, typeId),
      formTemplate: em.getReference(FormTemplate, tmplId),
      workflow: em.getReference(Workflow, ids.wf),
      createdBy: em.getReference(AppUser, ids.user),
      refDocument: refDocumentId ? em.getReference(Document, refDocumentId) : undefined,
      exchangeRate: '1',
      status,
      createdAt: new Date(),
    });
    em.create(DocumentLine, {
      document: d, lineNo: 1, description: 'Widget', qty: line.qty, unitPrice: '10',
      lineAmount: line.lineAmount, baseLineAmount: line.baseLineAmount,
      budget: line.budgetId ? em.getReference(Budget, line.budgetId) : undefined,
      receivedQty: line.receivedQty ?? '0',
    });
    await em.flush();
    return d.id;
  }

  function matching(): MatchingService {
    return new MatchingService(orm.em, new CompanyScopeService(orm.em));
  }
  function postAction(): PostActionService {
    return new PostActionService(budgetLedger, orm.em);
  }

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    budgetBalance = new BudgetBalanceService(orm.em);
    budgetLedger = new BudgetLedgerService(orm.em, budgetBalance);
    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const company = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true });
    const dept = em.create(Department, { company, deptCode: 'DA', name: 'DA', isActive: true });
    const fy = em.create(FiscalYear, { company, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const user = em.create(AppUser, { username: 'buyer', email: 'buyer@x', status: 'ACTIVE' });
    const poType = em.create(DocumentType, { code: 'PO', name: 'PO', category: DocCategory.PROCUREMENT, requiresBudget: false, requiresQuota: false, isActive: true });
    const disbType = em.create(DocumentType, { code: 'DISB', name: 'Disbursement', category: DocCategory.FINANCE, requiresBudget: false, requiresQuota: false, postAction: 'CUT_BUDGET', isActive: true });
    const poTmpl = em.create(FormTemplate, { documentType: poType, version: 1, status: 'PUBLISHED' });
    const disbTmpl = em.create(FormTemplate, { documentType: disbType, version: 1, status: 'PUBLISHED' });
    const wf = em.create(Workflow, { company, name: 'WF', isActive: true });
    const budget = em.create(Budget, { fiscalYear: fy, department: dept, glAccount: 'GL1', amountTotal: '1000000', status: 'ACTIVE' });
    await em.flush();
    Object.assign(ids, {
      company: company.id, dept: dept.id, fy: fy.id, user: user.id,
      poType: poType.id, disbType: disbType.id, poTmpl: poTmpl.id, disbTmpl: disbTmpl.id, wf: wf.id, budget: budget.id,
    });
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  it('blocks matching when invoiced qty exceeds received', async () => {
    const poId = await doc(ids.poType, ids.poTmpl, DocStatus.COMPLETED, { qty: '10', lineAmount: '100', receivedQty: '4' });
    const disbId = await doc(ids.disbType, ids.disbTmpl, DocStatus.DRAFT, { qty: '6', lineAmount: '100' }, poId);

    await expect(asUser(() => matching().assertMatched(disbId))).rejects.toThrow(/matching failed/i);
    const result = await asUser(() => matching().match(disbId));
    expect(result.ok).toBe(false);
    expect(result.lines[0].receivedQty).toBe('4.0000');
    expect(result.lines[0].invoicedQty).toBe('6.0000');
  });

  it('passes matching and settles the reserving ancestor (PR) on disbursement approval', async () => {
    // PR reserves 100 on the budget; PO references PR; disbursement references PO.
    const prId = await doc(ids.poType, ids.poTmpl, DocStatus.COMPLETED, { budgetId: ids.budget, qty: '10', lineAmount: '100' });
    await asUser(() => budgetLedger.reserve(prId, [{ budgetId: ids.budget, baseAmount: '100' }]));
    expect(Number(await budgetBalance.outstandingReserved(prId, ids.budget))).toBe(100);

    const poId = await doc(ids.poType, ids.poTmpl, DocStatus.COMPLETED, { budgetId: ids.budget, qty: '10', lineAmount: '100', receivedQty: '10' }, prId);
    const disbId = await doc(ids.disbType, ids.disbTmpl, DocStatus.IN_APPROVAL, { budgetId: ids.budget, qty: '10', lineAmount: '100', baseLineAmount: '100' }, poId);

    // Matching passes (invoiced 10 ≤ received 10, amount 100 ≤ ordered 100).
    expect((await asUser(() => matching().match(disbId))).ok).toBe(true);

    // Run the disbursement's CUT_BUDGET post-action: it settles the PR's reservation.
    const disb = await orm.em.fork().findOneOrFail(Document, { id: disbId }, { ...FILTER_OFF, populate: ['documentType', 'company'] });
    await asUser(() =>
      orm.em.fork().transactional((tem: EntityManager) => postAction().run(disb, tem)),
    );

    // The PR's reservation is now actualized: ACTUAL recorded against the PR, reservation cleared.
    expect(Number(await budgetBalance.outstandingReserved(prId, ids.budget))).toBe(0);
    const prTxns = await orm.em.fork().find(BudgetTxn, { document: prId }, FILTER_OFF);
    expect(prTxns.some((t) => t.txnType === ('ACTUAL' as any) && Number(t.amount) === 100)).toBe(true);
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[procurement-chain] no database reachable — skipping DB-backed spec');
}
