import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { AccountService } from '../accounting/account.service';
import { Account } from '../accounting/accounting.entities';
import { AccountType } from '../../common/enums';
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
    items = new ItemService(orm.em, scope, new ScopeService(), new AccountService(orm.em, scope));
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

  // ---- 4.3 Per-company item GL (validated) + enablement guard ----------------

  it('sets the item GL per company (validated against the chart) and guards enablement', async () => {
    // A postable account in company A so a GL override can validate against its chart.
    const em = orm.em.fork();
    em.create(Account, {
      company: em.getReference(Company, companyA),
      code: '5300-OFFICE',
      name: 'Office expense',
      accountType: AccountType.EXPENSE,
      isPostable: true,
      isActive: true,
    });
    await em.flush();

    const it = await items.create({ itemCode: code('I'), name: 'Paper' });

    // No GL and not enabled anywhere yet → no per-company GL, guard rejects.
    await asCompany(companyA, async () => {
      expect(await items.defaultGlAccountFor(it.id)).toBeNull();
    });
    await expect(items.assertItemEnabled(it.id, companyA)).rejects.toThrow();

    // Enable for A with a valid GL → the per-company GL resolves and the guard passes.
    await asCompany(companyA, async () => {
      await items.enableForCompany(it.id, '5300-OFFICE');
      await expect(items.assertItemEnabled(it.id, companyA)).resolves.toBeUndefined();
      expect(await items.defaultGlAccountFor(it.id)).toBe('5300-OFFICE');
    });

    // A GL that is not a postable account in company A is rejected on enable.
    const it2 = await items.create({ itemCode: code('I'), name: 'Pen' });
    await expect(asCompany(companyA, () => items.enableForCompany(it2.id, 'NOPE'))).rejects.toThrow();
  });

  it('keeps the item GL company-scoped (same item, different GL per company)', async () => {
    const em = orm.em.fork();
    em.create(Account, { company: em.getReference(Company, companyA), code: 'GLA', name: 'A exp', accountType: AccountType.EXPENSE, isPostable: true, isActive: true });
    em.create(Account, { company: em.getReference(Company, companyB), code: 'GLB', name: 'B exp', accountType: AccountType.EXPENSE, isPostable: true, isActive: true });
    await em.flush();

    const it = await items.create({ itemCode: code('I'), name: 'Shared' });
    await asCompany(companyA, () => items.enableForCompany(it.id, 'GLA'));
    await asCompany(companyB, () => items.enableForCompany(it.id, 'GLB'));

    await asCompany(companyA, async () => expect(await items.defaultGlAccountFor(it.id)).toBe('GLA'));
    await asCompany(companyB, async () => expect(await items.defaultGlAccountFor(it.id)).toBe('GLB'));
  });

  // ---- 4.3b Per-company vendor payment terms (override + group fallback) ------

  it('overrides vendor payment terms per company and falls back to the group value', async () => {
    const v = await vendors.create({ vendorCode: code('V'), name: 'Terms Co', paymentTermDays: 30 });
    await asCompany(companyA, () => vendors.enableForCompany(v.id, 45)); // A overrides to 45
    await asCompany(companyB, () => vendors.enableForCompany(v.id)); // B uses the group 30

    const aList = await asCompany(companyA, () => vendors.listEnabled());
    const bList = await asCompany(companyB, () => vendors.listEnabled());
    expect(aList.find((x) => x.id === v.id)?.paymentTermDays).toBe(45);
    expect(bList.find((x) => x.id === v.id)?.paymentTermDays).toBe(30);
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

  it('reports whether an enabled item is stock-tracked', async () => {
    // The line editor may only offer stock-tracked items on a stock-moving document
    // (`web-inventory`). The flag lives on the group item record and was missing from this
    // payload, so the client had nothing to filter on: it offered everything and the user
    // learned the difference from a refusal at submit.
    const tracked = await items.create({ itemCode: code('S'), name: 'Safety Helmet', isStockTracked: true });
    const plain = await items.create({ itemCode: code('S'), name: 'A4 Paper' });
    await asCompany(companyA, async () => {
      await items.enableForCompany(tracked.id, '5300-OFFICE');
      await items.enableForCompany(plain.id, '5300-OFFICE');
    });

    const list = await asCompany(companyA, () => items.listEnabled());
    const byId = new Map(list.map((i) => [i.id, i]));
    expect(byId.get(tracked.id)?.isStockTracked).toBe(true);
    expect(byId.get(plain.id)?.isStockTracked).toBe(false);
    // The rest of the payload is unchanged — this is an added field, not a reshaped read.
    expect(byId.get(plain.id)?.name).toBe('A4 Paper');
    expect(byId.get(plain.id)?.defaultGlAccount).toBe('5300-OFFICE');
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[master-data] no database reachable — skipping DB-backed spec');
}
