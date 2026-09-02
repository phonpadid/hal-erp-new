import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountType } from '../../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../../test/test-orm';
import { Currency } from '../../currency/currency.entities';
import { Company } from '../../multi-company/multi-company.entities';
import { Account } from '../accounting.entities';
import { ChartImportService } from './chart-import.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const FILTER_OFF = { filters: { company: false } } as const;
const DATA = resolve(__dirname, '../../../../../data/account');
const PARENT_CHART = resolve(DATA, 'ບັນຊີ (3).xls');
const COMPANY_CHART = resolve(DATA, 'ສາລະບານບັນຊີ 2026 (3).xls');

const hasDb = await dbAvailable();
const hasFiles = existsSync(PARENT_CHART) && existsSync(COMPANY_CHART);
const canRun = hasDb && hasFiles;

/**
 * The import, against the customer's real chart and a real database.
 *
 * Every count here was measured from the files independently before any of this code existed, so
 * a passing run means the importer agrees with the spreadsheet — not with itself.
 */
describe.skipIf(!canRun)('chart of accounts import (DB-backed)', () => {
  let orm: MikroORM;
  let service: ChartImportService;
  const FILES = [PARENT_CHART, COMPANY_CHART];

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    em.create(Company, { code: 'IMP', nameTh: 'Import target', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true });
    em.create(Company, { code: 'OTHER', nameTh: 'Bystander', taxId: '2', branchCode: '00000', baseCurrency: thb, isActive: true });
    await em.flush();
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  beforeEach(() => {
    service = new ChartImportService(orm.em);
  });

  const accountsOf = (code: string) =>
    orm.em.fork().find(Account, { company: { code } }, { ...FILTER_OFF, populate: ['parent'] });

  // ---- refusals, before anything is opened -------------------------------------------------

  it('refuses a run that names no company', async () => {
    await expect(service.import({ companyCode: '', files: FILES })).rejects.toThrow(/company code is required/i);
  });

  it('refuses a company that does not exist, naming it', async () => {
    await expect(service.import({ companyCode: 'NOPE', files: FILES })).rejects.toThrow(/'NOPE' does not exist/);
  });

  it('refuses a run with no files', async () => {
    await expect(service.import({ companyCode: 'IMP', files: [] })).rejects.toThrow(/at least one chart file/i);
  });

  // ---- the dry run writes nothing ----------------------------------------------------------

  it('reports the whole plan without creating anything', async () => {
    const before = await accountsOf('IMP');
    const res = await service.import({ companyCode: 'IMP', files: FILES, dryRun: true });
    expect(res.created).toBe(4067);
    expect(res.plan.skipped).toHaveLength(16);
    expect(await accountsOf('IMP')).toHaveLength(before.length);
  });

  // ---- the real run ------------------------------------------------------------------------

  it('reports from a dry run exactly what the real run then reports', async () => {
    // The property that makes a dry run worth reading: it is the same code path up to the write.
    // A preview that counts differently from the run it previews is worse than no preview.
    const dry = await service.import({ companyCode: 'IMP', files: FILES, dryRun: true });
    const real = await service.import({ companyCode: 'IMP', files: FILES });
    expect(real.created).toBe(dry.created);
    expect(real.unchanged).toBe(dry.unchanged);
    expect(real.plan.skipped.map((s) => s.code)).toEqual(dry.plan.skipped.map((s) => s.code));
    expect(real.plan.crossType).toEqual(dry.plan.crossType);
    expect(real.plan.roots).toEqual(dry.plan.roots);
  });

  it('creates the customer chart', async () => {
    // The run above already wrote it; this asserts the state that leaves behind, which every
    // test below reads.
    expect(await accountsOf('IMP')).toHaveLength(4067);
  });

  it('places a company-chart account under its parent-chart head', async () => {
    // The join the whole import rests on: `1017.0001` is in one file and `1017` in the other.
    const rows = await accountsOf('IMP');
    const byCode = new Map(rows.map((a) => [a.code, a]));
    expect(byCode.get('1017.0001')?.parent?.code).toBe('1017');
    expect(byCode.get('1017')?.parent?.code).toBe('101');
  });

  it('makes headers non-postable and leaves alone postable', async () => {
    const rows = await accountsOf('IMP');
    const byCode = new Map(rows.map((a) => [a.code, a]));
    expect(byCode.get('1017')?.isPostable).toBe(false);
    expect(byCode.get('1017.0001')?.isPostable).toBe(true);
    expect(rows.filter((a) => !a.isPostable)).toHaveLength(179);
  });

  it('writes no class-5 account', async () => {
    const rows = await accountsOf('IMP');
    expect(rows.some((a) => a.code === '5')).toBe(false);
    expect(rows.filter((a) => /^5\d*(\.\d+)?$/.test(a.code) && a.code.startsWith('5'))).toHaveLength(0);
  });

  it('keeps the contra accounts the same-type rule would have rejected', async () => {
    const rows = await accountsOf('IMP');
    const byCode = new Map(rows.map((a) => [a.code, a]));
    const contra = byCode.get('752.01');
    expect(contra?.accountType).toBe(AccountType.ASSET);
    expect(contra?.parent?.code).toBe('752');
    expect(byCode.get('752')?.accountType).toBe(AccountType.REVENUE);
  });

  it('files class 3 as LIABILITY and creates no EQUITY account', async () => {
    const rows = await accountsOf('IMP');
    expect(rows.some((a) => a.accountType === AccountType.EQUITY)).toBe(false);
    expect(rows.find((a) => a.code === '3')?.accountType).toBe(AccountType.LIABILITY);
  });

  it('stamps every row with the named company and leaves the other company empty', async () => {
    const rows = await orm.em.fork().find(Account, {}, { ...FILTER_OFF, populate: ['company'] });
    expect(rows.every((a) => a.company.code === 'IMP')).toBe(true);
    expect(await accountsOf('OTHER')).toHaveLength(0);
  });

  // ---- running it again ---------------------------------------------------------------------

  it('creates nothing on a second run and reports every row unchanged', async () => {
    const res = await service.import({ companyCode: 'IMP', files: FILES });
    expect(res.created).toBe(0);
    expect(res.unchanged).toBe(4067);
    expect(await accountsOf('IMP')).toHaveLength(4067);
  });

  it('leaves a name edited in the app alone on a re-run', async () => {
    // An import is not a sync. Overwriting a correction because a stale export still carries the
    // old name is a worse failure than doing nothing.
    const em = orm.em.fork();
    const edited = await em.findOneOrFail(Account, { company: { code: 'IMP' }, code: '1011.01' }, FILTER_OFF);
    edited.name = 'Corrected by a human';
    await em.flush();

    await service.import({ companyCode: 'IMP', files: FILES });
    const after = await orm.em.fork().findOneOrFail(Account, { company: { code: 'IMP' }, code: '1011.01' }, FILTER_OFF);
    expect(after.name).toBe('Corrected by a human');
  });

  it('adds only what is new when a later file carries both', async () => {
    const em = orm.em.fork();
    const doomed = await em.findOneOrFail(Account, { company: { code: 'IMP' }, code: '1011.3' }, FILTER_OFF);
    // Detach it from its parent so deleting it cannot orphan a child, then remove it.
    const children = await em.find(Account, { parent: doomed.id }, FILTER_OFF);
    for (const c of children) c.parent = doomed.parent;
    await em.flush();
    await em.removeAndFlush(doomed);
    expect(await accountsOf('IMP')).toHaveLength(4066);

    const res = await service.import({ companyCode: 'IMP', files: FILES });
    expect(res.created).toBe(1);
    expect(res.unchanged).toBe(4066);
    const restored = await orm.em.fork().findOneOrFail(
      Account,
      { company: { code: 'IMP' }, code: '1011.3' },
      { ...FILTER_OFF, populate: ['parent'] },
    );
    expect(restored.parent?.code).toBe('1011');
  });
});

describe.skipIf(!canRun)('chart import is all or nothing (DB-backed)', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    em.create(Company, { code: 'ATOMIC', nameTh: 'Atomic', taxId: '9', branchCode: '00000', baseCurrency: thb, isActive: true });
    await em.flush();
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  it('leaves zero accounts when the write fails after both passes', async () => {
    // The reason the two passes share one transaction: the first has already inserted 4,067 rows
    // by the time the second can fail, and a chart half-linked is worse than no chart.
    //
    // The failure is injected INSIDE `transactional`, after the callback has done all its work —
    // an earlier attempt hooked the forked EM's `flush`, which never fires, because
    // `transactional` hands the callback an EntityManager of its own.
    const boom = new Error('injected failure after the parent-linking pass');
    const em = new Proxy(orm.em, {
      get(target, prop, receiver) {
        if (prop !== 'fork') return Reflect.get(target, prop, receiver);
        return () => {
          const forked = target.fork();
          const original = forked.transactional.bind(forked);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (forked as any).transactional = (cb: (tem: unknown) => Promise<unknown>) =>
            original(async (tem) => {
              await cb(tem);
              throw boom;
            });
          return forked;
        };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

    const service = new ChartImportService(em);
    await expect(
      service.import({ companyCode: 'ATOMIC', files: [PARENT_CHART, COMPANY_CHART] }),
    ).rejects.toThrow(/injected failure/);

    const left = await orm.em.fork().find(Account, { company: { code: 'ATOMIC' } }, FILTER_OFF);
    expect(left).toHaveLength(0);
  });

  it('writes the same chart when nothing fails, so the test above is not vacuous', async () => {
    const service = new ChartImportService(orm.em);
    const res = await service.import({ companyCode: 'ATOMIC', files: [PARENT_CHART, COMPANY_CHART] });
    expect(res.created).toBe(4067);
    expect(await orm.em.fork().count(Account, { company: { code: 'ATOMIC' } }, FILTER_OFF)).toBe(4067);
  });
});

if (!canRun) {
  // eslint-disable-next-line no-console
  console.warn('[chart-import] no database or no customer files — skipping import spec');
}
