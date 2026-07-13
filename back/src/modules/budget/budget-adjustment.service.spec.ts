import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { BudgetTxnType, ControlPolicy } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { PostActionService } from '../approval/post-action.service';
import { DeptDocTypeService } from '../document/dept-doc-type.service';
import { NumberingService } from '../document/numbering.service';
import {
  DeptDocType,
  Document,
  DocumentType,
  FormTemplate,
} from '../document/document.entities';
import { Workflow } from '../approval/approval.entities';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { BudgetAdjustmentService } from './budget-adjustment.service';
import { BudgetBalanceService } from './budget-balance.service';
import { BudgetLedgerService } from './budget-ledger.service';
import { BudgetService } from './budget.service';
import { AccountService } from '../accounting/account.service';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { Budget, BudgetMovement, BudgetTxn } from './budget.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const FILTER_OFF = { filters: { company: false } } as const;
const hasDb = await dbAvailable();

function asCtx<T>(companyId: string, departmentId: string, userId: string, fn: () => Promise<T>): Promise<T> {
  return RequestContext.run({ userId, companyId, departmentId, grants: [] }, fn);
}

describe.skipIf(!hasDb)('budget-adjustment (DB-backed)', () => {
  let orm: MikroORM;
  let adjust: BudgetAdjustmentService;
  let balance: BudgetBalanceService;
  let postAction: PostActionService;

  const ids = {
    companyA: '', deptA: '', deptNoMap: '', fyA: '', userId: '',
    companyB: '', deptB: '', fyB: '',
    budgetA: '', budgetNoMap: '', budgetB: '',
  };

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();

    const companyA = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', isActive: true });
    const companyB = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', isActive: true });
    const deptA = em.create(Department, { company: companyA, deptCode: 'DA', name: 'DA', isActive: true });
    const deptNoMap = em.create(Department, { company: companyA, deptCode: 'DN', name: 'DN', isActive: true });
    const deptB = em.create(Department, { company: companyB, deptCode: 'DB', name: 'DB', isActive: true });
    const fyA = em.create(FiscalYear, { company: companyA, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const fyB = em.create(FiscalYear, { company: companyB, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const user = em.create(AppUser, { username: 'u', email: 'u@x', status: 'ACTIVE' });
    const workflow = em.create(Workflow, { company: companyA, name: 'WF', isActive: true });

    // Two adjustment document types (direction via post_action), mapped to deptA only.
    for (const [code, postActionType] of [
      ['BUDGET_ADJ_INC', 'ADJUST_INCREASE'],
      ['BUDGET_ADJ_DEC', 'ADJUST_DECREASE'],
    ] as const) {
      const dt = em.create(DocumentType, { company: companyA,
        code, name: code, category: 'FINANCE' as any,
        requiresBudget: false, requiresQuota: false, isActive: true, postAction: postActionType,
      });
      const tmpl = em.create(FormTemplate, { documentType: dt, version: 1, status: 'PUBLISHED' });
      em.create(DeptDocType, { department: deptA, documentType: dt, formTemplate: tmpl, workflow, isActive: true });
    }

    const budgetA = em.create(Budget, { fiscalYear: fyA, department: deptA, glAccount: 'GL-A', amountTotal: '100000', controlPolicy: ControlPolicy.HARD_STOP, status: 'ACTIVE' });
    const budgetNoMap = em.create(Budget, { fiscalYear: fyA, department: deptNoMap, glAccount: 'GL-N', amountTotal: '100000', controlPolicy: ControlPolicy.HARD_STOP, status: 'ACTIVE' });
    const budgetB = em.create(Budget, { fiscalYear: fyB, department: deptB, glAccount: 'GL-B', amountTotal: '100000', controlPolicy: ControlPolicy.HARD_STOP, status: 'ACTIVE' });

    await em.flush();
    Object.assign(ids, {
      companyA: companyA.id, deptA: deptA.id, deptNoMap: deptNoMap.id, fyA: fyA.id, userId: user.id,
      companyB: companyB.id, deptB: deptB.id, fyB: fyB.id,
      budgetA: budgetA.id, budgetNoMap: budgetNoMap.id, budgetB: budgetB.id,
    });
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  beforeEach(() => {
    balance = new BudgetBalanceService(orm.em);
    const ledger = new BudgetLedgerService(orm.em, balance);
    adjust = new BudgetAdjustmentService(orm.em, new BudgetService(orm.em, new AccountService(orm.em, new CompanyScopeService(orm.em))), new DeptDocTypeService(orm.em), new NumberingService(orm.em));
    postAction = new PostActionService(ledger, orm.em);
  });

  const txnsFor = (documentId: string) =>
    orm.em.fork().find(BudgetTxn, { document: documentId }, FILTER_OFF);

  // ---- Creation: document + movement, but NO ledger write yet ----------------

  it('creates an approvable document + movement and writes no budget_txn', async () => {
    const { documentId } = await asCtx(ids.companyA, ids.deptA, ids.userId, () =>
      adjust.create(ids.budgetA, { direction: 'INCREASE', amount: '200000', reason: 'mid-year top up' }),
    );
    const em = orm.em.fork();
    const doc = await em.findOneOrFail(Document, { id: documentId }, FILTER_OFF);
    const movement = await em.findOneOrFail(BudgetMovement, { document: documentId }, { ...FILTER_OFF, populate: ['toBudget'] });

    expect(doc.status).toBe('DRAFT');
    expect(movement.movementType).toBe('ADJUST_INCREASE');
    expect(movement.toBudget?.id).toBe(ids.budgetA);
    expect(Number(movement.amount)).toBe(200000);
    expect(movement.reason).toBe('mid-year top up');
    // No ledger write on creation; balance unchanged.
    expect(await txnsFor(documentId)).toHaveLength(0);
    expect(Number(await balance.availableBalance(ids.budgetA))).toBe(100000);
  });

  // ---- Post-action on full approval writes exactly one ADJUST ----------------

  it('writes a single ADJUST_INCREASE on approval and raises available', async () => {
    const { documentId } = await asCtx(ids.companyA, ids.deptA, ids.userId, () =>
      adjust.create(ids.budgetA, { direction: 'INCREASE', amount: '50000', reason: 'top up' }),
    );
    const em = orm.em.fork();
    await em.transactional(async (tem) => {
      const doc = await tem.findOneOrFail(Document, { id: documentId }, FILTER_OFF);
      await postAction.run(doc, tem);
    });
    const txns = (await txnsFor(documentId)).filter((t) => t.txnType === BudgetTxnType.ADJUST_INCREASE);
    expect(txns).toHaveLength(1);
    expect(Number(txns[0].amount)).toBe(50000);
    expect(Number(await balance.availableBalance(ids.budgetA))).toBe(150000);
  });

  it('writes a single ADJUST_DECREASE on approval and lowers available', async () => {
    const { documentId } = await asCtx(ids.companyA, ids.deptA, ids.userId, () =>
      adjust.create(ids.budgetA, { direction: 'DECREASE', amount: '30000', reason: 'cut' }),
    );
    const before = Number(await balance.availableBalance(ids.budgetA));
    const em = orm.em.fork();
    await em.transactional(async (tem) => {
      const doc = await tem.findOneOrFail(Document, { id: documentId }, FILTER_OFF);
      await postAction.run(doc, tem);
    });
    const txns = (await txnsFor(documentId)).filter((t) => t.txnType === BudgetTxnType.ADJUST_DECREASE);
    expect(txns).toHaveLength(1);
    expect(Number(await balance.availableBalance(ids.budgetA))).toBe(before - 30000);
  });

  // ---- Guards ----------------------------------------------------------------

  it('rejects a budget from another company (not found in active company)', async () => {
    await expect(
      asCtx(ids.companyA, ids.deptA, ids.userId, () =>
        adjust.create(ids.budgetB, { direction: 'INCREASE', amount: '10', reason: 'x' }),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects when the budget department has no adjustment type mapped', async () => {
    await expect(
      asCtx(ids.companyA, ids.deptNoMap, ids.userId, () =>
        adjust.create(ids.budgetNoMap, { direction: 'INCREASE', amount: '10', reason: 'x' }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a non-positive amount', async () => {
    await expect(
      asCtx(ids.companyA, ids.deptA, ids.userId, () =>
        adjust.create(ids.budgetA, { direction: 'INCREASE', amount: '0', reason: 'x' }),
      ),
    ).rejects.toThrow(BadRequestException);
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[budget-adjustment] no database reachable — skipping DB-backed spec');
}
