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
import { BudgetBalanceService } from './budget-balance.service';
import { BudgetLedgerService } from './budget-ledger.service';
import { BudgetService } from './budget.service';
import { AccountService } from '../accounting/account.service';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { BudgetTransferService } from './budget-transfer.service';
import { Budget, BudgetMovement, BudgetTxn } from './budget.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const FILTER_OFF = { filters: { company: false } } as const;
const hasDb = await dbAvailable();

function asCtx<T>(companyId: string, departmentId: string, userId: string, fn: () => Promise<T>): Promise<T> {
  return RequestContext.run({ userId, companyId, departmentId, grants: [] }, fn);
}

describe.skipIf(!hasDb)('budget-transfer (DB-backed)', () => {
  let orm: MikroORM;
  let transfer: BudgetTransferService;
  let balance: BudgetBalanceService;
  let postAction: PostActionService;

  const ids = {
    companyA: '', deptA: '', deptNoMap: '', fyA: '', fyA2: '', userId: '',
    companyB: '', deptB: '', fyB: '',
    budgetX: '', budgetY: '', budgetNoMap: '', budgetYear2: '', budgetB: '',
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
    const fyA2 = em.create(FiscalYear, { company: companyA, year: 2027, startDate: '2027-01-01', endDate: '2027-12-31', status: 'OPEN' });
    const fyB = em.create(FiscalYear, { company: companyB, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const user = em.create(AppUser, { username: 'u', email: 'u@x', status: 'ACTIVE' });
    const workflow = em.create(Workflow, { company: companyA, name: 'WF', isActive: true });

    // Transfer document type (post_action TRANSFER), mapped to deptA only.
    const dt = em.create(DocumentType, { company: companyA,
      code: 'BUDGET_TRANSFER', name: 'BUDGET_TRANSFER', category: 'FINANCE' as any,
      requiresBudget: false, requiresQuota: false, isActive: true, postAction: 'TRANSFER',
    });
    const tmpl = em.create(FormTemplate, { documentType: dt, version: 1, status: 'PUBLISHED' });
    em.create(DeptDocType, { department: deptA, documentType: dt, formTemplate: tmpl, workflow, isActive: true });

    const mk = (fy: FiscalYear, dept: Department, gl: string, total: string) =>
      em.create(Budget, { fiscalYear: fy, department: dept, glAccount: gl, amountTotal: total, controlPolicy: ControlPolicy.HARD_STOP, status: 'ACTIVE' });

    const budgetX = mk(fyA, deptA, 'GL-X', '100000');
    const budgetY = mk(fyA, deptA, 'GL-Y', '0');
    const budgetNoMap = mk(fyA, deptNoMap, 'GL-N', '100000');
    const budgetYear2 = mk(fyA2, deptA, 'GL-2', '100000');
    const budgetB = mk(fyB, deptB, 'GL-B', '100000');

    await em.flush();
    Object.assign(ids, {
      companyA: companyA.id, deptA: deptA.id, deptNoMap: deptNoMap.id, fyA: fyA.id, fyA2: fyA2.id, userId: user.id,
      companyB: companyB.id, deptB: deptB.id, fyB: fyB.id,
      budgetX: budgetX.id, budgetY: budgetY.id, budgetNoMap: budgetNoMap.id, budgetYear2: budgetYear2.id, budgetB: budgetB.id,
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
    transfer = new BudgetTransferService(orm.em, new BudgetService(orm.em, new AccountService(orm.em, new CompanyScopeService(orm.em))), new DeptDocTypeService(orm.em), new NumberingService(orm.em));
    postAction = new PostActionService(ledger, orm.em);
  });

  const txnsFor = (documentId: string) =>
    orm.em.fork().find(BudgetTxn, { document: documentId }, FILTER_OFF);

  // ---- Intake: document + movement, but NO ledger write yet -------------------

  it('creates an approvable document + movement and writes no budget_txn', async () => {
    const { documentId } = await asCtx(ids.companyA, ids.deptA, ids.userId, () =>
      transfer.create({ fromBudgetId: ids.budgetX, toBudgetId: ids.budgetY, amount: '40000', reason: 'reallocate' }),
    );
    const em = orm.em.fork();
    const doc = await em.findOneOrFail(Document, { id: documentId }, FILTER_OFF);
    const movement = await em.findOneOrFail(BudgetMovement, { document: documentId }, { ...FILTER_OFF, populate: ['fromBudget', 'toBudget'] });

    expect(doc.status).toBe('DRAFT');
    expect(movement.movementType).toBe('TRANSFER');
    expect(movement.fromBudget?.id).toBe(ids.budgetX);
    expect(movement.toBudget?.id).toBe(ids.budgetY);
    expect(Number(movement.amount)).toBe(40000);
    expect(movement.reason).toBe('reallocate');
    // No ledger write on intake; both balances unchanged.
    expect(await txnsFor(documentId)).toHaveLength(0);
    expect(Number(await balance.availableBalance(ids.budgetX))).toBe(100000);
    expect(Number(await balance.availableBalance(ids.budgetY))).toBe(0);
  });

  // ---- Post-action on full approval writes the paired TRANSFER_OUT/IN ---------

  it('writes paired TRANSFER_OUT/TRANSFER_IN on approval and moves the balance', async () => {
    const { documentId } = await asCtx(ids.companyA, ids.deptA, ids.userId, () =>
      transfer.create({ fromBudgetId: ids.budgetX, toBudgetId: ids.budgetY, amount: '30000', reason: 'move' }),
    );
    const em = orm.em.fork();
    await em.transactional(async (tem) => {
      const doc = await tem.findOneOrFail(Document, { id: documentId }, FILTER_OFF);
      await postAction.run(doc, tem);
    });
    const txns = await txnsFor(documentId);
    expect(txns.filter((t) => t.txnType === BudgetTxnType.TRANSFER_OUT)).toHaveLength(1);
    expect(txns.filter((t) => t.txnType === BudgetTxnType.TRANSFER_IN)).toHaveLength(1);
    expect(Number(await balance.availableBalance(ids.budgetX))).toBe(70000);
    expect(Number(await balance.availableBalance(ids.budgetY))).toBe(30000);
  });

  // ---- Guards (reject before creating anything) ------------------------------

  it('rejects a same-budget transfer', async () => {
    await expect(
      asCtx(ids.companyA, ids.deptA, ids.userId, () =>
        transfer.create({ fromBudgetId: ids.budgetX, toBudgetId: ids.budgetX, amount: '10', reason: 'x' }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a non-positive amount', async () => {
    await expect(
      asCtx(ids.companyA, ids.deptA, ids.userId, () =>
        transfer.create({ fromBudgetId: ids.budgetX, toBudgetId: ids.budgetY, amount: '0', reason: 'x' }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a cross-company transfer (destination not found in active company)', async () => {
    await expect(
      asCtx(ids.companyA, ids.deptA, ids.userId, () =>
        transfer.create({ fromBudgetId: ids.budgetX, toBudgetId: ids.budgetB, amount: '10', reason: 'x' }),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects a cross-fiscal-year transfer', async () => {
    await expect(
      asCtx(ids.companyA, ids.deptA, ids.userId, () =>
        transfer.create({ fromBudgetId: ids.budgetX, toBudgetId: ids.budgetYear2, amount: '10', reason: 'x' }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects when the source budget department has no transfer type mapped', async () => {
    await expect(
      asCtx(ids.companyA, ids.deptNoMap, ids.userId, () =>
        transfer.create({ fromBudgetId: ids.budgetNoMap, toBudgetId: ids.budgetX, amount: '10', reason: 'x' }),
      ),
    ).rejects.toThrow(BadRequestException);
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[budget-transfer] no database reachable — skipping DB-backed spec');
}
