import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DocCategory } from '../../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../../test/test-orm';
import { Workflow } from '../../approval/approval.entities';
import { CompanyScopeService } from '../../../common/scope/company-scope.service';
import { AccountService } from '../../accounting/account.service';
import { BudgetBalanceService } from '../budget-balance.service';
import { BudgetService } from '../budget.service';
import { Currency } from '../../currency/currency.entities';
import { DeptDocTypeService } from '../../document/dept-doc-type.service';
import { DeptDocType, DocumentType, FormTemplate } from '../../document/document.entities';
import { NumberingService } from '../../document/numbering.service';
import { Company, Department, FiscalYear } from '../../multi-company/multi-company.entities';
import { AppUser } from '../../rbac/rbac.entities';
import { Budget, BudgetControlPoint, BudgetNode, BudgetTxn } from '../budget.entities';
import { BudgetCoverageService } from '../budget-coverage.service';
import { BudgetPlanService } from '../budget-plan.service';
import { PlanImportService } from './plan-import.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const FILTER_OFF = { filters: { company: false } } as const;
const WORKBOOK = resolve(
  __dirname,
  '../../../../../data/budget/8ໂມງ48-16-6- 2026 Monitoring budgetplan 2026 30-6-2026 (5).xlsx',
);
const hasDb = await dbAvailable();
const hasFile = existsSync(WORKBOOK);
const canRun = hasDb && hasFile;

describe.skipIf(!canRun)('budget plan import: what it needs before it starts (DB-backed)', () => {
  let orm: MikroORM;
  let service: PlanImportService;

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const company = em.create(Company, { code: 'BARE', nameTh: 'Bare', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true });
    em.create(FiscalYear, { company, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    em.create(AppUser, { username: 'u', email: 'u@x', status: 'ACTIVE' });
    await em.flush();
    service = new PlanImportService(orm.em, {} as never);
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  it('refuses an unknown company by name', async () => {
    await expect(
      service.import({ companyCode: 'NOPE', year: 2026, file: WORKBOOK }),
    ).rejects.toThrow(/'NOPE' does not exist/);
  });

  it('refuses a fiscal year the company does not have', async () => {
    await expect(
      service.import({ companyCode: 'BARE', year: 2099, file: WORKBOOK }),
    ).rejects.toThrow(/no fiscal year 2099/);
  });

  it('refuses a company with no budget-plan document type', async () => {
    await expect(
      service.import({ companyCode: 'BARE', year: 2026, file: WORKBOOK, dryRun: true }),
    ).rejects.toThrow(/post action ACTIVATE_BUDGET/);
  });

  it('refuses a company with no active workflow rather than inventing one', async () => {
    // An approval route decides who may approve a budget. An importer must not decide that.
    const em = orm.em.fork();
    const company = await em.findOneOrFail(Company, { code: 'BARE' }, FILTER_OFF);
    const dt = em.create(DocumentType, {
      company, code: 'BUDGET_PLAN', name: 'Budget Plan', category: DocCategory.FINANCE,
      postAction: 'ACTIVATE_BUDGET', requiresBudget: false, requiresQuota: false, isActive: true,
    });
    em.create(FormTemplate, { documentType: dt, version: 1, status: 'PUBLISHED' });
    await em.flush();

    await expect(
      service.import({ companyCode: 'BARE', year: 2026, file: WORKBOOK, dryRun: true }),
    ).rejects.toThrow(/no active workflow/i);
  });
});

describe.skipIf(!canRun)('budget plan import (DB-backed)', () => {
  let orm: MikroORM;
  let service: PlanImportService;
  let coverage: BudgetCoverageService;

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'LAK', name: 'Kip', decimalPlaces: 0, isActive: true });
    const company = em.create(Company, { code: 'PLANCO', nameTh: 'Plan Co', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true });
    const other = em.create(Company, { code: 'OTHER', nameTh: 'Other', taxId: '2', branchCode: '00000', baseCurrency: thb, isActive: true });
    em.create(FiscalYear, { company: other, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    em.create(FiscalYear, { company, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const dt = em.create(DocumentType, {
      company, code: 'BUDGET_PLAN', name: 'Budget Plan', category: DocCategory.FINANCE,
      postAction: 'ACTIVATE_BUDGET', requiresBudget: false, requiresQuota: false, isActive: true,
    });
    em.create(FormTemplate, { documentType: dt, version: 1, status: 'PUBLISHED' });
    em.create(Workflow, { company, name: 'Standard Approval', isActive: true });
    em.create(AppUser, { username: 'importer', email: 'i@x', status: 'ACTIVE' });
    await em.flush();

    const scope = new CompanyScopeService(orm.em);
    coverage = new BudgetCoverageService(orm.em);
    const plans = new BudgetPlanService(
      orm.em,
      new DeptDocTypeService(orm.em),
      new NumberingService(orm.em),
      coverage,
      new BudgetService(orm.em, new AccountService(orm.em, scope), new BudgetBalanceService(orm.em)),
    );
    void scope;
    service = new PlanImportService(orm.em, plans);
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  const settledWorkbook = WORKBOOK;

  /**
   * A small plan of the same SHAPE as the customer's, written here so the happy path can be
   * exercised at all: their own workbook is refused while `3.1` is stated twice, and will be until
   * somebody settles it.
   *
   *   1  Admin            600  (a summary of its lines)
   *   1.1  General        200  (a summary of 1.101 + 1.102)
   *   1.101  Supplies     120
   *   1.102  Water         80
   *   1.2  Rent           400
   *   ── ລວມ ຍອດ ມີງົບ ──
   *   2  Contingency      500  ← unbudgeted section
   *   2.1  Maybe          500
   *   ── ລວມ ຍອດ ບໍ່ມີງົບ ──
   */
  async function miniWorkbook(): Promise<string> {
    const XLSX = await import('xlsx');
    const { writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = resolve(tmpdir(), 'mini-plan.xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['ຕິດຕາມ ງົບປະມານລາຍຈ່າຍ'],
        ['', 'ລະຫັດ', 'ລາຍການແຕ່ລະຂະແໜງ', 'ງົບປະມານ/2024', 'ງົບປະມານ/ປີ2026'],
        ['', '1', 'Admin', 111, 600],
        ['', '1.1', 'General', null, 200],
        ['', '1.101', 'Supplies', null, 120],
        ['', '1.102', 'Water', null, 80],
        ['', '1.2', 'Rent', null, 400],
        ['', 'I ລວມ ຍອດ ມີງົບ', '', null, 600],
        ['', '2', 'Contingency', null, 500],
        ['', '2.1', 'Maybe', null, 500],
        ['', 'II ລວມ ຍອດ ບໍ່ມີງົບ', '', null, 500],
      ]),
      'ສາລະບານງົບປະມານ',
    );
    writeFileSync(path, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    return path;
  }

  it('reads the customer workbook end to end, reporting the duplicate rather than stopping', async () => {
    const res = await service.import({
      companyCode: 'PLANCO',
      year: 2026,
      file: settledWorkbook,
      dryRun: true,
    });
    expect(res.plan.duplicates.map((d) => d.code)).toEqual(['3.1']);
    expect(res.plan.nodes.length).toBeGreaterThan(500);
    expect(res.budgetsCreated).toBeGreaterThan(200);
  });

  it('writes nothing on a dry run', async () => {
    const em = orm.em.fork();
    expect(await em.count(Department, { company: { code: 'PLANCO' } }, FILTER_OFF)).toBe(0);
    expect(await em.count(BudgetNode, {}, FILTER_OFF)).toBe(0);
    expect(await em.count(Budget, {}, FILTER_OFF)).toBe(0);
  });

  it('leaves the other company alone', async () => {
    const em = orm.em.fork();
    expect(await em.count(Department, { company: { code: 'OTHER' } }, FILTER_OFF)).toBe(0);
  });

  it('never writes a budget_txn row', async () => {
    // Activation moves no money: a budget's opening figure is `amount_total`, not a transaction
    // (invariant 3). Asserted here so the import can never grow one by accident.
    const em = orm.em.fork();
    expect(await em.count(BudgetTxn, {}, FILTER_OFF)).toBe(0);
  });

  it('has no control point of its own making before any run', async () => {
    const em = orm.em.fork();
    expect(await em.count(BudgetControlPoint, {}, FILTER_OFF)).toBe(0);
  });

  // ---- the happy path, on a plan of the same shape ----------------------------------------

  it('imports a plan: departments under one parent, nodes, budgets, all ACTIVE', async () => {
    const file = await miniWorkbook();
    const res = await service.import({ companyCode: 'PLANCO', year: 2026, file });

    // Four: 1.101, 1.102 and 1.2 with their money, plus 2.1 created at zero because the workbook's
    // own subtotal puts it in the unbudgeted section.
    expect(res.budgetsCreated).toBe(4);
    expect(res.budgetsUnchanged).toBe(0);
    expect(res.planDocumentIds.length).toBeGreaterThan(0);
    const em = orm.em.fork();
    const depts = await em.find(Department, { company: { code: 'PLANCO' } }, { ...FILTER_OFF, populate: ['parentDept'] });
    const byCode = new Map(depts.map((d) => [d.deptCode, d]));
    expect(byCode.get('1')?.parentDept?.deptCode).toBe('PLAN');
    expect(byCode.get('2')?.parentDept?.deptCode).toBe('PLAN');
    expect(byCode.get('PLAN')?.parentDept ?? null).toBeNull();
  });

  it('gives money only to the rows that hold it', async () => {
    const em = orm.em.fork();
    const budgets = await em.find(Budget, {}, { ...FILTER_OFF, populate: ['node', 'department'] });
    const byCode = new Map(budgets.map((b) => [b.node.code, b]));
    // `1` and `1.1` are summaries of what lies beneath and hold nothing of their own.
    expect(byCode.has('1')).toBe(false);
    expect(byCode.has('1.1')).toBe(false);
    // Stored as DECIMAL, so compared as decimals rather than as strings.
    expect(Number(byCode.get('1.101')?.amountTotal)).toBe(120);
    expect(Number(byCode.get('1.102')?.amountTotal)).toBe(80);
    expect(Number(byCode.get('1.2')?.amountTotal)).toBe(400);
  });

  it('names every budget it creates', async () => {
    const em = orm.em.fork();
    const budgets = await em.find(Budget, {}, { ...FILTER_OFF, populate: ['node'] });
    expect(budgets.length).toBeGreaterThan(0);
    expect(budgets.every((b) => !!b.budgetName)).toBe(true);
    expect(budgets.find((b) => b.node.code === '1.101')?.budgetName).toBe('Supplies');
  });

  it('fills a name a previous run left empty, without touching one that is set', async () => {
    const em = orm.em.fork();
    const target = await em.findOneOrFail(Budget, { node: { code: '1.102' } }, FILTER_OFF);
    const kept = await em.findOneOrFail(Budget, { node: { code: '1.2' } }, FILTER_OFF);
    target.budgetName = undefined;
    kept.budgetName = 'Corrected by a human';
    await em.flush();

    await service.import({ companyCode: 'PLANCO', year: 2026, file: await miniWorkbook() });

    const after = orm.em.fork();
    expect((await after.findOneOrFail(Budget, { node: { code: '1.102' } }, FILTER_OFF)).budgetName).toBe('Water');
    expect((await after.findOneOrFail(Budget, { node: { code: '1.2' } }, FILTER_OFF)).budgetName).toBe('Corrected by a human');
  });

  it('zeroes the unbudgeted section', () => {
    // Stated 500 in the workbook, created at 0: the file's own subtotal calls it unbudgeted.
    return orm.em
      .fork()
      .find(Budget, {}, { ...FILTER_OFF, populate: ['node'] })
      .then((budgets) => {
        const un = budgets.find((b) => b.node.code === '2.1');
        expect(Number(un?.amountTotal)).toBe(0);
      });
  });

  it('activates every budget and has each governed by a control point', async () => {
    const em = orm.em.fork();
    const budgets = await em.find(Budget, {}, FILTER_OFF);
    expect(budgets.length).toBeGreaterThan(0);
    expect(budgets.every((b) => b.status === 'ACTIVE')).toBe(true);
    for (const b of budgets) {
      expect((await coverage.controlPointsFor(b.id)).length).toBeGreaterThan(0);
    }
  });

  it('counts a subtree once, so no ceiling is doubled', async () => {
    // `1.1` states 200 and its lines state 120 + 80. Had both become budgets, a point over `1.1`
    // would cap at 400 — twice the money that exists, and nothing would look wrong.
    const em = orm.em.fork();
    const node = await em.findOneOrFail(BudgetNode, { code: '1.1' }, FILTER_OFF);
    const governed = await em.find(Budget, { node: { $in: [node.id] } }, FILTER_OFF);
    expect(governed).toHaveLength(0);
    const lines = await em.find(Budget, {}, { ...FILTER_OFF, populate: ['node'] });
    const under11 = lines.filter((b) => b.node.code.startsWith('1.10'));
    const sum = under11.reduce((s, b) => s + Number(b.amountTotal), 0);
    expect(sum).toBe(200);
  });

  it('creates the routing mapping the plan document needs', async () => {
    const em = orm.em.fork();
    const parent = await em.findOneOrFail(Department, { company: { code: 'PLANCO' }, deptCode: 'PLAN' }, FILTER_OFF);
    const mapping = await em.findOne(
      DeptDocType,
      { department: parent.id, documentType: { code: 'BUDGET_PLAN' } },
      FILTER_OFF,
    );
    expect(mapping).not.toBeNull();
  });

  it('reports from a dry run what the real run then reports', async () => {
    // A preview that counts differently from the run it previews is worse than no preview.
    const file = await miniWorkbook();
    const em = orm.em.fork();
    const company = em.create(Company, { code: 'DRYCO', nameTh: 'Dry', taxId: '7', branchCode: '00000', isActive: true });
    em.create(FiscalYear, { company, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const dt = em.create(DocumentType, {
      company, code: 'BUDGET_PLAN', name: 'Budget Plan', category: DocCategory.FINANCE,
      postAction: 'ACTIVATE_BUDGET', requiresBudget: false, requiresQuota: false, isActive: true,
    });
    em.create(FormTemplate, { documentType: dt, version: 1, status: 'PUBLISHED' });
    em.create(Workflow, { company, name: 'Standard Approval', isActive: true });
    await em.flush();

    const dry = await service.import({ companyCode: 'DRYCO', year: 2026, file, dryRun: true });
    expect(await orm.em.fork().count(Budget, { fiscalYear: { company: company.id } }, FILTER_OFF)).toBe(0);

    const real = await service.import({ companyCode: 'DRYCO', year: 2026, file });
    expect(real.budgetsCreated).toBe(dry.budgetsCreated);
    expect(real.budgetsTotal).toBe(dry.budgetsTotal);
    expect(real.departmentsCreated).toEqual(dry.departmentsCreated);
    expect(real.plan.conflicts).toEqual(dry.plan.conflicts);
  });

  it('leaves no department, node or budget when the write fails part-way', async () => {
    // The departments, nodes and budgets are written in one transaction; the plans are raised
    // after it, because `BudgetPlanService` opens transactions of its own. This asserts the first
    // half is all-or-nothing — a company left holding 20 departments and 552 nodes with no budgets
    // would look imported and be useless, and the re-run would find the nodes present and create
    // nothing.
    const file = await miniWorkbook();
    const em = orm.em.fork();
    const thb = await em.findOneOrFail(Currency, { code: 'LAK' }, FILTER_OFF);
    const company = em.create(Company, { code: 'ATOMICO', nameTh: 'Atomic', taxId: '8', branchCode: '00000', baseCurrency: thb, isActive: true });
    em.create(FiscalYear, { company, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const dt = em.create(DocumentType, {
      company, code: 'BUDGET_PLAN', name: 'Budget Plan', category: DocCategory.FINANCE,
      postAction: 'ACTIVATE_BUDGET', requiresBudget: false, requiresQuota: false, isActive: true,
    });
    em.create(FormTemplate, { documentType: dt, version: 1, status: 'PUBLISHED' });
    em.create(Workflow, { company, name: 'Standard Approval', isActive: true });
    await em.flush();

    const boom = new Error('injected failure inside the write transaction');
    const proxied = new Proxy(orm.em, {
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

    await expect(
      new PlanImportService(proxied, {} as never).import({ companyCode: 'ATOMICO', year: 2026, file }),
    ).rejects.toThrow(/injected failure/);

    const after = orm.em.fork();
    expect(await after.count(Department, { company: { code: 'ATOMICO' } }, FILTER_OFF)).toBe(0);
    expect(await after.count(Budget, { fiscalYear: { company: { code: 'ATOMICO' } } }, FILTER_OFF)).toBe(0);
  });

  it('creates nothing on a second run', async () => {
    const file = await miniWorkbook();
    const em = orm.em.fork();
    // Scoped to this company: another test's company has budgets of its own in the same database.
    const before = await em.count(Budget, { fiscalYear: { company: { code: 'PLANCO' } } }, FILTER_OFF);
    const beforeDepts = await em.count(Department, { company: { code: 'PLANCO' } }, FILTER_OFF);
    const again = await service.import({ companyCode: 'PLANCO', year: 2026, file });
    expect(again.budgetsCreated).toBe(0);
    expect(again.budgetsUnchanged).toBe(before);
    expect(
      await orm.em.fork().count(Budget, { fiscalYear: { company: { code: 'PLANCO' } } }, FILTER_OFF),
    ).toBe(before);
    expect(await orm.em.fork().count(Department, { company: { code: 'PLANCO' } }, FILTER_OFF)).toBe(beforeDepts);
  });
});

if (!canRun) {
  // eslint-disable-next-line no-console
  console.warn('[plan-import] no database or no workbook — skipping import spec');
}
