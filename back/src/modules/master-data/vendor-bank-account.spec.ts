import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Currency } from '../currency/currency.entities';
import { Company } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { Vendor, VendorBankAccount, VendorBankAccountLog } from './master-data.entities';
import { VendorBankAccountService } from './vendor-bank-account.service';
import { VendorService } from './vendor.service';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ScopeService } from '../rbac/scope.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * A vendor's payee bank accounts.
 *
 * The two things worth locking down: a vendor may hold several accounts with exactly one primary,
 * and every change is attributable. The account table is not append-only, so an attacker's cheapest
 * move is to point an account at themselves, wait for the payment run, and point it back — the log
 * is the only thing that makes that visible afterwards.
 */
describe.skipIf(!hasDb)('vendor bank accounts (DB-backed)', () => {
  let orm: MikroORM;
  let accounts: VendorBankAccountService;
  let vendors: VendorService;
  const ids = { companyA: '', companyB: '', vendor: '', otherVendor: '', actor: '' };

  function asUser<T>(companyId: string, fn: () => Promise<T>): Promise<T> {
    return RequestContext.run(
      { userId: ids.actor, companyId, departmentId: 'd', grants: [] },
      fn,
    );
  }

  function add(over: Partial<{ bankCode: string; accountNo: string; accountName: string; currency: string; isPrimary: boolean }> = {}) {
    return asUser(ids.companyA, () =>
      accounts.create(ids.vendor, {
        bankCode: over.bankCode ?? 'BKK',
        accountNo: over.accountNo ?? '0001',
        accountName: over.accountName ?? 'Acme Co',
        currency: over.currency,
        isPrimary: over.isPrimary,
      }),
    );
  }

  function logsFor(accountId: string): Promise<VendorBankAccountLog[]> {
    return orm.em.fork().find(
      VendorBankAccountLog,
      { vendorBankAccount: accountId },
      { ...FILTER_OFF, populate: ['actor'], orderBy: { actedAt: 'ASC' } },
    );
  }

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    em.create(Currency, { code: 'USD', name: 'Dollar', decimalPlaces: 2, isActive: true });
    const companyA = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true });
    const companyB = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', baseCurrency: thb, isActive: true });
    const vendor = em.create(Vendor, { vendorCode: 'V1', name: 'Acme', paymentTermDays: 30, isActive: true });
    const otherVendor = em.create(Vendor, { vendorCode: 'V2', name: 'Other', paymentTermDays: 30, isActive: true });
    const actor = em.create(AppUser, { username: 'bankadmin', email: 'bankadmin@x', status: 'ACTIVE' });
    await em.flush();
    Object.assign(ids, {
      companyA: companyA.id, companyB: companyB.id,
      vendor: vendor.id, otherVendor: otherVendor.id, actor: actor.id,
    });
    accounts = new VendorBankAccountService(orm.em);
    vendors = new VendorService(orm.em, new CompanyScopeService(orm.em), new ScopeService());
  });

  beforeEach(async () => {
    await orm.em.fork().nativeDelete(VendorBankAccountLog, {}, FILTER_OFF);
    await orm.em.fork().nativeDelete(VendorBankAccount, {}, FILTER_OFF);
  });

  it('holds several accounts for one vendor', async () => {
    await add({ bankCode: 'BKK', accountNo: '0001' });
    await add({ bankCode: 'SCB', accountNo: '0002' });

    const list = await asUser(ids.companyA, () => accounts.list(ids.vendor));

    expect(list).toHaveLength(2);
    expect(list.filter((a) => a.isPrimary)).toHaveLength(1);
  });

  it('makes the first account primary so a payee always has a default', async () => {
    const first = await add({ accountNo: '0001' });
    const second = await add({ accountNo: '0002' });

    expect(first.isPrimary).toBe(true);
    expect(second.isPrimary).toBe(false);
  });

  it('demotes the previous primary atomically when a new one is promoted', async () => {
    const a = await add({ accountNo: '0001' });
    const b = await add({ accountNo: '0002' });

    await asUser(ids.companyA, () => accounts.setPrimary(b.id));

    const fresh = await orm.em.fork().find(VendorBankAccount, { vendor: ids.vendor }, FILTER_OFF);
    expect(fresh.find((x) => x.id === b.id)!.isPrimary).toBe(true);
    expect(fresh.find((x) => x.id === a.id)!.isPrimary).toBe(false);
    // Never two at once, which is what makes "the vendor's primary account" answerable.
    expect(fresh.filter((x) => x.isPrimary)).toHaveLength(1);
  });

  it('rejects a duplicate account number at the same bank', async () => {
    await add({ bankCode: 'BKK', accountNo: '0001' });

    await expect(add({ bankCode: 'BKK', accountNo: '0001' })).rejects.toThrow(ConflictException);
  });

  it('allows the same account number at a different bank', async () => {
    await add({ bankCode: 'BKK', accountNo: '0001' });

    await expect(add({ bankCode: 'SCB', accountNo: '0001' })).resolves.toBeTruthy();
  });

  it('stores an account number as text, keeping its leading zeros', async () => {
    // An account number identifies, it does not measure: as a number, 007 becomes 7.
    const a = await add({ accountNo: '00701234' });

    const fresh = await orm.em.fork().findOneOrFail(VendorBankAccount, { id: a.id }, FILTER_OFF);
    expect(fresh.accountNo).toBe('00701234');
  });

  it('is visible group-wide, since the vendor itself is', async () => {
    await add({ accountNo: '0001' });

    // A GROUP-scope read under invariant 1 — no wider than the vendor's own name or tax id.
    const fromB = await asUser(ids.companyB, () => accounts.list(ids.vendor));

    expect(fromB).toHaveLength(1);
  });

  it('rejects an unknown vendor and an unknown currency', async () => {
    await expect(
      asUser(ids.companyA, () =>
        accounts.create('00000000-0000-0000-0000-000000000000', {
          bankCode: 'BKK', accountNo: '9', accountName: 'X',
        }),
      ),
    ).rejects.toThrow(NotFoundException);

    await expect(add({ currency: 'XXX' })).rejects.toThrow(NotFoundException);
  });

  // ---- Attribution -----------------------------------------------------------

  it('records who created an account', async () => {
    const a = await add({ accountNo: '0001' });

    const [log] = await logsFor(a.id);
    expect(log.action).toBe('CREATE');
    expect(log.actor.id).toBe(ids.actor);
    expect(log.actedAt).toBeTruthy();
    expect(JSON.parse(log.afterJson!)).toMatchObject({ accountNo: '0001' });
  });

  it('records both the old and new account number on an edit', async () => {
    const a = await add({ accountNo: '0001' });

    await asUser(ids.companyA, () => accounts.update(a.id, { accountNo: '9999' }));

    const logs = await logsFor(a.id);
    const edit = logs.find((l) => l.action === 'UPDATE')!;
    // Without both sides, an edit-pay-revert would be indistinguishable from no change at all.
    expect(JSON.parse(edit.beforeJson!)).toMatchObject({ accountNo: '0001' });
    expect(JSON.parse(edit.afterJson!)).toMatchObject({ accountNo: '9999' });
    expect(edit.actor.id).toBe(ids.actor);
  });

  it('records a deactivation', async () => {
    const a = await add({ accountNo: '0001' });

    await asUser(ids.companyA, () => accounts.deactivate(a.id));

    const logs = await logsFor(a.id);
    expect(logs.map((l) => l.action)).toContain('DEACTIVATE');
  });

  it('leaves an edit-pay-revert reconstructable from the log alone', async () => {
    const a = await add({ accountNo: '0001' });
    await asUser(ids.companyA, () => accounts.update(a.id, { accountNo: 'ATTACKER' }));
    await asUser(ids.companyA, () => accounts.update(a.id, { accountNo: '0001' }));

    const logs = await logsFor(a.id);

    // The account row now looks untouched; only the log shows where the money briefly pointed.
    const fresh = await orm.em.fork().findOneOrFail(VendorBankAccount, { id: a.id }, FILTER_OFF);
    expect(fresh.accountNo).toBe('0001');
    expect(logs.map((l) => l.action)).toEqual(['CREATE', 'UPDATE', 'UPDATE']);
    expect(JSON.parse(logs[1].afterJson!).accountNo).toBe('ATTACKER');
  });

  // ---- The registry annotation -----------------------------------------------

  it('marks a vendor that has an active account', async () => {
    await add({ accountNo: '0001' });

    const page = await asUser(ids.companyA, () => vendors.list({ page: 1, limit: 20 }));

    const row = page.items.find((v) => v.id === ids.vendor) as { hasBankAccount?: boolean };
    expect(row.hasBankAccount).toBe(true);
  });

  it('marks a vendor whose only account is deactivated as having none', async () => {
    const a = await add({ accountNo: '0001' });
    await asUser(ids.companyA, () => accounts.deactivate(a.id));

    const page = await asUser(ids.companyA, () => vendors.list({ page: 1, limit: 20 }));

    // An inactive account cannot be a payee, so for the registry's purpose the vendor has none —
    // a disbursement for it still cannot be submitted.
    const row = page.items.find((v) => v.id === ids.vendor) as { hasBankAccount?: boolean };
    expect(row.hasBankAccount).toBe(false);
  });

  it('marks a vendor with no accounts at all', async () => {
    const page = await asUser(ids.companyA, () => vendors.list({ page: 1, limit: 20 }));

    const row = page.items.find((v) => v.id === ids.otherVendor) as { hasBankAccount?: boolean };
    expect(row.hasBankAccount).toBe(false);
  });

  // ---- History read ----------------------------------------------------------

  it('returns an account’s changes newest first', async () => {
    const a = await add({ accountNo: '0001' });
    await asUser(ids.companyA, () => accounts.update(a.id, { accountNo: '0002' }));
    await asUser(ids.companyA, () => accounts.update(a.id, { accountNo: '0003' }));

    const history = await asUser(ids.companyA, () => accounts.history(a.id));

    // Newest first: the question is always "what just happened to this account".
    expect(history.map((h) => h.action)).toEqual(['UPDATE', 'UPDATE', 'CREATE']);
    expect(history[0].after?.accountNo).toBe('0003');
  });

  it('returns the actor and both sides of an edit, parsed', async () => {
    const a = await add({ accountNo: '0001' });
    await asUser(ids.companyA, () => accounts.update(a.id, { accountNo: '9999' }));

    const [edit] = await asUser(ids.companyA, () => accounts.history(a.id));

    expect(edit.actor.id).toBe(ids.actor);
    expect(edit.actedAt).toBeTruthy();
    // Parsed here, not handed over as JSON strings for every client to re-read.
    expect(edit.before).toEqual({ bankCode: 'BKK', accountNo: '0001', accountName: 'Acme Co' });
    expect(edit.after?.accountNo).toBe('9999');
  });

  it('makes an edit-pay-revert legible from the history alone', async () => {
    const a = await add({ accountNo: '0001' });
    await asUser(ids.companyA, () => accounts.update(a.id, { accountNo: 'ATTACKER' }));
    await asUser(ids.companyA, () => accounts.update(a.id, { accountNo: '0001' }));

    const history = await asUser(ids.companyA, () => accounts.history(a.id));

    // The account row reads exactly as it started; only this says otherwise.
    expect(history).toHaveLength(3);
    expect(history[1].after?.accountNo).toBe('ATTACKER');
  });

  it('still has a history after the account is deactivated', async () => {
    const a = await add({ accountNo: '0001' });
    await asUser(ids.companyA, () => accounts.update(a.id, { accountNo: '9999' }));
    await asUser(ids.companyA, () => accounts.deactivate(a.id));

    const history = await asUser(ids.companyA, () => accounts.history(a.id));

    // A retired account is exactly where a covering edit would hide.
    expect(history.map((h) => h.action)).toEqual(['DEACTIVATE', 'UPDATE', 'CREATE']);
  });

  it('rejects the history of an account that does not exist', async () => {
    await expect(
      asUser(ids.companyA, () => accounts.history('00000000-0000-0000-0000-000000000000')),
    ).rejects.toThrow(NotFoundException);
  });

  // ---- Deactivation ----------------------------------------------------------

  it('keeps a deactivated account readable but no longer primary', async () => {
    const a = await add({ accountNo: '0001' });
    expect(a.isPrimary).toBe(true);

    await asUser(ids.companyA, () => accounts.deactivate(a.id));

    const list = await asUser(ids.companyA, () => accounts.list(ids.vendor));
    const found = list.find((x) => x.id === a.id)!;
    // Still listed, so a document or exported batch naming it stays legible; just not selectable
    // and never the default payee again.
    expect(found.isActive).toBe(false);
    expect(found.isPrimary).toBe(false);
  });

  it('refuses to make a deactivated account primary', async () => {
    const a = await add({ accountNo: '0001' });
    await asUser(ids.companyA, () => accounts.deactivate(a.id));

    await expect(asUser(ids.companyA, () => accounts.setPrimary(a.id))).rejects.toThrow(
      ConflictException,
    );
  });
});
