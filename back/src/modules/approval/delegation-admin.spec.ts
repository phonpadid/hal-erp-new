import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Currency } from '../currency/currency.entities';
import { Company } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import {seedDatabase, SEED_COMPANY_CODE } from '../../seed/seed-data';
import { WorkflowConfigService } from './workflow-config.service';
import { ApprovalDelegation } from './approval.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

describe.skipIf(!hasDb)('delegation admin: list + cancel (DB-backed)', () => {
  let orm: MikroORM;
  let config: WorkflowConfigService;
  let companyA = '';
  let otherDelId = '';

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());
    config = new WorkflowConfigService(orm.em);

    const em = orm.em.fork();
    companyA = (await em.findOneOrFail(Company, { code: SEED_COMPANY_CODE }, FILTER_OFF)).id;

    // A delegation in a SECOND company — must never surface for company A.
    const thb = await em.findOneOrFail(Currency, { code: 'THB' }, FILTER_OFF);
    const admin = await em.findOneOrFail(AppUser, { username: 'admin' }, FILTER_OFF);
    const approver = await em.findOneOrFail(AppUser, { username: 'approver' }, FILTER_OFF);
    const compB = em.create(Company, { code: 'DEMO2', nameTh: 'บี', nameEn: 'B', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true, createdAt: new Date() });
    const delB = em.create(ApprovalDelegation, { company: compB, delegator: admin, delegate: approver, startDate: '2026-01-01', endDate: '2026-12-31', status: 'ACTIVE', createdAt: new Date() });
    await em.flush();
    otherDelId = delB.id;
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  const asA = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId: 'u', companyId: companyA, departmentId: '', grants: [] }, fn);

  it('creates, lists with resolved names, and excludes other companies', async () => {
    const em = orm.em.fork();
    const admin = await em.findOneOrFail(AppUser, { username: 'admin' }, FILTER_OFF);
    const approver = await em.findOneOrFail(AppUser, { username: 'approver' }, FILTER_OFF);
    await asA(() => config.createDelegation({ delegatorId: admin.id, delegateId: approver.id, startDate: '2026-01-01', endDate: '2026-12-31' }));

    const { items: list } = await asA(() => config.listDelegations());
    expect(list).toHaveLength(1); // company A only, not company B
    expect(list[0].delegatorName).toBe('admin');
    expect(list[0].delegateName).toBe('approver');
    expect(list[0].status).toBe('ACTIVE');
    expect(list.map((d) => d.id)).not.toContain(otherDelId);
  });

  it('cancels an active delegation (status → CANCELLED) and rejects cross-company', async () => {
    const { items: list } = await asA(() => config.listDelegations());
    await asA(() => config.cancelDelegation(list[0].id));
    const { items: after } = await asA(() => config.listDelegations());
    expect(after[0].status).toBe('CANCELLED');

    await expect(asA(() => config.cancelDelegation(otherDelId))).rejects.toThrow();
  });
});
