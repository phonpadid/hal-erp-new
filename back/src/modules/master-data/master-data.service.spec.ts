import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Company } from '../multi-company/multi-company.entities';
import { ScopeService } from '../rbac/scope.service';
import { ItemService } from './item.service';
import { VendorService } from './vendor.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();

function asCompany<T>(companyId: string, fn: () => Promise<T>): Promise<T> {
  return RequestContext.run({ userId: 'u1', companyId, departmentId: 'd1', grants: [] }, fn);
}

let seq = 0;
const code = (p: string) => `${p}${seq++}`;

describe.skipIf(!hasDb)('master-data services (DB-backed)', () => {
  let orm: MikroORM;
  let vendors: VendorService;
  let items: ItemService;
  let companyA = '';
  let companyB = '';

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const a = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', isActive: true });
    const b = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', isActive: true });
    await em.flush();
    companyA = a.id;
    companyB = b.id;
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  beforeEach(() => {
    const scope = new CompanyScopeService(orm.em);
    vendors = new VendorService(orm.em, scope, new ScopeService());
    items = new ItemService(orm.em, scope, new ScopeService());
  });

  // ---- 4.1 Vendor deactivation -----------------------------------------------

  it('deactivates a vendor instead of deleting it and hides it from the default list', async () => {
    const v = await vendors.create({ vendorCode: code('V'), name: 'Acme' });
    await vendors.deactivate(v.id);

    expect((await vendors.get(v.id)).isActive).toBe(false); // still exists
    expect((await vendors.list({})).items.find((x) => x.id === v.id)).toBeUndefined();
    expect((await vendors.list({}, true)).items.find((x) => x.id === v.id)).toBeTruthy();
  });

  // ---- 4.2 Per-company vendor enablement -------------------------------------

  it('enables a vendor for one company only; the guard rejects elsewhere', async () => {
    const v = await vendors.create({ vendorCode: code('V'), name: 'Globex' });

    await asCompany(companyA, () => vendors.enableForCompany(v.id));

    // Enabled for A, not for B.
    await expect(vendors.assertVendorEnabled(v.id, companyA)).resolves.toBeUndefined();
    await expect(vendors.assertVendorEnabled(v.id, companyB)).rejects.toThrow();

    // Disable for A → guard rejects again.
    await asCompany(companyA, () => vendors.disableForCompany(v.id));
    await expect(vendors.assertVendorEnabled(v.id, companyA)).rejects.toThrow();
  });

  // ---- 4.3 Item GL defaulting + enablement guard -----------------------------

  it('defaults the GL account from the item and guards enablement', async () => {
    const it = await items.create({
      itemCode: code('I'),
      name: 'Paper',
      defaultGlAccount: '5300-OFFICE',
    });
    expect(await items.defaultGlAccountFor(it.id)).toBe('5300-OFFICE');

    // Not enabled anywhere yet → guard rejects.
    await expect(items.assertItemEnabled(it.id, companyA)).rejects.toThrow();

    await asCompany(companyA, () => items.enableForCompany(it.id));
    await expect(items.assertItemEnabled(it.id, companyA)).resolves.toBeUndefined();
  });

  // ---- 4.4 Company scope on enabled list -------------------------------------

  it('scopes the enabled-vendor list to the active company', async () => {
    const va = await vendors.create({ vendorCode: code('VA'), name: 'A-only' });
    const vb = await vendors.create({ vendorCode: code('VB'), name: 'B-only' });
    await asCompany(companyA, () => vendors.enableForCompany(va.id));
    await asCompany(companyB, () => vendors.enableForCompany(vb.id));

    // listEnabled returns the flattened vendor master, scoped to the active company: A's
    // vendor appears, B's does not.
    const aList = await asCompany(companyA, () => vendors.listEnabled());
    expect(aList.some((v) => v.id === va.id)).toBe(true);
    expect(aList.some((v) => v.id === vb.id)).toBe(false);
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[master-data] no database reachable — skipping DB-backed spec');
}
