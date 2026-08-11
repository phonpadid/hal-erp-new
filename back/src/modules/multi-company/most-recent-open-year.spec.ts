import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Company, FiscalYear } from './multi-company.entities';
import { FiscalYearService } from './fiscal-year.service';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';

const FILTER_OFF = { filters: { company: false } } as const;
const hasDb = await dbAvailable();

/**
 * The fallback behind "default to the current fiscal year".
 *
 * A read that defaults a filter must not refuse to answer when no year covers today — that happens
 * to a company mid-setup, or one that has already closed the year in progress. `resolveOpenPeriod`
 * throws by design because a posting date genuinely cannot be resolved; a list filter can.
 */
describe.skipIf(!hasDb)('FiscalYearService.mostRecentOpen (DB-backed)', () => {
  let orm: MikroORM;
  let service: FiscalYearService;
  const ids = { companyA: '', companyB: '' };

  function asCtx<T>(fn: () => Promise<T>, companyId = ids.companyA): Promise<T> {
    return RequestContext.run({ companyId, grants: [] }, fn);
  }

  async function year(companyId: string, y: number, status: string) {
    const em = orm.em.fork();
    const fy = em.create(FiscalYear, {
      company: em.getReference(Company, companyId),
      year: y,
      startDate: `${y}-01-01`,
      endDate: `${y}-12-31`,
      status,
    });
    await em.persistAndFlush(fy);
    return fy.id;
  }

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const a = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', isActive: true });
    const b = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', isActive: true });
    await em.persistAndFlush([a, b]);
    Object.assign(ids, { companyA: a.id, companyB: b.id });
    service = new FiscalYearService(new CompanyScopeService(orm.em as EntityManager));
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  it('returns null when the company has no fiscal year at all', async () => {
    expect(await asCtx(() => service.mostRecentOpen(), ids.companyB)).toBeNull();
  });

  it('returns the latest OPEN year, not the latest year', async () => {
    await year(ids.companyA, 2024, 'OPEN');
    await year(ids.companyA, 2025, 'OPEN');
    await year(ids.companyA, 2026, 'CLOSED');
    const got = await asCtx(() => service.mostRecentOpen());
    expect(got?.year).toBe(2025);
  });

  it('never returns another company’s year', async () => {
    await year(ids.companyB, 2030, 'OPEN');
    const got = await asCtx(() => service.mostRecentOpen());
    expect(got?.year).toBe(2025);
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[most-recent-open-year] no database reachable — skipping DB-backed spec');
}
