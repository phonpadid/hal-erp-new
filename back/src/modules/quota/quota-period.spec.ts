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
import { Quota, QuotaUsage } from './quota.entities';
import { QuotaService } from './quota.service';
import { QuotaUsageService } from './quota-usage.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

function asCompany<T>(companyId: string, fn: () => Promise<T>): Promise<T> {
  return RequestContext.run({ userId: 'u1', companyId, departmentId: 'd1', grants: [] }, fn);
}

describe.skipIf(!hasDb)('quota periodization, adjustment & carry-forward (DB-backed)', () => {
  let orm: MikroORM;
  let quotas: QuotaService;
  let balance: QuotaBalanceService;
  let entitlements: QuotaEntitlementService;
  let usage: QuotaUsageService;

  const ids = { companyA: '', deptA: '', e1: '', e2: '', docA: '' };
  let qt = 0;

  async function makeQuota(opts: { limitValue?: string; resetCycle?: string; carryForward?: boolean } = {}): Promise<string> {
    const q = await asCompany(ids.companyA, () =>
      quotas.create({
        quotaType: `P-${qt++}`,
        unit: 'day',
        limitValue: opts.limitValue ?? '1000',
        resetCycle: opts.resetCycle,
        carryForward: opts.carryForward,
      }),
    );
    return q.id;
  }

  /** Insert a USE/RELEASE row directly with an explicit period (to simulate prior periods). */
  async function seedUsage(quotaId: string, qty: string, periodYear: number, periodIndex: number, employeeId?: string): Promise<void> {
    const em = orm.em.fork();
    em.create(QuotaUsage, {
      quota: em.getReference(Quota, quotaId),
      document: em.getReference(Document, ids.docA),
      employee: employeeId ? em.getReference(Employee, employeeId) : undefined,
      qtyUsed: qty,
      usageType: 'USE',
      periodYear,
      periodIndex,
      createdAt: new Date(),
    });
    await em.flush();
  }

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();

    const em = orm.em.fork();
    const companyA = em.create(Company, { code: 'PA', nameTh: 'PA', taxId: '9', branchCode: '00000', isActive: true });
    const deptA = em.create(Department, { company: companyA, deptCode: 'PDA', name: 'PDA', isActive: true });
    const user = em.create(AppUser, { username: 'pu', email: 'pu@x', status: 'ACTIVE' });
    const e1 = em.create(Employee, { company: companyA, department: deptA, empCode: 'PE1', fullName: 'P One', status: 'ACTIVE' });
    const e2 = em.create(Employee, { company: companyA, department: deptA, empCode: 'PE2', fullName: 'P Two', status: 'ACTIVE' });

    const docType = em.create(DocumentType, { code: 'PLEAVE', name: 'Leave', category: 'HR' as any });
    const template = em.create(FormTemplate, { documentType: docType, version: 1, status: 'PUBLISHED' });
    const workflow = em.create(Workflow, { company: companyA, name: 'PWF', isActive: true });
    const docA = em.create(Document, {
      docNo: 'PLV-A-2026-0001', company: companyA, department: deptA, documentType: docType,
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

  // ---- 2.3 Period scoping ----------------------------------------------------

  it('does not let prior-year usage reduce the current year remaining (personal YEARLY)', async () => {
    const q = await makeQuota({ resetCycle: 'YEARLY' });
    await entitlements.upsert({ quotaId: q, employeeId: ids.e1, year: 2025, entitledValue: '10' });
    await usage.reserve({ documentId: ids.docA, quotaId: q, employeeId: ids.e1, qty: '5', year: 2025 });
    await entitlements.upsert({ quotaId: q, employeeId: ids.e1, year: 2026, entitledValue: '12' });

    expect(Number(await balance.remaining(q, { employeeId: ids.e1, year: 2026 }))).toBe(12);
    expect(Number(await balance.remaining(q, { employeeId: ids.e1, year: 2025 }))).toBe(5);
  });

  it('resets a MONTHLY pool at the period boundary', async () => {
    const q = await makeQuota({ resetCycle: 'MONTHLY', limitValue: '100' });
    await seedUsage(q, '100', 2026, 3); // March fully used

    const march = await balance.remaining(q, { period: { periodYear: 2026, periodIndex: 3 } });
    const april = await balance.remaining(q, { period: { periodYear: 2026, periodIndex: 4 } });
    expect(Number(march)).toBe(0);
    expect(Number(april)).toBe(100);
  });

  // ---- 3.3 Concurrency / prior-period does not block -------------------------

  it('lets a new-period reserve succeed even when a prior period was exhausted', async () => {
    const q = await makeQuota({ resetCycle: 'YEARLY' });
    await entitlements.upsert({ quotaId: q, employeeId: ids.e1, year: 2025, entitledValue: '1' });
    await usage.reserve({ documentId: ids.docA, quotaId: q, employeeId: ids.e1, qty: '1', year: 2025 });
    await entitlements.upsert({ quotaId: q, employeeId: ids.e1, year: 2026, entitledValue: '1' });

    await expect(
      usage.reserve({ documentId: ids.docA, quotaId: q, employeeId: ids.e1, qty: '1', year: 2026 }),
    ).resolves.toBeDefined();
  });

  // ---- 3.4 Release inherits the USE period -----------------------------------

  it('stamps a RELEASE with the same period as the USE it offsets', async () => {
    const q = await makeQuota({ resetCycle: 'YEARLY' });
    await entitlements.upsert({ quotaId: q, employeeId: ids.e1, year: 2025, entitledValue: '10' });
    await usage.reserve({ documentId: ids.docA, quotaId: q, employeeId: ids.e1, qty: '3', year: 2025 });
    await usage.releaseAll(ids.docA);

    const em = orm.em.fork();
    const release = await em.findOne(QuotaUsage, { quota: q, usageType: 'RELEASE' }, FILTER_OFF);
    expect(release).not.toBeNull();
    expect(release!.periodYear).toBe(2025);
    expect(release!.periodIndex).toBe(1);
    expect(Number(release!.qtyUsed)).toBe(3);
  });

  // ---- 4.5 Mid-year adjustment ----------------------------------------------

  it('applies a signed mid-year adjustment to remaining', async () => {
    const q = await makeQuota({ resetCycle: 'YEARLY' });
    await entitlements.upsert({ quotaId: q, employeeId: ids.e1, year: 2026, entitledValue: '10' });

    await entitlements.adjust({ quotaId: q, employeeId: ids.e1, year: 2026, delta: '2' });
    expect(Number(await balance.remaining(q, { employeeId: ids.e1, year: 2026 }))).toBe(12);
    await entitlements.adjust({ quotaId: q, employeeId: ids.e1, year: 2026, delta: '-3' });
    expect(Number(await balance.remaining(q, { employeeId: ids.e1, year: 2026 }))).toBe(9);
  });

  it('rejects an adjustment when the entitlement does not exist', async () => {
    const q = await makeQuota({ resetCycle: 'YEARLY' });
    await expect(
      entitlements.adjust({ quotaId: q, employeeId: ids.e2, year: 2026, delta: '1' }),
    ).rejects.toThrow();
  });

  // ---- 4.5 Carry-forward policy + idempotency --------------------------------

  it('does not carry forward when the policy is disabled', async () => {
    const q = await makeQuota({ resetCycle: 'YEARLY', carryForward: false });
    await entitlements.upsert({ quotaId: q, employeeId: ids.e1, year: 2025, entitledValue: '10' });
    await usage.reserve({ documentId: ids.docA, quotaId: q, employeeId: ids.e1, qty: '4', year: 2025 });

    const rows = await entitlements.carryForward({ quotaId: q, fromYear: 2025, toYear: 2026 });
    expect(Number(rows.find((r) => r.employeeId === ids.e1)!.carriedOver)).toBe(0);
  });

  it('is idempotent: re-running carry-forward overwrites rather than accumulates', async () => {
    const q = await makeQuota({ resetCycle: 'YEARLY', carryForward: true });
    await entitlements.upsert({ quotaId: q, employeeId: ids.e1, year: 2025, entitledValue: '10' });
    await usage.reserve({ documentId: ids.docA, quotaId: q, employeeId: ids.e1, qty: '4', year: 2025 }); // remaining 6

    await entitlements.carryForward({ quotaId: q, fromYear: 2025, toYear: 2026 });
    const rows = await entitlements.carryForward({ quotaId: q, fromYear: 2025, toYear: 2026 });
    expect(Number(rows.find((r) => r.employeeId === ids.e1)!.carriedOver)).toBe(6);
  });

  // ---- 4.3 Entitlement read --------------------------------------------------

  it('lists entitlements with reconciled entitled/used/remaining for a year', async () => {
    const q = await makeQuota({ resetCycle: 'YEARLY' });
    await entitlements.upsert({ quotaId: q, employeeId: ids.e1, year: 2026, entitledValue: '10', carriedOver: '2', adjusted: '1' });
    await usage.reserve({ documentId: ids.docA, quotaId: q, employeeId: ids.e1, qty: '5', year: 2026 });

    const rows = await entitlements.listForQuota(q, 2026);
    const row = rows.find((r) => r.employeeId === ids.e1)!;
    expect(Number(row.entitled)).toBe(13);
    expect(Number(row.used)).toBe(5);
    expect(Number(row.remaining)).toBe(8);
  });

  // ---- 5.2 Quota config round-trip -------------------------------------------

  it('round-trips reset_cycle and carry_forward on create and update', async () => {
    const q = await makeQuota({ resetCycle: 'MONTHLY', carryForward: false });
    const created = await asCompany(ids.companyA, () => quotas.get(q));
    expect(created.resetCycle).toBe('MONTHLY');
    expect(created.carryForward).toBe(false);

    await asCompany(ids.companyA, () => quotas.update(q, { resetCycle: 'QUARTERLY', carryForward: true }));
    const updated = await asCompany(ids.companyA, () => quotas.get(q));
    expect(updated.resetCycle).toBe('QUARTERLY');
    expect(updated.carryForward).toBe(true);
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[quota-period] no database reachable — skipping DB-backed spec');
}
