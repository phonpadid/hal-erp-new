import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BudgetTxnType, DocCategory, DocStatus } from '../../../common/enums';
import { Money } from '../../../common/money/money';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../../test/test-orm';
import { Workflow } from '../../approval/approval.entities';
import { Currency } from '../../currency/currency.entities';
import { Document, DocumentLine, DocumentType, FormTemplate } from '../../document/document.entities';
import { NumberingService } from '../../document/numbering.service';
import { Company, Department, FiscalYear } from '../../multi-company/multi-company.entities';
import { AppUser } from '../../rbac/rbac.entities';
import { Budget, BudgetNode, BudgetTxn } from '../budget.entities';
import { BudgetBalanceService } from '../budget-balance.service';
import { BudgetCoverageService } from '../budget-coverage.service';
import { BudgetLedgerService } from '../budget-ledger.service';
import { DESCRIPTION_LIMIT, SpendImportService, SPEND_HISTORY_SOURCE } from './spend-import.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const FILTER_OFF = { filters: { company: false } } as const;
const hasDb = await dbAvailable();

/** A row of the monitoring sheet: day, month, plan code, description, kip. */
interface Row {
  day: number;
  month: number;
  code: string;
  department: string;
  description: string;
  kip: number;
  sequence?: string;
}

/**
 * A workbook shaped like the customer's, written to a temp file.
 *
 * Built rather than fixtured so a test can state the case it is about — a budget of 1,000,000
 * charged 250,000 — in three lines. The layout is the real one: the reader finds its columns from
 * the header labels, so a wrong shape here would fail loudly rather than pass by accident.
 */
function workbook(rows: Row[]): string {
  const header: unknown[] = [];
  header[2] = 'ເ';
  header[5] = 'D';
  header[7] = 'M';
  header[8] = 'Y';
  header[9] = 'CODE ພະແນກ';
  header[10] = 'CODE (.)';
  header[13] = 'ເປັນເງິນກີບ';
  header[14] = 'ກີບ';
  header[18] = 'ອັດຕາ\r\nແລກປຽນ';
  const aoa: unknown[][] = [[], [], [], header];
  for (const [i, r] of rows.entries()) {
    const cells: unknown[] = [];
    cells[2] = r.sequence ?? String(i + 1).padStart(5, '0');
    cells[5] = r.day;
    cells[7] = r.month;
    cells[8] = 2026;
    cells[9] = r.department;
    cells[10] = r.code;
    cells[13] = r.description;
    cells[14] = r.kip;
    cells[18] = 1;
    cells[19] = r.kip;
    aoa.push(cells);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'ຕິດຕາມງົບປະມານ');
  const path = join(mkdtempSync(join(tmpdir(), 'spend-import-')), 'monitoring.xlsx');
  XLSX.writeFile(wb, path);
  return path;
}

describe.skipIf(!hasDb)('spend history import (DB-backed)', () => {
  let orm: MikroORM;
  let service: SpendImportService;
  let balance: BudgetBalanceService;
  let coverage: BudgetCoverageService;
  let companyId: string;

  const build = async (): Promise<void> => {
    const em = orm.em.fork();
    const lak = em.create(Currency, { code: 'LAK', name: 'Kip', decimalPlaces: 2, isActive: true });
    const company = em.create(Company, {
      code: 'HAL',
      nameTh: 'HAL',
      taxId: '1',
      branchCode: '00000',
      baseCurrency: lak,
      isActive: true,
    });
    // A second company, so every write can be shown not to reach it.
    const other = em.create(Company, {
      code: 'OTHER',
      nameTh: 'Other',
      taxId: '2',
      branchCode: '00000',
      baseCurrency: lak,
      isActive: true,
    });
    const fy = em.create(FiscalYear, {
      company,
      year: 2026,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      status: 'OPEN',
    });
    em.create(FiscalYear, {
      company: other,
      year: 2026,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      status: 'OPEN',
    });
    const seven = em.create(Department, { company, deptCode: '7', name: 'ຂົນສົ່ງ', isActive: true });
    em.create(Department, { company, deptCode: '6', name: 'ໄອທີ', isActive: true });
    em.create(Department, { company, deptCode: '18', name: 'ລະບົບ', isActive: true });
    for (const code of ['7.301', '7.502', '18.101']) {
      em.create(BudgetNode, { fiscalYear: fy, code, name: `ລາຍການ ${code}` });
    }
    em.create(BudgetNode, { fiscalYear: fy, code: '9.101', name: 'ບໍ່ມີການໃຊ້ຈ່າຍ' });
    const docType = em.create(DocumentType, {
      company,
      code: 'SPEND_HIST',
      name: 'ປະຫວັດການໃຊ້ຈ່າຍ',
      category: DocCategory.FINANCE,
      isActive: true,
    } as never);
    em.create(FormTemplate, { documentType: docType, version: 1, status: 'PUBLISHED' });
    em.create(Workflow, { company, name: 'default', isActive: true } as never);
    em.create(AppUser, { username: 'importer', email: 'i@x', status: 'ACTIVE' });
    await em.flush();
    companyId = company.id;

    // The one budget every balance assertion is made against: 1,000,000 at 7.301.
    const em2 = orm.em.fork();
    const node = await em2.findOneOrFail(BudgetNode, { code: '7.301' }, FILTER_OFF);
    em2.create(Budget, {
      fiscalYear: em2.getReference(FiscalYear, fy.id),
      department: em2.getReference(Department, seven.id),
      node,
      budgetName: 'ຄ່າຂົນສົ່ງ',
      amountTotal: '1000000',
      status: 'ACTIVE',
    } as never);
    await em2.flush();
  };

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    coverage = new BudgetCoverageService(orm.em);
    balance = new BudgetBalanceService(orm.em);
    service = new SpendImportService(
      orm.em,
      new BudgetLedgerService(orm.em, balance, coverage),
      new NumberingService(orm.em),
      coverage,
    );
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  beforeEach(async () => {
    await orm.schema.refreshDatabase();
    await build();
  });

  const run = (file: string, over: Record<string, unknown> = {}) =>
    service.import({ companyCode: 'HAL', year: 2026, file, ...over });

  const budgetAt = async (code: string): Promise<Budget> => {
    const em = orm.em.fork();
    const node = await em.findOneOrFail(BudgetNode, { code }, FILTER_OFF);
    return em.findOneOrFail(Budget, { node: node.id }, { ...FILTER_OFF, populate: ['department'] });
  };

  /** Compare money by value, not by how many zeros the driver returned. */
  const expectMoney = (actual: string, expected: string) =>
    expect(Money.compare(actual, expected), `${actual} should equal ${expected}`).toBe(0);

  it('refuses an unknown company and an unknown fiscal year by name', async () => {
    const file = workbook([
      { day: 3, month: 3, code: '7.301', department: '7', description: 'a', kip: 1 },
    ]);
    await expect(run(file, { companyCode: 'NOPE' })).rejects.toThrow(/'NOPE' does not exist/);
    await expect(run(file, { year: 2099 })).rejects.toThrow(/no fiscal year 2099/);
  });

  it('reduces the budget by exactly what was spent', async () => {
    // The assertion the whole reserve/actual pair exists for. An ACTUAL alone leaves this at
    // 1,000,000; a RESERVE alone leaves it at 750,000 with the money still committed.
    const file = workbook([
      { day: 3, month: 3, code: '7.301', department: '7', description: 'ຄ່າແຮງ', kip: 250000 },
    ]);
    await run(file);
    const budget = await budgetAt('7.301');
    expectMoney(await balance.availableBalance(budget.id), '750000');
  });

  it('writes one RESERVE and one ACTUAL per document, and no RELEASE', async () => {
    const file = workbook([
      { day: 3, month: 3, code: '7.301', department: '7', description: 'a', kip: 100000 },
      { day: 9, month: 3, code: '7.301', department: '7', description: 'b', kip: 150000 },
    ]);
    const result = await run(file);
    expect(result.documentsCreated).toBe(1);
    expect(result.ledgerRows).toBe(2);
    const em = orm.em.fork();
    const txns = await em.find(BudgetTxn, {}, FILTER_OFF);
    expect(txns.map((t) => t.txnType).sort()).toEqual([
      BudgetTxnType.ACTUAL,
      BudgetTxnType.RESERVE,
    ]);
    expect(txns.every((t) => Money.compare(t.amount, '250000') === 0)).toBe(true);
    expect(txns.filter((t) => t.txnType === BudgetTxnType.RELEASE)).toEqual([]);
  });

  it('dates every ledger row in the month of its spending', async () => {
    const file = workbook([
      { day: 3, month: 3, code: '7.301', department: '7', description: 'a', kip: 100000 },
      { day: 9, month: 7, code: '7.301', department: '7', description: 'b', kip: 150000 },
    ]);
    await run(file);
    const em = orm.em.fork();
    const txns = await em.find(BudgetTxn, {}, { ...FILTER_OFF, orderBy: { txnDate: 'ASC' } });
    expect([...new Set(txns.map((t) => t.txnDate))]).toEqual(['2026-03-01', '2026-07-01']);
  });

  it('keeps every description, on its own line', async () => {
    const file = workbook([
      { day: 3, month: 3, code: '7.301', department: '7', description: 'ຄ່າແຮງງານ', kip: 100000 },
      { day: 4, month: 3, code: '7.301', department: '7', description: 'ຄ່ານໍ້າມັນ', kip: 150000 },
    ]);
    const result = await run(file);
    expect(result.linesCreated).toBe(2);
    const em = orm.em.fork();
    const lines = await em.find(DocumentLine, {}, { ...FILTER_OFF, orderBy: { lineNo: 'ASC' } });
    expect(lines.map((l) => l.description.split(' — ')[0])).toEqual(['ຄ່າແຮງງານ', 'ຄ່ານໍ້າມັນ']);
    expect(lines.map((l) => Money.compare(l.lineAmount, '0'))).toEqual([1, 1]);
    expectMoney(lines[0].lineAmount, '100000');
    expectMoney(lines[1].lineAmount, '150000');
    // The day the document's month cannot carry, kept where it can be read.
    expect(lines[0].description).toContain('2026-03-03');
  });

  it('cuts a description longer than the column, keeping the reference back to the sheet', async () => {
    const long = 'ຄ່າເໝົາລົດຮ່ວມ '.repeat(40);
    const file = workbook([
      { day: 3, month: 3, code: '7.301', department: '7', description: long, kip: 1000, sequence: '01128' },
    ]);
    const result = await run(file);
    expect(result.descriptionsTruncated).toBe(1);
    const em = orm.em.fork();
    const line = await em.findOneOrFail(DocumentLine, { lineNo: 1 }, FILTER_OFF);
    expect(line.description.length).toBeLessThanOrEqual(DESCRIPTION_LIMIT);
    expect(line.description).toContain('…');
    // The thread back to their sheet survives the cut; the words are what gives way.
    expect(line.description).toContain('#01128');
    expect(line.description).toContain('2026-03-03');
  });

  it('creates a budget of zero where the spending has nowhere to land', async () => {
    const file = workbook([
      { day: 3, month: 3, code: '7.502', department: '7', description: 'ເງິນເດືອນ', kip: 3675828099 },
    ]);
    const result = await run(file);
    expect(result.budgetsCreatedAtZero.map(({ code, departmentCode, charged }) => ({
      code,
      departmentCode,
      charged,
    }))).toEqual([{ code: '7.502', departmentCode: '7', charged: '3675828099' }]);
    const budget = await budgetAt('7.502');
    expectMoney(budget.amountTotal, '0');
    expect(budget.status).toBe('ACTIVE');
    expectMoney(await balance.availableBalance(budget.id), '-3675828099');
  });

  it('puts every budget it creates under a control point that governs it', async () => {
    // An ACTIVE budget governed by nothing is not merely unchecked: `reserve` refuses it outright,
    // so the customer would get 125 lines they cannot spend on and no explanation.
    const file = workbook([
      { day: 3, month: 3, code: '7.502', department: '7', description: 'ເງິນເດືອນ', kip: 500000 },
    ]);
    const result = await run(file);
    expect(result.controlPointsCreated).toBe(1);
    const budget = await budgetAt('7.502');
    const governing = await coverage.resolveControlPoints([budget.id]);
    expect(governing.get(budget.id)!.length).toBeGreaterThan(0);
    // BLOCK at the ceiling — on a budget of zero, the next request is refused rather than waved
    // through, which is what a line the plan never funded should do.
    expect(governing.get(budget.id)![0].toleranceJson).toContain('BLOCK');
  });

  it('creates no budget for a plan line the history never charges', async () => {
    const file = workbook([
      { day: 3, month: 3, code: '7.301', department: '7', description: 'a', kip: 1000 },
    ]);
    await run(file);
    const em = orm.em.fork();
    const node = await em.findOneOrFail(BudgetNode, { code: '9.101' }, FILTER_OFF);
    expect(await em.findOne(Budget, { node: node.id }, FILTER_OFF)).toBeNull();
  });

  it('charges the budget the plan code names, not the department that spent', async () => {
    const file = workbook([
      { day: 3, month: 3, code: '18.101', department: '6', description: 'HAL PAY', kip: 18571573 },
    ]);
    const result = await run(file);
    expect(result.budgetsCreatedAtZero.map((b) => b.departmentCode)).toEqual(['18']);
    const budget = await budgetAt('18.101');
    expect(budget.department.deptCode).toBe('18');
    // Who spent it is on the document, where it is true.
    const em = orm.em.fork();
    const doc = await em.findOneOrFail(
      Document,
      { sourceType: SPEND_HISTORY_SOURCE },
      { ...FILTER_OFF, populate: ['department'] },
    );
    expect(doc.department.deptCode).toBe('6');
  });

  it('changes nothing on a second run', async () => {
    const file = workbook([
      { day: 3, month: 3, code: '7.301', department: '7', description: 'a', kip: 100000 },
      { day: 4, month: 4, code: '7.301', department: '7', description: 'b', kip: 150000 },
    ]);
    const first = await run(file);
    const budget = await budgetAt('7.301');
    const after = await balance.availableBalance(budget.id);

    const second = await run(file);
    expect(first.documentsCreated).toBe(2);
    expect(second.documentsCreated).toBe(0);
    expect(second.documentsUnchanged).toBe(2);
    expect(second.linesCreated).toBe(0);
    expect(second.ledgerRows).toBe(0);

    const em = orm.em.fork();
    expect(await em.count(Document, {}, FILTER_OFF)).toBe(2);
    expect(await em.count(DocumentLine, {}, FILTER_OFF)).toBe(2);
    expect(await em.count(BudgetTxn, {}, FILTER_OFF)).toBe(4);
    expect(await balance.availableBalance(budget.id)).toBe(after);
  });

  it('leaves nothing behind when the run fails part-way', async () => {
    const file = workbook([
      { day: 3, month: 3, code: '7.301', department: '7', description: 'a', kip: 100000 },
      { day: 4, month: 4, code: '7.301', department: '7', description: 'b', kip: 150000 },
    ]);
    // Fail inside the transaction, after the first document's ledger rows are written.
    const ledger = (service as never as { ledger: BudgetLedgerService }).ledger;
    const real = ledger.recordHistoricSpend.bind(ledger);
    let calls = 0;
    ledger.recordHistoricSpend = async (...args: Parameters<typeof real>) => {
      if (++calls > 1) throw new Error('boom');
      return real(...args);
    };
    try {
      await expect(run(file)).rejects.toThrow('boom');
    } finally {
      ledger.recordHistoricSpend = real;
    }
    const em = orm.em.fork();
    expect(await em.count(Document, {}, FILTER_OFF)).toBe(0);
    expect(await em.count(DocumentLine, {}, FILTER_OFF)).toBe(0);
    expect(await em.count(BudgetTxn, {}, FILTER_OFF)).toBe(0);
  });

  it('writes nothing outside the company it was told to import into', async () => {
    const file = workbook([
      { day: 3, month: 3, code: '7.301', department: '7', description: 'a', kip: 100000 },
    ]);
    await run(file);
    const em = orm.em.fork();
    const other = await em.findOneOrFail(Company, { code: 'OTHER' }, FILTER_OFF);
    expect(await em.count(Document, { company: other.id }, FILTER_OFF)).toBe(0);
    const docs = await em.find(Document, {}, FILTER_OFF);
    expect(docs.every((d) => d.company.id === companyId)).toBe(true);
    expect(docs.every((d) => d.sourceType === SPEND_HISTORY_SOURCE)).toBe(true);
    expect(docs.every((d) => d.status === DocStatus.COMPLETED)).toBe(true);
  });

  it('writes nothing at all on a dry run, and reports what the real run then does', async () => {
    const file = workbook([
      { day: 3, month: 3, code: '7.301', department: '7', description: 'a', kip: 100000 },
      { day: 4, month: 4, code: '7.502', department: '7', description: 'b', kip: 150000 },
    ]);
    const dry = await run(file, { dryRun: true });
    const em = orm.em.fork();
    expect(await em.count(Document, {}, FILTER_OFF)).toBe(0);
    expect(await em.count(BudgetTxn, {}, FILTER_OFF)).toBe(0);
    expect(await em.count(Budget, {}, FILTER_OFF)).toBe(1);

    const real = await run(file);
    // Compared without the ids the real run fills in — a dry run cannot know them, and what it
    // promises is the COUNTS: documents, lines, ledger rows, budgets and control points.
    const comparable = (r: typeof real) => ({
      ...r,
      dryRun: true,
      plan: null,
      budgetsCreatedAtZero: r.budgetsCreatedAtZero.map(({ budgetId: _id, ...rest }) => rest),
    });
    expect(comparable(real)).toEqual(comparable(dry));
    expect(real.controlPointsCreated).toBe(1);
  });

  it('refuses a code the plan has no line for, before writing anything', async () => {
    const file = workbook([
      { day: 3, month: 3, code: '7.301', department: '7', description: 'a', kip: 100000 },
      { day: 3, month: 3, code: '4.999', department: '4', description: 'b', kip: 100000 },
    ]);
    await expect(run(file)).rejects.toThrow(/no line for 1 code\(s\).*4\.999/s);
    const em = orm.em.fork();
    expect(await em.count(Document, {}, FILTER_OFF)).toBe(0);
    expect(await em.count(BudgetTxn, {}, FILTER_OFF)).toBe(0);
  });
});
