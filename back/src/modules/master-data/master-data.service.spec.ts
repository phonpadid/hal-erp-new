import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { AccountService } from '../accounting/account.service';
import { Account } from '../accounting/accounting.entities';
import { AccountType } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Budget, BudgetNode } from '../budget/budget.entities';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
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

    // An item is bound to a BUDGET by its plan code, so both companies need a plan to bind into.
    // Company A gets two budgets on ONE account — the customer's shape, and the reason an account
    // could not be the thing an admin picks. Both companies use the code `6.101`, which is how the
    // cross-company test can prove a code resolves inside the active company's own year.
    const year = new Date().getFullYear();
    const openYear = (company: Company) =>
      em.create(FiscalYear, { company, year, startDate: `${year}-01-01`, endDate: `${year}-12-31`, status: 'OPEN' });
    const fyA = openYear(a);
    const fyB = openYear(b);
    const deptA = em.create(Department, { company: a, deptCode: 'OPS', name: 'Ops', isActive: true });
    const deptB = em.create(Department, { company: b, deptCode: 'OPS', name: 'Ops B', isActive: true });
    const account = (company: Company, code: string) =>
      em.create(Account, { company, code, name: `Account ${code}`, accountType: AccountType.EXPENSE, isPostable: true, isActive: true });
    account(a, '5300-OFFICE');
    account(b, 'GLB');
    const budget = (fiscalYear: FiscalYear, department: Department, code: string, glAccount: string, budgetName: string, status = 'ACTIVE') =>
      em.create(Budget, {
        fiscalYear, department, node: em.create(BudgetNode, { fiscalYear, code }),
        glAccount, budgetName, amountTotal: '100000', status,
      } as never);
    budget(fyA, deptA, '6.101', '5300-OFFICE', 'Office supplies');
    budget(fyA, deptA, '6.102', '5300-OFFICE', 'Mail Express');
    // Drafted, never activated: a code that exists in the plan and still may not be bound.
    budget(fyA, deptA, '6.999', '5300-OFFICE', 'Not yet approved', 'DRAFT');
    budget(fyB, deptB, '6.101', 'GLB', 'B office supplies');
    await em.flush();
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

  // ---- 4.3 Per-company item BUDGET (resolved) + stamped GL + enablement guard ----

  it('binds the item to a budget, stamps that budget\'s account, and guards enablement', async () => {
    const it = await items.create({ itemCode: code('I'), name: 'Paper' });

    // Not enabled anywhere yet → no per-company GL, guard rejects.
    await asCompany(companyA, async () => {
      expect(await items.defaultGlAccountFor(it.id)).toBeNull();
    });
    await expect(items.assertItemEnabled(it.id, companyA)).rejects.toThrow();

    // Enable for A naming a BUDGET → the guard passes and the account comes from that budget.
    // The caller never sent an account: it is stamped, so the item cannot post to one account
    // while claiming to belong to a budget that posts to another.
    await asCompany(companyA, async () => {
      await items.enableForCompany(it.id, '6.101');
      await expect(items.assertItemEnabled(it.id, companyA)).resolves.toBeUndefined();
      expect(await items.defaultGlAccountFor(it.id)).toBe('5300-OFFICE');
    });

    // A plan code no budget of the open year carries is rejected on enable.
    const it2 = await items.create({ itemCode: code('I'), name: 'Pen' });
    await expect(asCompany(companyA, () => items.enableForCompany(it2.id, 'NOPE'))).rejects.toThrow();
    // So is one whose budget exists but is not ACTIVE — a plan drafted and never approved.
    await expect(asCompany(companyA, () => items.enableForCompany(it2.id, '6.999'))).rejects.toThrow();
  });

  it('tells apart two budgets that post to the SAME account', async () => {
    // The whole point. `6.101` and `6.102` both post to 5300-OFFICE, so an account cannot say which
    // was meant — before this, both collapsed to one option and the registry recorded neither.
    const one = await items.create({ itemCode: code('I'), name: 'Envelopes' });
    const two = await items.create({ itemCode: code('I'), name: 'Postage' });
    await asCompany(companyA, async () => {
      await items.enableForCompany(one.id, '6.101');
      await items.enableForCompany(two.id, '6.102');
    });

    const list = await asCompany(companyA, () => items.listEnabled());
    const byId = new Map(list.map((i) => [i.id, i]));
    expect(byId.get(one.id)?.defaultBudgetCode).toBe('6.101');
    expect(byId.get(two.id)?.defaultBudgetCode).toBe('6.102');
    // Read back by the name the OPEN year gives the code, not one stored at bind time.
    expect(byId.get(one.id)?.defaultBudgetName).toBe('Office supplies');
    expect(byId.get(two.id)?.defaultBudgetName).toBe('Mail Express');
    // Same account on both — which is exactly why the account could not have been the choice.
    expect(byId.get(one.id)?.defaultGlAccount).toBe('5300-OFFICE');
    expect(byId.get(two.id)?.defaultGlAccount).toBe('5300-OFFICE');
  });

  it('resolves a plan code inside the ACTIVE company (same code, different budget)', async () => {
    // Both companies run a `6.101`. A code is looked up through the company's own fiscal year, so
    // company A can never reach company B's plan (invariant 1) — and the stamped accounts differ.
    const it = await items.create({ itemCode: code('I'), name: 'Shared' });
    await asCompany(companyA, () => items.enableForCompany(it.id, '6.101'));
    await asCompany(companyB, () => items.enableForCompany(it.id, '6.101'));

    await asCompany(companyA, async () => expect(await items.defaultGlAccountFor(it.id)).toBe('5300-OFFICE'));
    await asCompany(companyB, async () => expect(await items.defaultGlAccountFor(it.id)).toBe('GLB'));
  });

  it('clears a binding without taking the account the item posts to', async () => {
    // An item that posts today does not stop posting because someone removed a label.
    const it = await items.create({ itemCode: code('I'), name: 'Unbound later' });
    await asCompany(companyA, async () => {
      await items.enableForCompany(it.id, '6.101');
      await items.enableForCompany(it.id, '');
      expect(await items.defaultGlAccountFor(it.id)).toBe('5300-OFFICE');
    });
    const list = await asCompany(companyA, () => items.listEnabled());
    // Falsy rather than undefined: a cleared column reads back as null, the same as an unset GL.
    expect(list.find((i) => i.id === it.id)?.defaultBudgetCode).toBeFalsy();
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
      await items.enableForCompany(tracked.id, '6.101');
      await items.enableForCompany(plain.id, '6.101');
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
