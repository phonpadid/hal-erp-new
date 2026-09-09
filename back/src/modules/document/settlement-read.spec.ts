import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { DocCategory, DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { AccountService } from '../accounting/account.service';
import { Workflow } from '../approval/approval.entities';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { BudgetService } from '../budget/budget.service';
import { Currency } from '../currency/currency.entities';
import { ItemService } from '../master-data/item.service';
import {
  Company,
  Department,
  FiscalYear,
} from '../multi-company/multi-company.entities';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { Payment } from '../payment-handoff/payment.entities';
import { AppUser } from '../rbac/rbac.entities';
import { ScopeService } from '../rbac/scope.service';
import { DeptDocTypeService } from './dept-doc-type.service';
import {
  DeptDocType,
  Document,
  DocumentType,
  FormTemplate,
} from './document.entities';
import { DocumentService } from './document.service';
import { NumberingService } from './numbering.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();

/**
 * "Approved" and "paid" are days apart, and an integrator outside the ERP can only tell them
 * apart by asking. `document_settlement` was absorbed into `payment` — method, reference and
 * note became columns there — and the read has to survive that move, because a caller polls
 * `GET /documents/<id>` for COMPLETED and asks this once it reads so.
 *
 * Pinned here rather than left to the claim integration's own suite: the contract is ours, the
 * table it reads is no longer the one it was written against, and a 404 is a documented ANSWER
 * (not yet paid) — so a regression that stopped answering would look, to every caller, exactly
 * like a claim finance had not got to.
 */
describe.skipIf(!hasDb)('document settlement read (DB-backed)', () => {
  let orm: MikroORM;
  let documents: DocumentService;
  const ids = {
    company: '',
    dept: '',
    docType: '',
    user: '',
    tmpl: '',
    wf: '',
    other: '',
    otherDept: '',
  };

  /** A COMPLETED document — approved, and by itself saying nothing about whether it was paid. */
  async function completedDoc(
    companyId: string,
    deptId: string,
    docNo: string,
  ): Promise<string> {
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo,
      company: em.getReference(Company, companyId),
      department: em.getReference(Department, deptId),
      documentType: em.getReference(DocumentType, ids.docType),
      formTemplate: em.getReference(FormTemplate, ids.tmpl),
      workflow: em.getReference(Workflow, ids.wf),
      createdBy: em.getReference(AppUser, ids.user),
      exchangeRate: '1',
      totalAmount: '700000.00',
      baseTotalAmount: '700000.00',
      status: DocStatus.COMPLETED,
      createdAt: new Date(),
    });
    await em.flush();
    return doc.id;
  }

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();

    const em = orm.em.fork();
    const lak = em.create(Currency, {
      code: 'LAK',
      name: 'Kip',
      decimalPlaces: 0,
      isActive: true,
    });
    // Vientiane, deliberately: a payment recorded late in the UTC day belongs to the company's
    // NEXT day, which is the whole reason the date is rendered in the company's zone.
    const company = em.create(Company, {
      code: 'A',
      nameTh: 'A',
      taxId: '1',
      branchCode: '00000',
      baseCurrency: lak,
      timezone: 'Asia/Vientiane',
      isActive: true,
    });
    const other = em.create(Company, {
      code: 'B',
      nameTh: 'B',
      taxId: '2',
      branchCode: '00000',
      baseCurrency: lak,
      timezone: 'Asia/Vientiane',
      isActive: true,
    });
    const dept = em.create(Department, {
      company,
      deptCode: 'DA',
      name: 'DA',
      isActive: true,
    });
    const otherDept = em.create(Department, {
      company: other,
      deptCode: 'DB',
      name: 'DB',
      isActive: true,
    });
    const y = new Date().getUTCFullYear();
    em.create(FiscalYear, {
      company,
      year: y,
      startDate: `${y}-01-01`,
      endDate: `${y}-12-31`,
      status: 'OPEN',
    });
    const wf = em.create(Workflow, { company, name: 'WF', isActive: true });
    const user = em.create(AppUser, {
      username: 'raiser',
      email: 'raiser@x',
      status: 'ACTIVE',
    });
    const docType = em.create(DocumentType, {
      company,
      code: 'CLAIM',
      name: 'Claim',
      category: DocCategory.FINANCE,
      requiresBudget: false,
      requiresQuota: false,
      isActive: true,
    });
    const tmpl = em.create(FormTemplate, {
      documentType: docType,
      version: 1,
      status: 'PUBLISHED',
    });
    em.create(DeptDocType, {
      department: dept,
      documentType: docType,
      formTemplate: tmpl,
      workflow: wf,
      isActive: true,
    });

    await em.flush();
    Object.assign(ids, {
      company: company.id,
      dept: dept.id,
      docType: docType.id,
      user: user.id,
      tmpl: tmpl.id,
      wf: wf.id,
      other: other.id,
      otherDept: otherDept.id,
    });
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  beforeEach(() => {
    const scope = new CompanyScopeService(orm.em);
    const accounts = new AccountService(orm.em, scope);
    documents = new DocumentService(
      orm.em,
      scope,
      new DeptDocTypeService(orm.em),
      new NumberingService(orm.em),
      new ItemService(orm.em, scope, new ScopeService(), accounts),
      new BudgetService(orm.em, accounts, new BudgetBalanceService(orm.em)),
      new FiscalYearService(scope),
    );
  });

  const asCaller = <T>(
    fn: () => Promise<T>,
    companyId = ids.company,
    deptId = ids.dept,
  ) =>
    RequestContext.run(
      { userId: ids.user, companyId, departmentId: deptId, grants: [] },
      fn,
    );

  it('is not-found while the document is approved and unpaid — the normal answer, not an error', async () => {
    const id = await completedDoc(ids.company, ids.dept, 'CLAIM-1');

    await expect(
      asCaller(() => documents.settlement(id)),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('answers with the method, the company-local day and the reference once a payment exists', async () => {
    const id = await completedDoc(ids.company, ids.dept, 'CLAIM-2');
    const em = orm.em.fork();
    em.create(Payment, {
      company: em.getReference(Company, ids.company),
      document: em.getReference(Document, id),
      lockedRate: '1',
      actualRate: '1',
      baseLocked: '700000.00',
      baseActual: '700000.00',
      fxDelta: '0.00',
      fxKind: 'NONE',
      method: 'CASH',
      reference: 'TXN-9001',
      // 22:30 UTC is already the next day in Vientiane (UTC+7): the answer must be the company's
      // day, or a claim paid on the 8th is reported to the customer as the 7th.
      paidAt: new Date('2026-09-07T22:30:00Z'),
      createdAt: new Date(),
    });
    await em.flush();

    await expect(asCaller(() => documents.settlement(id))).resolves.toEqual({
      settlementType: 'CASH',
      settledAt: '2026-09-08',
      reference: 'TXN-9001',
    });
  });

  it('carries no reference when the payment was recorded without one', async () => {
    const id = await completedDoc(ids.company, ids.dept, 'CLAIM-3');
    const em = orm.em.fork();
    em.create(Payment, {
      company: em.getReference(Company, ids.company),
      document: em.getReference(Document, id),
      lockedRate: '1',
      actualRate: '1',
      baseLocked: '700000.00',
      baseActual: '700000.00',
      fxDelta: '0.00',
      fxKind: 'NONE',
      method: 'TRANSFER',
      paidAt: new Date('2026-09-08T03:00:00Z'),
      createdAt: new Date(),
    });
    await em.flush();

    const settlement = await asCaller(() => documents.settlement(id));
    expect(settlement).toEqual({
      settlementType: 'TRANSFER',
      settledAt: '2026-09-08',
      reference: null,
    });
  });

  it('does not answer for another company — a paid document is not-found across the boundary', async () => {
    const id = await completedDoc(ids.other, ids.otherDept, 'CLAIM-4');
    const em = orm.em.fork();
    em.create(Payment, {
      company: em.getReference(Company, ids.other),
      document: em.getReference(Document, id),
      lockedRate: '1',
      actualRate: '1',
      baseLocked: '1.00',
      baseActual: '1.00',
      fxDelta: '0.00',
      fxKind: 'NONE',
      method: 'CASH',
      reference: 'THEIRS',
      paidAt: new Date('2026-09-08T03:00:00Z'),
      createdAt: new Date(),
    });
    await em.flush();

    // Asked as company A about company B's document: 404, and never their reference.
    await expect(
      asCaller(() => documents.settlement(id)),
    ).rejects.toMatchObject({ status: 404 });
  });
});
