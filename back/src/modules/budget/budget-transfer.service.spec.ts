import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { attachCoverage } from '../../test/budget-fixture';
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
import { BudgetCoverageService } from './budget-coverage.service';
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
    // Document-type ids for post_action resolution / selection tests.
    inactiveTransferA: '', wrongActionA: '',
    // Company D configures TWO active transfer types → a transfer there is ambiguous.
    companyD: '', deptD: '', fyD: '', budgetD1: '', budgetD2: '', transfer1D: '', transfer2D: '',
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

    // Company A: one active TRANSFER type, mapped to deptA. Code is deliberately NOT the seeded
    // BUDGET_TRANSFER — resolution is by post_action, not code.
    const dt = em.create(DocumentType, { company: companyA,
      code: 'XFER_A', name: 'XFER_A', category: 'FINANCE' as any,
      requiresBudget: false, requiresQuota: false, requiresVendor: false, requiresItem: false,
      isActive: true, postAction: 'TRANSFER',
    });
    const tmpl = em.create(FormTemplate, { documentType: dt, version: 1, status: 'PUBLISHED' });
    em.create(DeptDocType, { department: deptA, documentType: dt, formTemplate: tmpl, workflow, isActive: true });
    // An INACTIVE transfer type (never a candidate) and a wrong-post_action type — both used to
    // test that an invalid documentTypeId is rejected. Neither affects TRANSFER resolution.
    const inactiveTransferA = em.create(DocumentType, { company: companyA,
      code: 'XFER_A_OFF', name: 'off', category: 'FINANCE' as any,
      requiresBudget: false, requiresQuota: false, requiresVendor: false, requiresItem: false,
      isActive: false, postAction: 'TRANSFER',
    });
    const wrongActionA = em.create(DocumentType, { company: companyA,
      code: 'ADJ_INC_A', name: 'inc', category: 'FINANCE' as any,
      requiresBudget: false, requiresQuota: false, requiresVendor: false, requiresItem: false,
      isActive: true, postAction: 'ADJUST_INCREASE',
    });

    // Company D: TWO active transfer types → a transfer there is ambiguous without a chosen id.
    const companyD = em.create(Company, { code: 'D', nameTh: 'D', taxId: '4', branchCode: '00000', isActive: true });
    const deptD = em.create(Department, { company: companyD, deptCode: 'DD', name: 'DD', isActive: true });
    const fyD = em.create(FiscalYear, { company: companyD, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const workflowD = em.create(Workflow, { company: companyD, name: 'WFD', isActive: true });
    const xferTypesD: DocumentType[] = [];
    for (const code of ['XFER_D1', 'XFER_D2'] as const) {
      const dtd = em.create(DocumentType, { company: companyD,
        code, name: code, category: 'FINANCE' as any,
        requiresBudget: false, requiresQuota: false, requiresVendor: false, requiresItem: false,
        isActive: true, postAction: 'TRANSFER',
      });
      xferTypesD.push(dtd);
      const tmpld = em.create(FormTemplate, { documentType: dtd, version: 1, status: 'PUBLISHED' });
      em.create(DeptDocType, { department: deptD, documentType: dtd, formTemplate: tmpld, workflow: workflowD, isActive: true });
    }

    const mk = (fy: FiscalYear, dept: Department, gl: string, total: string, company: Company) => {
      const b = em.create(Budget, { fiscalYear: fy, department: dept, glAccount: gl, amountTotal: total, controlPolicy: ControlPolicy.HARD_STOP, status: 'ACTIVE' });
      attachCoverage(em, company, b);
      return b;
    };

    const budgetX = mk(fyA, deptA, 'GL-X', '100000', companyA);
    const budgetY = mk(fyA, deptA, 'GL-Y', '0', companyA);
    const budgetNoMap = mk(fyA, deptNoMap, 'GL-N', '100000', companyA);
    const budgetYear2 = mk(fyA2, deptA, 'GL-2', '100000', companyA);
    const budgetB = mk(fyB, deptB, 'GL-B', '100000', companyB);
    const budgetD1 = mk(fyD, deptD, 'GL-D1', '100000', companyD);
    const budgetD2 = mk(fyD, deptD, 'GL-D2', '0', companyD);

    await em.flush();
    Object.assign(ids, {
      companyA: companyA.id, deptA: deptA.id, deptNoMap: deptNoMap.id, fyA: fyA.id, fyA2: fyA2.id, userId: user.id,
      companyB: companyB.id, deptB: deptB.id, fyB: fyB.id,
      budgetX: budgetX.id, budgetY: budgetY.id, budgetNoMap: budgetNoMap.id, budgetYear2: budgetYear2.id, budgetB: budgetB.id,
      inactiveTransferA: inactiveTransferA.id, wrongActionA: wrongActionA.id,
      companyD: companyD.id, deptD: deptD.id, fyD: fyD.id, budgetD1: budgetD1.id, budgetD2: budgetD2.id,
      transfer1D: xferTypesD[0].id, transfer2D: xferTypesD[1].id,
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
    const ledger = new BudgetLedgerService(orm.em, balance, new BudgetCoverageService(orm.em));
    transfer = new BudgetTransferService(orm.em, new BudgetService(orm.em, new AccountService(orm.em, new CompanyScopeService(orm.em)), new BudgetBalanceService(orm.em)), new DeptDocTypeService(orm.em), new NumberingService(orm.em));
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

  // ---- Resolution by post_action / selection ---------------------------------

  it('resolves the transfer type by post_action even when its code is not BUDGET_TRANSFER', async () => {
    // Company A's transfer type has code XFER_A but post_action TRANSFER — intake still succeeds.
    const { documentId } = await asCtx(ids.companyA, ids.deptA, ids.userId, () =>
      transfer.create({ fromBudgetId: ids.budgetX, toBudgetId: ids.budgetY, amount: '10', reason: 'code-independent' }),
    );
    expect(documentId).toBeTruthy();
  });

  it('rejects an ambiguous transfer (two active types) with no documentTypeId', async () => {
    await expect(
      asCtx(ids.companyD, ids.deptD, ids.userId, () =>
        transfer.create({ fromBudgetId: ids.budgetD1, toBudgetId: ids.budgetD2, amount: '10', reason: 'which type?' }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('creates using the chosen documentTypeId when several transfer types match', async () => {
    const { documentId } = await asCtx(ids.companyD, ids.deptD, ids.userId, () =>
      transfer.create({ fromBudgetId: ids.budgetD1, toBudgetId: ids.budgetD2, amount: '10', reason: 'chosen', documentTypeId: ids.transfer2D }),
    );
    const em = orm.em.fork();
    const doc = await em.findOneOrFail(Document, { id: documentId }, { ...FILTER_OFF, populate: ['documentType'] });
    expect(doc.documentType.id).toBe(ids.transfer2D);
  });

  it('rejects an inactive documentTypeId (not a candidate)', async () => {
    await expect(
      asCtx(ids.companyA, ids.deptA, ids.userId, () =>
        transfer.create({ fromBudgetId: ids.budgetX, toBudgetId: ids.budgetY, amount: '10', reason: 'x', documentTypeId: ids.inactiveTransferA }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a documentTypeId whose post_action is not TRANSFER', async () => {
    await expect(
      asCtx(ids.companyA, ids.deptA, ids.userId, () =>
        transfer.create({ fromBudgetId: ids.budgetX, toBudgetId: ids.budgetY, amount: '10', reason: 'x', documentTypeId: ids.wrongActionA }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a documentTypeId from another company', async () => {
    await expect(
      asCtx(ids.companyA, ids.deptA, ids.userId, () =>
        transfer.create({ fromBudgetId: ids.budgetX, toBudgetId: ids.budgetY, amount: '10', reason: 'x', documentTypeId: ids.transfer1D }),
      ),
    ).rejects.toThrow(BadRequestException);
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[budget-transfer] no database reachable — skipping DB-backed spec');
}
