import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Workflow } from '../approval/approval.entities';
import { Document, DocumentType, FormTemplate } from '../document/document.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { AppUser, Employee } from '../rbac/rbac.entities';
import { QuotaBalanceService } from './quota-balance.service';
import { QuotaEntitlementService } from './quota-entitlement.service';
import { QuotaService } from './quota.service';
import { QuotaUsageService } from './quota-usage.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const YEAR = 2026;

function asCompany<T>(companyId: string, fn: () => Promise<T>): Promise<T> {
  return RequestContext.run({ userId: 'u1', companyId, departmentId: 'd1', grants: [] }, fn);
}

describe.skipIf(!hasDb)('quota-management (DB-backed)', () => {
  let orm: MikroORM;
  let quotas: QuotaService;
  let balance: QuotaBalanceService;
  let entitlements: QuotaEntitlementService;
  let usage: QuotaUsageService;

  const ids = { companyA: '', deptA: '', e1: '', e2: '', docA: '' };
  let qt = 0;

  async function makeQuota(limitValue = '1000'): Promise<string> {
    const q = await asCompany(ids.companyA, () =>
      quotas.create({ quotaType: `T-${qt++}`, unit: 'day', limitValue }),
    );
    return q.id;
  }

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();

    const em = orm.em.fork();
    const companyA = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', isActive: true });
    const deptA = em.create(Department, { company: companyA, deptCode: 'DA', name: 'DA', isActive: true });
    const user = em.create(AppUser, { username: 'u', email: 'u@x', status: 'ACTIVE' });
    const e1 = em.create(Employee, { company: companyA, department: deptA, empCode: 'E1', fullName: 'E One', status: 'ACTIVE' });
    const e2 = em.create(Employee, { company: companyA, department: deptA, empCode: 'E2', fullName: 'E Two', status: 'ACTIVE' });

    const docType = em.create(DocumentType, { code: 'LEAVE', name: 'Leave', category: 'HR' as any });
    const template = em.create(FormTemplate, { documentType: docType, version: 1, status: 'PUBLISHED' });
    const workflow = em.create(Workflow, { company: companyA, name: 'WF', isActive: true });
    const docA = em.create(Document, {
      docNo: 'LV-A-2026-0001', company: companyA, department: deptA, documentType: docType,
      formTemplate: template, workflow, currentStepNo: 0, createdBy: user, exchangeRate: '1', status: 'DRAFT' as any,
    });

    await em.flush();
    Object.assign(ids, { companyA: companyA.id, deptA: deptA.id, e1: e1.id, e2: e2.id, docA: docA.id });
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  beforeEach(() => {
    const scope = new CompanyScopeService(orm.em);
    quotas = new QuotaService(scope);
    balance = new QuotaBalanceService(orm.em);
    entitlements = new QuotaEntitlementService(orm.em, balance);
    usage = new QuotaUsageService(orm.em, balance);
  });

  // ---- 4.1 Personal balance --------------------------------------------------

  it('computes personal balance as entitled + carried + adjusted − usage, per employee', async () => {
    const q = await makeQuota();
    await entitlements.upsert({ quotaId: q, employeeId: ids.e1, year: YEAR, entitledValue: '10', carriedOver: '2', adjusted: '1' });
    await entitlements.upsert({ quotaId: q, employeeId: ids.e2, year: YEAR, entitledValue: '5' });

    expect(Number(await balance.remaining(q, { employeeId: ids.e1, year: YEAR }))).toBe(13);
    expect(Number(await balance.remaining(q, { employeeId: ids.e2, year: YEAR }))).toBe(5);
  });

  // ---- 4.2 Over-quota --------------------------------------------------------

  it('blocks an over-quota reserve and allows a within-balance one', async () => {
    const q = await makeQuota();
    await entitlements.upsert({ quotaId: q, employeeId: ids.e1, year: YEAR, entitledValue: '2' });

    await expect(
      usage.reserve({ documentId: ids.docA, quotaId: q, employeeId: ids.e1, qty: '3', year: YEAR }),
    ).rejects.toThrow();

    await usage.reserve({ documentId: ids.docA, quotaId: q, employeeId: ids.e1, qty: '2', year: YEAR });
    expect(Number(await balance.remaining(q, { employeeId: ids.e1, year: YEAR }))).toBe(0);
  });

  // ---- 4.3 Auto-release ------------------------------------------------------

  it('auto-releases the reserved quantity on reject/cancel', async () => {
    const q = await makeQuota();
    await entitlements.upsert({ quotaId: q, employeeId: ids.e1, year: YEAR, entitledValue: '10' });
    await usage.reserve({ documentId: ids.docA, quotaId: q, employeeId: ids.e1, qty: '3', year: YEAR });
    expect(Number(await balance.remaining(q, { employeeId: ids.e1, year: YEAR }))).toBe(7);

    await usage.releaseAll(ids.docA);
    expect(Number(await balance.netUsage(q, ids.e1))).toBe(0);
    expect(Number(await balance.remaining(q, { employeeId: ids.e1, year: YEAR }))).toBe(10);
  });

  // ---- 4.4 Concurrency -------------------------------------------------------

  it('serializes two reserves of the last unit: exactly one succeeds', async () => {
    const q = await makeQuota();
    await entitlements.upsert({ quotaId: q, employeeId: ids.e1, year: YEAR, entitledValue: '1' });

    const results = await Promise.allSettled([
      usage.reserve({ documentId: ids.docA, quotaId: q, employeeId: ids.e1, qty: '1', year: YEAR }),
      usage.reserve({ documentId: ids.docA, quotaId: q, employeeId: ids.e1, qty: '1', year: YEAR }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(Number(await balance.remaining(q, { employeeId: ids.e1, year: YEAR }))).toBe(0);
  });

  // ---- 4.5 Carry-forward (quota-wide) ----------------------------------------

  it('carries each employee remaining forward into next year carried_over', async () => {
    const q = await makeQuota();
    await entitlements.upsert({ quotaId: q, employeeId: ids.e1, year: YEAR, entitledValue: '10' });
    await usage.reserve({ documentId: ids.docA, quotaId: q, employeeId: ids.e1, qty: '4', year: YEAR }); // remaining 6

    const rows = await entitlements.carryForward({ quotaId: q, fromYear: YEAR, toYear: YEAR + 1 });
    const e1Row = rows.find((r) => r.employeeId === ids.e1);
    expect(Number(e1Row!.carriedOver)).toBe(6);
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[quota-management] no database reachable — skipping DB-backed spec');
}
