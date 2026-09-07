import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MikroORM } from '@mikro-orm/postgresql';
import { AccountRoleType, AccountType, DocCategory } from '../../src/common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../src/test/test-orm';
import { ExchangeRateService } from '../../src/modules/currency/exchange-rate.service';
import { Currency, ExchangeRate } from '../../src/modules/currency/currency.entities';
import { Company, Department } from '../../src/modules/multi-company/multi-company.entities';
import { Account } from '../../src/modules/accounting/accounting.entities';
import { AccountRole } from '../../src/modules/gl/gl.entities';
import { Role } from '../../src/modules/rbac/rbac.entities';
import { AppUser } from '../../src/modules/rbac/rbac.entities';
import { Workflow, WorkflowStep } from '../../src/modules/approval/approval.entities';
import {
  DeptDocType,
  Document,
  DocumentType,
  FormTemplate,
} from '../../src/modules/document/document.entities';
import { countUnraisableTypes, inspect, type Finding } from './inspect';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * `inspect` is the question list this whole change exists to produce, so each finding is asserted
 * against a fixture built to be in exactly that state — and a company in none of them must report
 * nothing, because a check that always finds something is a check people learn to ignore.
 */
describe.skipIf(!hasDb)('golive inspect (DB-backed)', () => {
  let orm: MikroORM;
  let rates: ExchangeRateService;

  /** Findings for one company, by kind — every assertion below is about a single company. */
  const kinds = (reports: Awaited<ReturnType<typeof inspect>>, code: string): Finding[] =>
    reports.find((r) => r.company === code)?.findings ?? [];

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    rates = new ExchangeRateService(orm.em);

    const em = orm.em.fork();
    const lak = em.create(Currency, { code: 'LAK', name: 'Kip', decimalPlaces: 0, isActive: true });
    const usd = em.create(Currency, { code: 'USD', name: 'Dollar', decimalPlaces: 2, isActive: true });

    // ---- OK: a company with nothing wrong. Its silence is the control for every other case.
    const ok = em.create(Company, { code: 'OK', nameTh: 'OK', taxId: '1', branchCode: '00000', baseCurrency: lak, isActive: true });
    const okDept = em.create(Department, { company: ok, deptCode: 'D1', name: 'D1', isActive: true });
    const okRole = em.create(Role, { company: ok, code: 'APPROVER', name: 'Approver', isActive: true });
    const okWf = em.create(Workflow, { company: ok, name: 'OK chain', isActive: true });
    em.create(WorkflowStep, { workflow: okWf, stepNo: 1, approverRole: okRole, approvalType: 'SEQUENTIAL' });
    const okType = em.create(DocumentType, { company: ok, code: 'MEMO', name: 'Memo', category: DocCategory.ADMIN, requiresBudget: false, requiresQuota: false, isActive: true });
    const okTmpl = em.create(FormTemplate, { documentType: okType, version: 1, status: 'PUBLISHED' });
    em.create(DeptDocType, { department: okDept, documentType: okType, formTemplate: okTmpl, workflow: okWf, isActive: true });

    // ---- BAD: one company holding one of every finding.
    const bad = em.create(Company, { code: 'BAD', nameTh: 'BAD', taxId: '2', branchCode: '00000', baseCurrency: lak, isActive: true });
    const badDept = em.create(Department, { company: bad, deptCode: 'D2', name: 'D2', isActive: true });
    const person = em.create(AppUser, { username: 'somchai', email: 's@x', status: 'ACTIVE' });

    // UNMAPPED_TYPE: active, no dept_doc_type at all.
    em.create(DocumentType, { company: bad, code: 'RECWH', name: 'Withdrawal', category: DocCategory.FINANCE, requiresBudget: true, requiresQuota: false, isActive: true });
    // An INACTIVE type is not a finding — nobody is waiting on a decision about it.
    em.create(DocumentType, { company: bad, code: 'RETIRED', name: 'Retired', category: DocCategory.ADMIN, requiresBudget: false, requiresQuota: false, isActive: false });

    // PERSON_TARGETED_WORKFLOW + UNPUBLISHED_TEMPLATE: mapped, but the form is a draft and the
    // chain routes only through one named human.
    const badWf = em.create(Workflow, { company: bad, name: 'Named chain', isActive: true });
    em.create(WorkflowStep, { workflow: badWf, stepNo: 1, approverUser: person, approvalType: 'SEQUENTIAL' });
    const draftType = em.create(DocumentType, { company: bad, code: 'RECAD', name: 'Advance', category: DocCategory.FINANCE, requiresBudget: true, requiresQuota: false, isActive: true });
    const draftTmpl = em.create(FormTemplate, { documentType: draftType, version: 1, status: 'DRAFT' });
    em.create(DeptDocType, { department: badDept, documentType: draftType, formTemplate: draftTmpl, workflow: badWf, isActive: true });

    // MISSING_AUTHORING_ROUTE: content lives on budget_movement, no screen named.
    em.create(DocumentType, { company: bad, code: 'BUDMOV', name: 'Movement', category: DocCategory.FINANCE, postAction: 'ADJUST_INCREASE', requiresBudget: false, requiresQuota: false, isActive: true });

    // UNRESOLVABLE_CURRENCY: a USD document exists and no USD->LAK rate is on file.
    em.create(Document, {
      company: bad, department: badDept, documentType: draftType, formTemplate: draftTmpl,
      docNo: 'RECAD-BAD-2026-0001', status: 'DRAFT', currency: usd, workflow: badWf,
      createdBy: person, createdAt: new Date(),
    } as never);

    await em.flush();
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  it('reports nothing for a company in none of the states', async () => {
    const reports = await inspect(orm.em.fork(), rates);
    expect(kinds(reports, 'OK')).toEqual([]);
  });

  it('names an active type no department maps', async () => {
    const found = kinds(await inspect(orm.em.fork(), rates), 'BAD')
      .filter((f) => f.kind === 'UNMAPPED_TYPE');
    // BUDMOV is here too, and correctly: it is unmapped AND names no screen. They are two separate
    // decisions, so they are two findings rather than one that hides the other.
    expect(found.map((f) => f.subject)).toEqual(['BUDMOV', 'RECWH']);
    expect(found.find((f) => f.subject === 'RECWH')?.detail).toContain('nobody can raise one');
  });

  it('does not report an inactive type', async () => {
    const subjects = kinds(await inspect(orm.em.fork(), rates), 'BAD').map((f) => f.subject);
    expect(subjects).not.toContain('RETIRED');
  });

  it('names a mapping whose form template is still a draft', async () => {
    const found = kinds(await inspect(orm.em.fork(), rates), 'BAD')
      .filter((f) => f.kind === 'UNPUBLISHED_TEMPLATE');
    expect(found).toHaveLength(1);
    expect(found[0].subject).toBe('RECAD/D2');
    expect(found[0].detail).toContain('DRAFT');
  });

  it('names a workflow whose every step is an individual', async () => {
    const found = kinds(await inspect(orm.em.fork(), rates), 'BAD')
      .filter((f) => f.kind === 'PERSON_TARGETED_WORKFLOW');
    expect(found.map((f) => f.subject)).toEqual(['Named chain']);
    // The person is named, because "which chain, and who" is the question being put to the customer.
    expect(found[0].detail).toContain('somchai');
  });

  it('does not report a workflow that reaches a role', async () => {
    const found = kinds(await inspect(orm.em.fork(), rates), 'OK')
      .filter((f) => f.kind === 'PERSON_TARGETED_WORKFLOW');
    expect(found).toEqual([]);
  });

  it('names a currency an existing document uses and no rate resolves', async () => {
    const found = kinds(await inspect(orm.em.fork(), rates), 'BAD')
      .filter((f) => f.kind === 'UNRESOLVABLE_CURRENCY');
    expect(found.map((f) => f.subject)).toEqual(['USD->LAK']);
    expect(found[0].detail).toContain('refused at submit');
  });

  it('stops reporting that currency once a rate is on file', async () => {
    const em = orm.em.fork();
    em.create(ExchangeRate, {
      fromCurrency: 'USD', toCurrency: 'LAK', rate: '21000', rateDate: '2020-01-01',
      rateType: 'DAILY', company: null,
    } as never);
    await em.flush();
    try {
      const found = kinds(await inspect(orm.em.fork(), rates), 'BAD')
        .filter((f) => f.kind === 'UNRESOLVABLE_CURRENCY');
      expect(found).toEqual([]);
    } finally {
      // Left as it was found, so the order these run in cannot change what they assert.
      const em2 = orm.em.fork();
      await em2.nativeDelete(ExchangeRate, { fromCurrency: 'USD' });
    }
  });

  it('names an active type whose content lives elsewhere and names no screen', async () => {
    const found = kinds(await inspect(orm.em.fork(), rates), 'BAD')
      .filter((f) => f.kind === 'MISSING_AUTHORING_ROUTE');
    expect(found.map((f) => f.subject)).toEqual(['BUDMOV']);
  });

  it('narrows to one company when asked', async () => {
    const reports = await inspect(orm.em.fork(), rates, 'BAD');
    expect(reports.map((r) => r.company)).toEqual(['BAD']);
  });

  it('counts unraisable types per company, for the deploy line that never fails', async () => {
    const counts = await countUnraisableTypes(orm.em.fork());
    // OK has none; BAD has RECWH and BUDMOV. A company mid-rollout legitimately has these, which is
    // why boot-check prints this and exits zero rather than blocking a deploy on it.
    expect(counts).toEqual([['BAD', 2]]);
  });

  /**
   * The finding that did not exist while a live company's every payment posting sat parked. The
   * report is the list of decisions nobody has recorded, and "which account is the clearing
   * account" is exactly that.
   */
  it('names an account role the company needs and nothing maps', async () => {
    // BAD has a USD document against a LAK base, so a payment can settle at a rate other than the
    // one it locked and the difference has to land somewhere.
    const found = kinds(await inspect(orm.em.fork(), rates), 'BAD')
      .filter((f) => f.kind === 'UNMAPPED_ACCOUNT_ROLE');
    expect(found.map((f) => f.subject)).toEqual(['FX_GAIN', 'FX_LOSS']);
    // Named with what the role is FOR, because the reader has to choose an account for it.
    expect(found[0].detail).toContain('every posting');
  });

  it('does not name a role this company has no use for', async () => {
    // A checklist that asks for fourteen accounts nobody needs is one people learn to skim. BAD
    // has no stock-moving type, no accruing type, and nothing that settles a payment.
    const subjects = kinds(await inspect(orm.em.fork(), rates), 'BAD')
      .filter((f) => f.kind === 'UNMAPPED_ACCOUNT_ROLE')
      .map((f) => f.subject);
    expect(subjects).not.toContain('INVENTORY');
    expect(subjects).not.toContain('RETAINED_EARNINGS');
    expect(subjects).not.toContain('CASH_CLEARING');
  });

  it('stops naming a role once an active account is mapped to it', async () => {
    const em = orm.em.fork();
    const company = await em.findOneOrFail(Company, { code: 'BAD' }, FILTER_OFF);
    const account = em.create(Account, {
      company, code: '4900', name: 'FX Gain',
      accountType: AccountType.REVENUE, isPostable: true, isActive: true,
    } as never);
    em.create(AccountRole, { company, role: AccountRoleType.FX_GAIN, account } as never);
    await em.flush();

    try {
      const subjects = kinds(await inspect(orm.em.fork(), rates), 'BAD')
        .filter((f) => f.kind === 'UNMAPPED_ACCOUNT_ROLE')
        .map((f) => f.subject);
      expect(subjects).not.toContain('FX_GAIN');
      expect(subjects).toContain('FX_LOSS'); // the one still unanswered
    } finally {
      const cleanup = orm.em.fork();
      const row = await cleanup.findOne(AccountRole, { role: AccountRoleType.FX_GAIN }, FILTER_OFF);
      if (row) await cleanup.removeAndFlush(row);
      const acct = await cleanup.findOne(Account, { code: '4900' }, FILTER_OFF);
      if (acct) await cleanup.removeAndFlush(acct);
    }
  });

  it('writes nothing', async () => {
    const tables = [Company, Department, DocumentType, FormTemplate, DeptDocType, Workflow, WorkflowStep, Document, ExchangeRate, Role, AppUser, Currency, AccountRole, Account];
    const before = await Promise.all(tables.map((t) => orm.em.fork().count(t, {}, FILTER_OFF)));
    await inspect(orm.em.fork(), rates);
    const after = await Promise.all(tables.map((t) => orm.em.fork().count(t, {}, FILTER_OFF)));
    // Read-only is a property this pass is tested for, not one it merely intends to have: its
    // output is the question list to take to the customer, and asking must not answer anything.
    expect(after).toEqual(before);
  });
});
