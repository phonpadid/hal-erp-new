import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { AccountRoleType, AccountType, DocCategory, TaxKind } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Account } from '../accounting/accounting.entities';
import { Currency } from '../currency/currency.entities';
import { Document, DocumentType, FormTemplate } from '../document/document.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { TaxCode } from '../tax/tax.entities';
import { Workflow } from '../approval/approval.entities';
import { requiredAccountRoles } from './account-role-requirements';
import { AccountRoleService } from './account-role.service';
import { AccountRole, JournalEntry } from './gl.entities';
import { BudgetTxn } from '../budget/budget.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * Which account plays each system role, and which roles a company actually needs.
 *
 * A live company reached production with none of these mapped and every payment posting parked,
 * because nothing in the product could record one and the go-live check never asked. These cover
 * both halves: what a company is told it needs, and what it is allowed to answer with.
 */
describe.skipIf(!hasDb)('account role configuration (DB-backed)', () => {
  let orm: MikroORM;
  let roles: AccountRoleService;
  const ids = { company: '', other: '', cash: '', header: '', inactive: '', otherAccount: '' };
  let seq = 0;

  const asCompany = <T>(fn: () => Promise<T>, companyId = ids.company): Promise<T> =>
    RequestContext.run({ userId: 'u', companyId, departmentId: 'd', grants: [] }, fn);

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const lak = em.create(Currency, { code: 'LAK', name: 'Kip', decimalPlaces: 0, isActive: true });
    em.create(Currency, { code: 'USD', name: 'Dollar', decimalPlaces: 2, isActive: true });
    const company = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: lak, isActive: true });
    const other = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', baseCurrency: lak, isActive: true });

    const cash = em.create(Account, { company, code: '1010', name: 'Cash Clearing', accountType: AccountType.ASSET, isPostable: true, isActive: true });
    const header = em.create(Account, { company, code: '1000', name: 'Assets', accountType: AccountType.ASSET, isPostable: false, isActive: true });
    const inactive = em.create(Account, { company, code: '1011', name: 'Old Cash', accountType: AccountType.ASSET, isPostable: true, isActive: false });
    const otherAccount = em.create(Account, { company: other, code: '1010', name: 'Their Cash', accountType: AccountType.ASSET, isPostable: true, isActive: true });

    await em.flush();
    Object.assign(ids, {
      company: company.id, other: other.id, cash: cash.id, header: header.id,
      inactive: inactive.id, otherAccount: otherAccount.id,
    });
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  beforeEach(() => {
    roles = new AccountRoleService(orm.em);
  });

  /** A document type on the company under test, configured however the case needs. */
  async function docType(over: Record<string, unknown>): Promise<DocumentType> {
    const em = orm.em.fork();
    const t = em.create(DocumentType, {
      company: em.getReference(Company, ids.company),
      code: `T${seq++}`, name: 'T', category: DocCategory.FINANCE,
      requiresBudget: false, requiresQuota: false, isActive: true,
      ...over,
    } as never);
    await em.flush();
    return t;
  }

  const requiredFor = async () => {
    const em = orm.em.fork();
    const company = await em.findOneOrFail(Company, { id: ids.company }, { ...FILTER_OFF, populate: ['baseCurrency'] });
    return requiredAccountRoles(em, company);
  };

  // ---- What a company is told it needs ---------------------------------------

  it('asks for nothing before anything is configured', async () => {
    // Fourteen roles exist. A checklist that names all of them is one people skim, and a skimmed
    // checklist is how a company reached production with none of them mapped.
    expect([...(await requiredFor())]).toEqual([]);
  });

  it('asks for a clearing account once a type settles payments', async () => {
    await docType({ postAction: 'CUT_BUDGET' });
    expect(await requiredFor()).toContain(AccountRoleType.CASH_CLEARING);
  });

  it('asks for the payable roles only where a type accrues at approval', async () => {
    const before = await requiredFor();
    expect(before.has(AccountRoleType.ACCOUNTS_PAYABLE)).toBe(false);

    await docType({ accruesOnApproval: true });
    const after = await requiredFor();
    expect(after).toContain(AccountRoleType.ACCOUNTS_PAYABLE);
    expect(after).toContain(AccountRoleType.CLAIM_PAYABLE);
    expect(after).toContain(AccountRoleType.GRNI);
  });

  it('asks for the inventory roles only where a type moves stock', async () => {
    const before = await requiredFor();
    expect(before.has(AccountRoleType.INVENTORY)).toBe(false);

    await docType({ postAction: 'ISSUE_STOCK' });
    const after = await requiredFor();
    expect(after).toContain(AccountRoleType.INVENTORY);
    expect(after).toContain(AccountRoleType.INVENTORY_ADJUSTMENT);
  });

  it('asks for a VAT account only where a VAT code exists', async () => {
    const before = await requiredFor();
    expect(before.has(AccountRoleType.VAT_INPUT)).toBe(false);

    const em = orm.em.fork();
    em.create(TaxCode, { company: em.getReference(Company, ids.company), code: 'VAT10', name: 'VAT 10%', kind: TaxKind.VAT, rate: '0.10', isActive: true });
    await em.flush();

    expect(await requiredFor()).toContain(AccountRoleType.VAT_INPUT);
  });

  it('asks for FX accounts only once a genuinely foreign document exists', async () => {
    // A document in the company's own base currency is not evidence of anything: its rate is 1 and
    // its FX delta can only ever be zero.
    const em = orm.em.fork();
    const dept = em.create(Department, { company: em.getReference(Company, ids.company), deptCode: 'D', name: 'D', isActive: true });
    const wf = em.create(Workflow, { company: em.getReference(Company, ids.company), name: 'W', isActive: true });
    const user = em.create(AppUser, { username: `u${seq++}`, email: `u${seq}@x`, status: 'ACTIVE' });
    const type = await docType({});
    const tmpl = em.create(FormTemplate, { documentType: em.getReference(DocumentType, type.id), version: 1, status: 'PUBLISHED' });
    await em.flush();

    const base = em.create(Document, {
      docNo: `L-${seq++}`, company: em.getReference(Company, ids.company), department: dept,
      documentType: em.getReference(DocumentType, type.id), formTemplate: tmpl, workflow: wf,
      createdBy: user, currency: em.getReference(Currency, 'LAK'), createdAt: new Date(),
    } as never);
    await em.flush();
    expect((await requiredFor()).has(AccountRoleType.FX_GAIN)).toBe(false);

    base.currency = em.getReference(Currency, 'USD');
    await em.flush();
    const after = await requiredFor();
    expect(after).toContain(AccountRoleType.FX_GAIN);
    expect(after).toContain(AccountRoleType.FX_LOSS);
  });

  // ---- Reading and recording ------------------------------------------------

  it('lists every role the system resolves, mapped or not', async () => {
    // The complete list, because the reader's question is "what is missing" and a list of what
    // exists cannot answer it.
    const listed = await asCompany(() => roles.list());
    expect(listed.length).toBe(Object.keys(AccountRoleType).length);
    expect(listed.every((r) => r.purpose.length > 0)).toBe(true);
    expect(listed.find((r) => r.role === AccountRoleType.CASH_CLEARING)?.account).toBeUndefined();
  });

  it('records a mapping and reads it back', async () => {
    const set = await asCompany(() => roles.set(AccountRoleType.CASH_CLEARING, ids.cash));
    expect(set.account?.code).toBe('1010');

    const listed = await asCompany(() => roles.list());
    expect(listed.find((r) => r.role === AccountRoleType.CASH_CLEARING)?.account?.id).toBe(ids.cash);
    // And the resolver — the thing that was failing — now answers.
    expect((await roles.resolve(ids.company, AccountRoleType.CASH_CLEARING)).code).toBe('1010');
  });

  it('replaces a mapping rather than adding a second one', async () => {
    // Two mappings for one role would leave `resolve` picking between them, and which it picked
    // would decide where money posted.
    const em = orm.em.fork();
    const second = em.create(Account, { company: em.getReference(Company, ids.company), code: `10${seq++}`, name: 'Other Clearing', accountType: AccountType.ASSET, isPostable: true, isActive: true });
    await em.flush();

    await asCompany(() => roles.set(AccountRoleType.CASH_CLEARING, ids.cash));
    await asCompany(() => roles.set(AccountRoleType.CASH_CLEARING, second.id));

    const rows = await orm.em.fork().find(AccountRole, { company: ids.company, role: AccountRoleType.CASH_CLEARING }, FILTER_OFF);
    expect(rows).toHaveLength(1);
    expect(rows[0].account.id).toBe(second.id);
  });

  it('refuses another company’s account', async () => {
    await expect(
      asCompany(() => roles.set(AccountRoleType.FX_GAIN, ids.otherAccount)),
    ).rejects.toThrow(/not found/i);
  });

  it('refuses an inactive account, naming why', async () => {
    await expect(
      asCompany(() => roles.set(AccountRoleType.FX_GAIN, ids.inactive)),
    ).rejects.toThrow(/inactive/i);
  });

  it('refuses a header account, naming why', async () => {
    // It would resolve and then fail at the first entry that touched it — the same silence, one
    // level deeper.
    await expect(
      asCompany(() => roles.set(AccountRoleType.FX_GAIN, ids.header)),
    ).rejects.toThrow(/header account/i);
  });

  it('refuses a role the system does not resolve', async () => {
    await expect(
      asCompany(() => roles.set('NOT_A_ROLE' as AccountRoleType, ids.cash)),
    ).rejects.toThrow(/NOT_A_ROLE/);
  });

  it('writes no ledger row when a role is mapped', async () => {
    // Mapping only makes a future posting resolvable; it settles nothing and spends nothing.
    const before = {
      entries: await orm.em.fork().count(JournalEntry, {}, FILTER_OFF),
      txns: await orm.em.fork().count(BudgetTxn, {}, FILTER_OFF),
    };
    await asCompany(() => roles.set(AccountRoleType.VAT_INPUT, ids.cash));
    expect(await orm.em.fork().count(JournalEntry, {}, FILTER_OFF)).toBe(before.entries);
    expect(await orm.em.fork().count(BudgetTxn, {}, FILTER_OFF)).toBe(before.txns);
  });

  it('shows one company only its own mappings', async () => {
    await asCompany(() => roles.set(AccountRoleType.CASH_CLEARING, ids.cash));
    const theirs = await asCompany(() => roles.list(), ids.other);
    expect(theirs.find((r) => r.role === AccountRoleType.CASH_CLEARING)?.account).toBeUndefined();
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[account-role-config] no database reachable — skipping DB-backed spec');
}
