import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { ControlPolicy } from '../../common/enums';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Currency } from '../currency/currency.entities';
import { Company } from '../multi-company/multi-company.entities';
import { WorkLocationService } from './work-location.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();

const base = {
  name: 'Head Office',
  latitude: '13.756331',
  longitude: '100.501765',
  radiusMeters: 200,
};

describe.skipIf(!hasDb)('WorkLocationService (DB-backed)', () => {
  let orm: MikroORM;
  let svc: WorkLocationService;
  let companyA = '';
  let companyB = '';

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    svc = new WorkLocationService(orm.em, new CompanyScopeService(orm.em));
    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const a = em.create(Company, { code: 'A', nameTh: 'A', branchCode: '00000', baseCurrency: thb, isActive: true, createdAt: new Date() });
    const b = em.create(Company, { code: 'B', nameTh: 'B', branchCode: '00000', baseCurrency: thb, isActive: true, createdAt: new Date() });
    await em.flush();
    companyA = a.id; companyB = b.id;
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  const asA = <T>(fn: () => Promise<T>) => RequestContext.run({ companyId: companyA, grants: [] }, fn);
  const asB = <T>(fn: () => Promise<T>) => RequestContext.run({ companyId: companyB, grants: [] }, fn);

  it('defaults to SOFT_WARNING so indoor GPS drift does not block a real arrival', async () => {
    const location = await asA(() => svc.create({ ...base, code: 'HQ' }));
    expect(location.controlPolicy).toBe(ControlPolicy.SOFT_WARNING);
    expect(location.isActive).toBe(true);
  });

  it('stores HARD_STOP when a site is meant to refuse out-of-range capture', async () => {
    const location = await asA(() =>
      svc.create({ ...base, code: 'VAULT', controlPolicy: ControlPolicy.HARD_STOP }),
    );
    expect(location.controlPolicy).toBe(ControlPolicy.HARD_STOP);
  });

  /**
   * Coordinates must survive the round trip as the exact decimal string given. A float would
   * quietly turn 13.756331 into 13.756330999999999 — the kind of drift a geofence comparison
   * should never inherit.
   */
  it('round-trips coordinates as decimal strings without float drift', async () => {
    const created = await asA(() => svc.create({ ...base, code: 'PRECISE', latitude: '-33.868820', longitude: '151.209290' }));
    const reread = await asA(() => svc.get(created.id));
    expect(reread.latitude).toBe('-33.868820');
    expect(reread.longitude).toBe('151.209290');
    expect(typeof reread.latitude).toBe('string');
  });

  it('rejects out-of-range coordinates', async () => {
    await expect(asA(() => svc.create({ ...base, code: 'BADLAT', latitude: '91.0' }))).rejects.toThrow(/latitude/);
    await expect(asA(() => svc.create({ ...base, code: 'BADLNG', longitude: '181.0' }))).rejects.toThrow(/longitude/);
  });

  it('rejects a duplicate code per company but allows it across companies', async () => {
    await asA(() => svc.create({ ...base, code: 'SHARED' }));
    await expect(asA(() => svc.create({ ...base, code: 'SHARED' }))).rejects.toThrow(/already exists/);
    await expect(asB(() => svc.create({ ...base, code: 'SHARED' }))).resolves.toBeTruthy();
  });

  it('scopes listing to the active company and hides inactive rows by default', async () => {
    const gone = await asA(() => svc.create({ ...base, code: 'OLD' }));
    await asA(() => svc.deactivate(gone.id));

    const active = await asA(() => svc.list());
    expect(active.items.map((l) => l.code)).not.toContain('OLD');
    expect(active.items.every((l) => l.company.id === companyA)).toBe(true);

    const all = await asA(() => svc.list({}, true));
    expect(all.items.map((l) => l.code)).toContain('OLD');
  });

  it('validates coordinates again when they are updated', async () => {
    const location = await asA(() => svc.create({ ...base, code: 'UPD' }));
    await expect(asA(() => svc.update(location.id, { latitude: '-91' }))).rejects.toThrow(/latitude/);
    const ok = await asA(() => svc.update(location.id, { latitude: '14.000000', radiusMeters: 500 }));
    expect(ok.latitude).toBe('14.000000');
    expect(ok.radiusMeters).toBe(500);
  });
});
