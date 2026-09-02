import 'reflect-metadata';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, beforeAll, describe, expect, it } from 'vitest';
import type { MikroORM } from '@mikro-orm/postgresql';
import { DocCategory } from '../../src/common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../src/test/test-orm';
import { DeptDocTypeService } from '../../src/modules/document/dept-doc-type.service';
import { FormTemplateService } from '../../src/modules/document/form-template.service';
import { DocumentTypeService } from '../../src/modules/document/document-type.service';
import { WorkflowConfigService } from '../../src/modules/approval/workflow-config.service';
import { ExchangeRateService } from '../../src/modules/currency/exchange-rate.service';
import { Currency, ExchangeRate } from '../../src/modules/currency/currency.entities';
import { Company, Department } from '../../src/modules/multi-company/multi-company.entities';
import { AppUser, Role } from '../../src/modules/rbac/rbac.entities';
import { Workflow, WorkflowStep } from '../../src/modules/approval/approval.entities';
import { DeptDocType, DocumentType, FormTemplate } from '../../src/modules/document/document.entities';
import { readConfig, type GoliveConfig } from './config';
import { resolve, UnresolvedReferences } from './resolve';
import { apply, type ApplyServices } from './apply';
import { inspect } from './inspect';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

describe.skipIf(!hasDb)('golive apply (DB-backed)', () => {
  let orm: MikroORM;
  let services: ApplyServices;
  let rates: ExchangeRateService;
  const dir = mkdtempSync(join(tmpdir(), 'golive-'));

  /**
   * Rebuild the fixture data, so each spec starts from the same unconfigured database.
   *
   * The SCHEMA is built once, in `beforeAll`. Refreshing it per test drops and recreates ninety
   * tables twelve times and is both slow and flaky under Postgres — only the rows need resetting.
   */
  async function reset(): Promise<void> {
    const em = orm.em.fork();
    // Children before parents; every table this fixture writes.
    for (const entity of [DeptDocType, WorkflowStep, ExchangeRate, FormTemplate, DocumentType, Workflow, Role, Department, AppUser, Company, Currency]) {
      await em.nativeDelete(entity, {}, FILTER_OFF);
    }
    em.clear();
    const lak = em.create(Currency, { code: 'LAK', name: 'Kip', decimalPlaces: 0, isActive: true });
    em.create(Currency, { code: 'USD', name: 'Dollar', decimalPlaces: 2, isActive: true });
    const hal = em.create(Company, { code: 'HAL', nameTh: 'HAL', taxId: '1', branchCode: '00000', baseCurrency: lak, isActive: true });
    const other = em.create(Company, { code: 'OTHER', nameTh: 'Other', taxId: '2', branchCode: '00000', baseCurrency: lak, isActive: true });
    em.create(Department, { company: hal, deptCode: 'FIN', name: 'Finance', isActive: true });
    em.create(Department, { company: other, deptCode: 'FOREIGN', name: 'Foreign', isActive: true });
    em.create(Role, { company: hal, code: 'FIN_APPROVER', name: 'Finance approver', isActive: true });
    em.create(AppUser, { username: 'somchai', email: 's@x', status: 'ACTIVE' });
    const wf = em.create(Workflow, { company: hal, name: 'Disbursement', isActive: true });
    em.create(WorkflowStep, { workflow: wf, stepNo: 1, approverUser: em.getReference(AppUser, (await em.findOneOrFail(AppUser, { username: 'somchai' }).catch(() => null))?.id ?? '') });
    const type = em.create(DocumentType, { company: hal, code: 'RECWH', name: 'Withdrawal', category: DocCategory.FINANCE, requiresBudget: false, requiresQuota: false, isActive: true });
    em.create(FormTemplate, { documentType: type, version: 1, status: 'DRAFT' });
    // A second active type the file will say nothing about.
    em.create(DocumentType, { company: hal, code: 'MEMO', name: 'Memo', category: DocCategory.ADMIN, requiresBudget: false, requiresQuota: false, isActive: true });
    await em.flush();
  }

  const config = (over: Partial<GoliveConfig> = {}): GoliveConfig => ({
    company: 'HAL',
    documentTypes: {
      RECWH: { authoringRoute: null, mappings: [{ department: 'FIN', formTemplate: 1, workflow: 'Disbursement' }] },
    },
    publishTemplates: [],
    workflows: {},
    exchangeRates: [],
    ...over,
  });

  /**
   * Run a whole apply the way the CLI does: resolve then apply, on one fork.
   *
   * `clear()` first, because the CLI is a fresh process with an empty identity map. Without it a
   * relation left unpopulated by `resolve` reads correctly anyway — hydrated by some earlier read
   * in this same process — and a second apply passes here while failing in the field. That is
   * exactly how the form-template `status` bug hid.
   */
  const run = async (cfg: GoliveConfig) => {
    orm.em.clear();
    const em = orm.em.fork();
    const resolved = await resolve(em, cfg);
    const actor = await em.findOneOrFail(AppUser, { username: 'somchai' }, FILTER_OFF);
    return apply({ ...services, em }, cfg, resolved, actor.id);
  };

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    rates = new ExchangeRateService(orm.em);
    services = {
      em: orm.em,
      mappings: new DeptDocTypeService(orm.em),
      templates: new FormTemplateService(orm.em),
      types: new DocumentTypeService(orm.em),
      workflows: new WorkflowConfigService(orm.em),
      rates,
    };
  });

  beforeEach(reset);

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  it('makes an unmapped type raisable, and inspect stops reporting it', async () => {
    const before = await inspect(orm.em.fork(), rates, 'HAL');
    expect(before[0].findings.filter((f) => f.kind === 'UNMAPPED_TYPE').map((f) => f.subject))
      .toContain('RECWH');

    await run(config({ publishTemplates: ['RECWH/FIN'] }));

    const after = await inspect(orm.em.fork(), rates, 'HAL');
    const kinds = after[0].findings.filter((f) => f.subject === 'RECWH' || f.subject === 'RECWH/FIN');
    // Neither unmapped nor backed by a draft form any more. MEMO is still reported, correctly.
    expect(kinds).toEqual([]);
    expect(after[0].findings.map((f) => f.subject)).toContain('MEMO');
  });

  it('writes nothing the second time', async () => {
    const cfg = config({ publishTemplates: ['RECWH/FIN'] });
    await run(cfg);

    const tables = [DeptDocType, FormTemplate, WorkflowStep, DocumentType];
    const before = await Promise.all(tables.map((t) => orm.em.fork().count(t, {}, FILTER_OFF)));
    const second = await run(cfg);
    const after = await Promise.all(tables.map((t) => orm.em.fork().count(t, {}, FILTER_OFF)));

    expect(after).toEqual(before);
    expect(second.changed).toEqual([]);
    // And it says so, rather than being silently quiet.
    expect(second.unchanged.join(' ')).toContain('already maps to');
  });

  it('fails on an unknown department before writing anything', async () => {
    const cfg = config({
      documentTypes: { RECWH: { authoringRoute: null, mappings: [{ department: 'NOPE', formTemplate: 1, workflow: 'Disbursement' }] } },
    });
    await expect(run(cfg)).rejects.toThrow(UnresolvedReferences);
    expect(await orm.em.fork().count(DeptDocType, {}, FILTER_OFF)).toBe(0);
  });

  it('names every unknown reference at once, not just the first', async () => {
    const cfg = config({
      documentTypes: { RECWH: { authoringRoute: null, mappings: [{ department: 'NOPE', formTemplate: 9, workflow: 'MISSING' }] } },
    });
    const error = await run(cfg).catch((e: unknown) => e as UnresolvedReferences);
    expect(error).toBeInstanceOf(UnresolvedReferences);
    const problems = (error as UnresolvedReferences).problems.join(' ');
    // One run, every problem — the file is filled in by somebody without the database in front
    // of them, and three round trips to learn three typos is three round trips too many.
    expect(problems).toContain('NOPE');
    expect(problems).toContain('MISSING');
    expect(problems).toContain('v9');
  });

  it('refuses a department from another company, as the configuration screen does', async () => {
    const cfg = config({
      documentTypes: { RECWH: { authoringRoute: null, mappings: [{ department: 'FOREIGN', formTemplate: 1, workflow: 'Disbursement' }] } },
    });
    // Scoped resolution makes a cross-company department indistinguishable from a typo, which is
    // the right answer: neither is a department this company may map (invariant 1).
    await expect(run(cfg)).rejects.toThrow(UnresolvedReferences);
    expect(await orm.em.fork().count(DeptDocType, {}, FILTER_OFF)).toBe(0);
  });

  it('publishes a draft form, and leaves it published on a second apply', async () => {
    const cfg = config({ publishTemplates: ['RECWH/FIN'] });
    await run(cfg);
    const published = await orm.em.fork().findOneOrFail(FormTemplate, { version: 1 }, FILTER_OFF);
    expect(published.status).toBe('PUBLISHED');

    const second = await run(cfg);
    expect(second.changed).toEqual([]);
    const again = await orm.em.fork().findOneOrFail(FormTemplate, { version: 1 }, FILTER_OFF);
    expect(again.status).toBe('PUBLISHED');
  });

  it('lists an active type the file says nothing about rather than touching it', async () => {
    const result = await run(config());
    expect(result.untouched.join(' ')).toContain('MEMO');
    // Silence would be defaulting by another name, so the omission is reported, not acted on.
    const memo = await orm.em.fork().findOneOrFail(DocumentType, { code: 'MEMO' }, FILTER_OFF);
    expect(memo.authoringRoute).toBeFalsy();
  });

  it('replaces a person-targeted chain with a role-targeted one, once', async () => {
    const cfg = config({
      workflows: { Disbursement: { steps: [{ stepNo: 1, approverRole: 'FIN_APPROVER', amountMin: null, amountMax: null }] } },
    });
    await run(cfg);
    const steps = await orm.em.fork().find(WorkflowStep, {}, { ...FILTER_OFF, populate: ['approverRole', 'approverUser'] });
    expect(steps).toHaveLength(1);
    expect(steps[0].approverRole?.code).toBe('FIN_APPROVER');
    expect(steps[0].approverUser).toBeFalsy();

    const second = await run(cfg);
    expect(second.changed).toEqual([]);
  });

  it('records a rate that makes a currency resolvable, and does not duplicate it', async () => {
    const cfg = config({
      exchangeRates: [{ from: 'USD', to: 'LAK', rate: '21500.00', rateDate: '2026-01-01', rateType: 'DAILY' }],
    });
    await run(cfg);
    const company = await orm.em.fork().findOneOrFail(Company, { code: 'HAL' }, FILTER_OFF);
    // With the company, because the file writes a per-company override rather than a group rate —
    // which is what `inspect` asks for too.
    const resolvedRate = await rates.resolveRate({ from: 'USD', to: 'LAK', asOf: '2026-06-01', companyId: company.id });
    expect(resolvedRate.rate).toBe('21500.00');

    const second = await run(cfg);
    expect(second.changed).toEqual([]);
  });

  it('refuses to rewrite a rate that is already on file for that date', async () => {
    const at = (rate: string) => config({
      exchangeRates: [{ from: 'USD', to: 'LAK', rate, rateDate: '2026-01-01', rateType: 'DAILY' }],
    });
    await run(at('21500.00'));
    // A rate row is immutable — the service offers no update, and the row is what documents locked
    // onto. So a different number for the same key is a conflict to resolve, not an instruction.
    await expect(run(at('22000.00'))).rejects.toThrow(/cannot be rewritten/);
    const stored = await orm.em.fork().findOneOrFail(ExchangeRate, { rateDate: '2026-01-01' }, FILTER_OFF);
    expect(Number(stored.rate)).toBe(21500);
  });

  it('reads a file with the template’s comments still in it', async () => {
    const path = join(dir, 'with-comments.jsonc');
    writeFileSync(path, `// HAL — fill this in\n{\n  "company": "HAL",\n  // which department raises it\n  "documentTypes": {}\n}\n`, 'utf8');
    expect(readConfig(path).company).toBe('HAL');
  });

  it('names the offending key rather than throwing a stack trace', async () => {
    const path = join(dir, 'bad.jsonc');
    writeFileSync(path, `{ "company": "HAL", "exchangeRates": [{ "from": "USD", "to": "LAK", "rate": 21500, "rateDate": "2026-01-01" }] }`, 'utf8');
    expect(() => readConfig(path)).toThrow(/exchangeRates\.0\.rate/);
  });
});
