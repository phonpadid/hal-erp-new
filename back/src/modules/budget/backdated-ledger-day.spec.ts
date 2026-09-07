import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BudgetTxnType } from '../../common/enums';
import { localDateIn } from '../../common/time/company-clock';
import { attachCoverage, budgetAt } from '../../test/budget-fixture';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Workflow } from '../approval/approval.entities';
import { Document, DocumentType, FormTemplate } from '../document/document.entities';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { BudgetBalanceService } from './budget-balance.service';
import { BudgetCoverageService } from './budget-coverage.service';
import { BudgetLedgerService } from './budget-ledger.service';
import { Budget, BudgetTxn } from './budget.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
let tz = 'Asia/Bangkok';
const FILTER_OFF = { filters: { company: false } } as const;
const YEAR = 2026;
/** A day in Q1 — the shape this capability exists for: a spend entered months after it happened. */
const IN_MARCH = `${YEAR}-03-14`;

/**
 * Which day a `budget_txn` row carries.
 *
 * `txn_date` has always meant the day of the event, but the write path computed it as the company's
 * day at the moment of the write, so a year of spending entered by hand in August landed entirely in
 * Q3. A document of a type that records past events states the day its money moved, and every row it
 * writes — the RESERVE at submit and the ACTUAL/RELEASE at settlement — carries that day instead.
 *
 * These tests exercise the ledger directly. The guards that decide whether a day may be STATED
 * (the type's flag, the permission, the fiscal year, the future, a closed period) live in the
 * document services and are tested with them; here the question is only what the ledger does with a
 * day once a document carries one.
 */
describe.skipIf(!hasDb)('a ledger row is dated by the document', () => {
  let orm: MikroORM;
  let ledger: BudgetLedgerService;
  let balance: BudgetBalanceService;

  const ids = {
    company: '', dept: '', fy: '', backdated: '', ordinary: '',
    histType: '', histTemplate: '', workflow: '', user: '',
  };
  let docNo = 100;
  let gl = 0;

  const makeBudget = async (amountTotal: string): Promise<string> => {
    const em = orm.em.fork();
    const code = `GL-${gl++}`;
    const b = budgetAt(em, {
      fiscalYear: em.getReference(FiscalYear, ids.fy),
      department: em.getReference(Department, ids.dept),
      code,
      glAccount: code,
      amountTotal,
      status: 'ACTIVE',
    });
    attachCoverage(em, em.getReference(Company, ids.company), b);
    await em.persistAndFlush(b);
    return b.id;
  };

  /** Another backdated document of the history type, so a test can have a ledger of its own. */
  const makeBackdatedDoc = async (): Promise<string> => {
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `SH-${YEAR}-0${docNo++}`,
      company: em.getReference(Company, ids.company),
      department: em.getReference(Department, ids.dept),
      documentType: em.getReference(DocumentType, ids.histType),
      formTemplate: em.getReference(FormTemplate, ids.histTemplate),
      workflow: em.getReference(Workflow, ids.workflow),
      currentStepNo: 0,
      createdBy: em.getReference(AppUser, ids.user),
      exchangeRate: '1',
      status: 'DRAFT' as never,
      moneyMovedOn: IN_MARCH,
    } as never);
    await em.persistAndFlush(doc);
    return doc.id;
  };

  const daysOf = async (documentId: string): Promise<Array<[string, string]>> => {
    const rows = await orm.em
      .fork()
      .find(BudgetTxn, { document: documentId }, { ...FILTER_OFF, orderBy: { createdAt: 'ASC' } });
    return rows.map((r) => [r.txnType as string, r.txnDate]);
  };

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();

    const em = orm.em.fork();
    const company = em.create(Company, {
      code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', isActive: true,
    });
    // Whatever the entity defaults to; the assertions below have to agree with it, not assume it.
    tz = company.timezone;
    const dept = em.create(Department, { company, deptCode: 'DA', name: 'DA', isActive: true });
    const fy = em.create(FiscalYear, {
      company, year: YEAR, startDate: `${YEAR}-01-01`, endDate: `${YEAR}-12-31`, status: 'OPEN',
    });
    const user = em.create(AppUser, { username: 'u', email: 'u@x', status: 'ACTIVE' });
    const workflow = em.create(Workflow, { company, name: 'WF', isActive: true });

    // The type that records history, and an ordinary one beside it — the second is the control:
    // whatever this change does, that one must keep being dated by the clock.
    const histType = em.create(DocumentType, {
      company, code: 'SPEND_HIST', name: 'history', category: 'FINANCE' as never,
      recordsPastEvents: true,
    });
    const prType = em.create(DocumentType, {
      company, code: 'PR', name: 'PR', category: 'PROCUREMENT' as never,
    });
    const histTemplate = em.create(FormTemplate, { documentType: histType, version: 1, status: 'PUBLISHED' });
    const prTemplate = em.create(FormTemplate, { documentType: prType, version: 1, status: 'PUBLISHED' });

    const doc = (docNo: string, documentType: DocumentType, formTemplate: FormTemplate, moneyMovedOn?: string) =>
      em.create(Document, {
        docNo, company, department: dept, documentType, formTemplate, workflow,
        currentStepNo: 0, createdBy: user, exchangeRate: '1', status: 'DRAFT' as never,
        moneyMovedOn,
      });

    const backdated = doc('SH-2026-0001', histType, histTemplate, IN_MARCH);
    const ordinary = doc('PR-2026-0001', prType, prTemplate);

    await em.flush();
    Object.assign(ids, {
      company: company.id, dept: dept.id, fy: fy.id,
      backdated: backdated.id, ordinary: ordinary.id,
      histType: histType.id, histTemplate: histTemplate.id,
      workflow: workflow.id, user: user.id,
    });

    balance = new BudgetBalanceService(orm.em);
    ledger = new BudgetLedgerService(orm.em, balance, new BudgetCoverageService(orm.em));
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  it('dates the reserve by the day the document states', async () => {
    const budgetId = await makeBudget('1000000');
    await ledger.reserve(ids.backdated, [{ budgetId, baseAmount: '400000' }]);
    expect(await daysOf(ids.backdated)).toEqual([[BudgetTxnType.RESERVE, IN_MARCH]]);
  });

  it('dates the settlement and its release by the same day', async () => {
    const budgetId = await makeBudget('1000000');
    const docId = await makeBackdatedDoc();

    await ledger.reserve(docId, [{ budgetId, baseAmount: '400000' }]);
    // Settled for less than it held: the ACTUAL and the RELEASE of the difference must land in the
    // same quarter as the RESERVE, or one document's money would be split across two of them.
    await ledger.settle(docId, budgetId, '250000');

    const days = await daysOf(docId);
    expect(days).toEqual([
      [BudgetTxnType.RESERVE, IN_MARCH],
      [BudgetTxnType.ACTUAL, IN_MARCH],
      [BudgetTxnType.RELEASE, IN_MARCH],
    ]);
  });

  it('dates an ordinary document by the clock, as it always has', async () => {
    const budgetId = await makeBudget('1000000');
    await ledger.reserve(ids.ordinary, [{ budgetId, baseAmount: '100000' }]);

    // The company's day, not UTC's: `reserve` stamps `txn_date` through `companyDayFor`, which
    // resolves the instant in the company's timezone. Reading it in UTC here made this assertion
    // fail for the seven hours a day the two zones disagree — a control test with a clock in it.
    const today = localDateIn(new Date(), tz);
    const days = await daysOf(ids.ordinary);
    expect(days).toHaveLength(1);
    expect(days[0][0]).toBe(BudgetTxnType.RESERVE);
    // Not asserted equal to IN_MARCH by accident: the control is that it reads as today.
    expect(days[0][1]).toBe(today);
  });

  it('does not let a stated day change what the balance says', async () => {
    // A day says WHEN money moved, not how much there was. The balance after a backdated reserve is
    // the same balance the same reserve would leave undated.
    const budgetId = await makeBudget('1000000');
    await ledger.reserve(ids.backdated, [{ budgetId, baseAmount: '300000' }]);
    expect(await balance.availableBalance(budgetId)).toBe('700000');
  });

  it('releases a rejected backdated document into the quarter it took from', async () => {
    const budgetId = await makeBudget('1000000');
    const docId = await makeBackdatedDoc();

    await ledger.reserve(docId, [{ budgetId, baseAmount: '500000' }]);
    await ledger.releaseAll(docId);

    expect(await daysOf(docId)).toEqual([
      [BudgetTxnType.RESERVE, IN_MARCH],
      [BudgetTxnType.RELEASE, IN_MARCH],
    ]);
    expect(await balance.availableBalance(budgetId)).toBe('1000000');
  });
});
