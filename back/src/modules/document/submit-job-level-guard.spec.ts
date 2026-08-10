import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { attachCoverage } from '../../test/budget-fixture';
import { BadRequestException } from '@nestjs/common';
import { isLevelGated, parseStepJobLevels } from '@erp/shared';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { AccountService } from '../accounting/account.service';
import { ControlPolicy, DocCategory, DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { BudgetLedgerService } from '../budget/budget-ledger.service';
import { BudgetCoverageService } from '../budget/budget-coverage.service';
import { Budget, BudgetTxn } from '../budget/budget.entities';
import { Currency } from '../currency/currency.entities';
import { ExchangeRateService } from '../currency/exchange-rate.service';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { ItemService } from '../master-data/item.service';
import { VendorService } from '../master-data/vendor.service';
import { ScopeService } from '../rbac/scope.service';
import { QuotaBalanceService } from '../quota/quota-balance.service';
import { QuotaUsageService } from '../quota/quota-usage.service';
import { Workflow, WorkflowStep } from '../approval/approval.entities';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { AppUser, Employee } from '../rbac/rbac.entities';
import { DocumentSubmitService } from './document-submit.service';
import { Document, DocumentLine, DocumentType, FormTemplate } from './document.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

// --- Pure-logic tests (no DB) — the shared parser/gate is the single source of truth ---------
describe('level-gate helpers (@erp/shared)', () => {
  it('parses jobLevels; tolerates blank/malformed/legacy as unrestricted', () => {
    expect(parseStepJobLevels(JSON.stringify({ jobLevels: ['MANAGER', 'DIRECTOR'] }))).toEqual(['MANAGER', 'DIRECTOR']);
    expect(parseStepJobLevels(undefined)).toEqual([]);
    expect(parseStepJobLevels('')).toEqual([]);
    expect(parseStepJobLevels('{not json')).toEqual([]);
    expect(parseStepJobLevels(JSON.stringify({ jobLevels: [] }))).toEqual([]);
    expect(parseStepJobLevels(JSON.stringify({ other: 1 }))).toEqual([]);
  });

  it('isLevelGated is true only when some step carries a non-empty jobLevels restriction', () => {
    expect(isLevelGated([{ conditionJson: undefined }, { conditionJson: JSON.stringify({ jobLevels: [] }) }])).toBe(false);
    expect(isLevelGated([{ conditionJson: undefined }, { conditionJson: JSON.stringify({ jobLevels: ['MANAGER'] }) }])).toBe(true);
    expect(isLevelGated([])).toBe(false);
  });
});

// --- Submit guard (DB-backed) ----------------------------------------------------------------
describe.skipIf(!hasDb)('submit job-level guard (DB-backed)', () => {
  let orm: MikroORM;
  let submit: DocumentSubmitService;
  const ids = {
    company: '', dept: '', prType: '', prTmpl: '', budget: '',
    wfGated: '', wfPlain: '',
    uNoEmp: '', uNoLevel: '', uMgr: '',
  };
  let seq = 0;

  const asCtx = <T>(userId: string, fn: () => Promise<T>): Promise<T> =>
    RequestContext.run({ userId, companyId: ids.company, departmentId: ids.dept, grants: [] }, fn);
  const reload = (id: string) => orm.em.fork().findOneOrFail(Document, { id }, FILTER_OFF);
  const txnCount = (documentId: string) => orm.em.fork().count(BudgetTxn, { document: documentId }, FILTER_OFF);

  /** A DRAFT budgeted PR bound to a workflow, created by a given user. */
  async function draftDoc(workflowId: string, createdBy: string): Promise<string> {
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `G-${seq++}`,
      company: em.getReference(Company, ids.company),
      department: em.getReference(Department, ids.dept),
      documentType: em.getReference(DocumentType, ids.prType),
      formTemplate: em.getReference(FormTemplate, ids.prTmpl),
      workflow: em.getReference(Workflow, workflowId),
      createdBy: em.getReference(AppUser, createdBy),
      totalAmount: '100',
      status: DocStatus.DRAFT,
      createdAt: new Date(),
    });
    em.create(DocumentLine, {
      document: doc, lineNo: 1, description: 'X', qty: '1', unitPrice: '100', lineAmount: '100',
      budget: em.getReference(Budget, ids.budget),
    });
    await em.flush();
    return doc.id;
  }

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const company = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true });
    const dept = em.create(Department, { company, deptCode: 'DA', name: 'DA', isActive: true });
    const fy = em.create(FiscalYear, { company, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const prType = em.create(DocumentType, { company: company, code: 'PR', name: 'PR', category: DocCategory.PROCUREMENT, requiresBudget: true, requiresQuota: false, requiresVendor: false, postAction: 'CUT_BUDGET', isActive: true });
    const prTmpl = em.create(FormTemplate, { documentType: prType, version: 1, status: 'PUBLISHED' });
    const budget = em.create(Budget, { fiscalYear: fy, department: dept, glAccount: 'GL1', amountTotal: '1000000', controlPolicy: ControlPolicy.HARD_STOP, status: 'ACTIVE' });
    attachCoverage(em, company, budget);

    const ua = em.create(AppUser, { username: 'ua', email: 'ua@x', status: 'ACTIVE' });
    // Level-gated workflow: step 2 engages only for MANAGER requesters.
    const wfGated = em.create(Workflow, { company, name: 'WF-GATED', isActive: true });
    em.create(WorkflowStep, { workflow: wfGated, stepNo: 1, approverUser: ua, approveMode: 'SEQUENTIAL' });
    em.create(WorkflowStep, { workflow: wfGated, stepNo: 2, approverUser: ua, approveMode: 'SEQUENTIAL', conditionJson: JSON.stringify({ jobLevels: ['MANAGER'] }) });
    // Plain workflow: no step restricts job level.
    const wfPlain = em.create(Workflow, { company, name: 'WF-PLAIN', isActive: true });
    em.create(WorkflowStep, { workflow: wfPlain, stepNo: 1, approverUser: ua, approveMode: 'SEQUENTIAL' });

    // Three requesters: no employee at all; an employee with no job level; a MANAGER.
    const uNoEmp = em.create(AppUser, { username: 'no-emp', email: 'noemp@x', status: 'ACTIVE' });
    const uNoLevel = em.create(AppUser, { username: 'no-level', email: 'nolevel@x', status: 'ACTIVE' });
    const uMgr = em.create(AppUser, { username: 'mgr', email: 'mgr@x', status: 'ACTIVE' });
    em.create(Employee, { company, department: dept, user: uNoLevel, empCode: 'E-NL', fullName: 'No Level', status: 'ACTIVE' });
    em.create(Employee, { company, department: dept, user: uMgr, empCode: 'E-MG', fullName: 'Manager', jobLevel: 'MANAGER', status: 'ACTIVE' });

    await em.flush();
    Object.assign(ids, {
      company: company.id, dept: dept.id, prType: prType.id, prTmpl: prTmpl.id, budget: budget.id,
      wfGated: wfGated.id, wfPlain: wfPlain.id,
      uNoEmp: uNoEmp.id, uNoLevel: uNoLevel.id, uMgr: uMgr.id,
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
    submit = new DocumentSubmitService(
      orm.em,
      new ExchangeRateService(orm.em),
      new FiscalYearService(scope),
      new VendorService(orm.em, scope, new ScopeService()),
      new ItemService(orm.em, scope, new ScopeService(), new AccountService(orm.em, scope)),
      new BudgetLedgerService(orm.em, new BudgetBalanceService(orm.em), new BudgetCoverageService(orm.em)),
      new QuotaUsageService(orm.em, new QuotaBalanceService(orm.em)),
    );
  });

  it('rejects submit into a level-gated workflow when the requester has no linked employee; no holds, stays DRAFT', async () => {
    const id = await draftDoc(ids.wfGated, ids.uNoEmp);
    await expect(asCtx(ids.uNoEmp, () => submit.submit(id))).rejects.toBeInstanceOf(BadRequestException);
    expect((await reload(id)).status).toBe(DocStatus.DRAFT);
    expect(await txnCount(id)).toBe(0); // reserve never fired
  });

  it('rejects submit when the requester has an employee but no job_level', async () => {
    const id = await draftDoc(ids.wfGated, ids.uNoLevel);
    await expect(asCtx(ids.uNoLevel, () => submit.submit(id))).rejects.toBeInstanceOf(BadRequestException);
    expect((await reload(id)).status).toBe(DocStatus.DRAFT);
    expect(await txnCount(id)).toBe(0);
  });

  it('allows submit into a level-gated workflow when the requester has a job_level (reserve fires)', async () => {
    const id = await draftDoc(ids.wfGated, ids.uMgr);
    await asCtx(ids.uMgr, () => submit.submit(id));
    expect((await reload(id)).status).toBe(DocStatus.SUBMITTED);
    expect(await txnCount(id)).toBeGreaterThan(0); // RESERVE recorded
  });

  it('allows submit into a non-level-gated workflow even when the requester has no job_level', async () => {
    const id = await draftDoc(ids.wfPlain, ids.uNoEmp);
    await asCtx(ids.uNoEmp, () => submit.submit(id));
    expect((await reload(id)).status).toBe(DocStatus.SUBMITTED);
  });
});
