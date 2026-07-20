import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Currency } from '../currency/currency.entities';
import { DeptDocType, Document, DocumentType, FormTemplate } from '../document/document.entities';
import { Workflow } from '../approval/approval.entities';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { AppUser, Employee } from '../rbac/rbac.entities';
import {seedDatabase, SEED_COMPANY_CODE } from '../../seed/seed-data';
import { QuotaBalanceService } from './quota-balance.service';
import { QuotaService } from './quota.service';
import { Quota, QuotaUsage } from './quota.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

describe.skipIf(!hasDb)('quota reads: breakdown, usage, company scope (DB-backed)', () => {
  let orm: MikroORM;
  let balance: QuotaBalanceService;
  let quotas: QuotaService;
  let companyA = '';
  let quotaId = '';
  let empId = '';
  let quotaBId = '';

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());

    balance = new QuotaBalanceService(orm.em);
    quotas = new QuotaService(new CompanyScopeService(orm.em));

    const em = orm.em.fork();
    companyA = (await em.findOneOrFail(Company, { code: SEED_COMPANY_CODE }, FILTER_OFF)).id;
    quotaId = (await em.findOneOrFail(Quota, { quotaType: 'ANNUAL_LEAVE' }, FILTER_OFF)).id;
    empId = (await em.findOneOrFail(Employee, { empCode: 'EMP-REQ' }, FILTER_OFF)).id;

    // A LEAVE document + a USE of 2 days against the requester's entitlement.
    const dept = await em.findOneOrFail(Department, { company: companyA, deptCode: 'PROC' }, FILTER_OFF);
    const leave = await em.findOneOrFail(DocumentType, { code: 'LEAVE' }, FILTER_OFF);
    const mapping = await em.findOneOrFail(DeptDocType, { department: dept.id, documentType: leave.id }, { populate: ['formTemplate', 'workflow'], ...FILTER_OFF });
    const requester = await em.findOneOrFail(AppUser, { username: 'requester' }, FILTER_OFF);
    const doc = em.create(Document, {
      docNo: 'LV-1', company: em.getReference(Company, companyA), department: dept,
      documentType: leave, formTemplate: em.getReference(FormTemplate, mapping.formTemplate.id),
      workflow: em.getReference(Workflow, mapping.workflow.id), createdBy: requester,
      status: DocStatus.IN_APPROVAL, currentStepNo: 1, createdAt: new Date(),
    });
    await em.flush();
    // Stamp the USE into the requester's entitlement period (YEARLY → current year, index 1).
    em.create(QuotaUsage, { quota: em.getReference(Quota, quotaId), document: doc, employee: em.getReference(Employee, empId), qtyUsed: '2', usageType: 'USE', periodYear: new Date().getUTCFullYear(), periodIndex: 1, createdAt: new Date() });
    await em.flush();

    // A second company with its own quota — must not be readable from company A.
    const compB = em.create(Company, { code: 'DEMO2', nameTh: 'บีโค', nameEn: 'B Co', taxId: '1', branchCode: '00000', baseCurrency: em.getReference(Currency, 'THB'), isActive: true, createdAt: new Date() });
    const quotaB = em.create(Quota, { company: compB, quotaType: 'ANNUAL_LEAVE', unit: 'day', limitValue: '0', resetCycle: 'YEARLY', isActive: true });
    await em.flush();
    quotaBId = quotaB.id;
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  const asA = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId: 'u', companyId: companyA, departmentId: '', grants: [] }, fn);

  it('breakdown shows the entitlement reduced by usage', async () => {
    const b = await asA(() => balance.breakdown(quotaId));
    const ent = b.entitlements.find((e) => e.employeeId === empId)!;
    expect(Number(ent.entitled)).toBe(12);
    expect(Number(ent.used)).toBe(2);
    expect(Number(ent.remaining)).toBe(10);
  });

  it('usage ledger returns the entry with employee and document', async () => {
    const rows = (await asA(() => balance.usageLedger(quotaId))).items;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].usageType).toBe('USE');
    expect(Number(rows[0].qtyUsed)).toBe(2);
    expect(rows[0].documentNo).toBe('LV-1');
    expect(rows[0].employeeName).toBe('Demo Requester');
  });

  it('does not read another company\'s quota (scoped get)', async () => {
    await expect(asA(() => quotas.get(quotaBId))).rejects.toThrow();
  });
});
