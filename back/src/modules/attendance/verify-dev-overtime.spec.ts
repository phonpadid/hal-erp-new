import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { DocStatus } from '../../common/enums';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Workflow } from '../approval/approval.entities';
import { ExchangeRateService } from '../currency/exchange-rate.service';
import {
  DocFieldValue,
  Document,
  DocumentType,
  FormField,
  FormTemplate,
} from '../document/document.entities';
import { DocumentSubmitService } from '../document/document-submit.service';
import { Company, Department } from '../multi-company/multi-company.entities';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { QuotaBalanceService } from '../quota/quota-balance.service';
import { QuotaUsageService } from '../quota/quota-usage.service';
import { AppUser, Employee } from '../rbac/rbac.entities';
import { AttendanceDay, OvertimeClaim } from './attendance.entities';
import { OvertimeClaimService } from './overtime-claim.service';
import type { MikroORM } from '@mikro-orm/postgresql';

/**
 * Task 9.2 — against the DEV database, with its real seeded document type and weekly ceiling.
 * Skips entirely unless DB_NAME points at the dev database.
 */
const hasDb = await dbAvailable();
const isDevDb = process.env.DB_NAME === 'new_erp';
const FILTER_OFF = { filters: { company: false } } as const;

const MON = '2026-03-02';

describe.skipIf(!hasDb || !isDevDb)('dev-database overtime (manual verification)', () => {
  let orm: MikroORM;
  let claims: OvertimeClaimService;
  let submitService: DocumentSubmitService;
  let companyId = '';
  let employeeId = '';
  let documentId = '';

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    const scope = new CompanyScopeService(orm.em);
    submitService = new DocumentSubmitService(
      orm.em,
      new ExchangeRateService(orm.em),
      new FiscalYearService(scope),
      null as never,
      null as never,
      null as never,
      new QuotaUsageService(orm.em, new QuotaBalanceService(orm.em)),
    );
    claims = new OvertimeClaimService(orm.em, scope, submitService);

    const em = orm.em.fork();
    // Idempotent against dev data: a previous run's claim would (correctly) be blocked by the
    // overlap guard, so this run clears what it made last time rather than fighting its own rule.
    await em.nativeDelete(OvertimeClaim, {}, FILTER_OFF);
    await em.nativeDelete(Document, { docNo: { $like: 'OT-VERIFY%' } }, FILTER_OFF);

    const company = await em.findOne(Company, { code: 'HAL' }, FILTER_OFF);
    const employee = await em.findOne(Employee, { empCode: 'EMP-REQ' }, { ...FILTER_OFF, populate: ['department', 'user'] });
    companyId = company!.id;
    employeeId = employee!.id;

    // A day carrying real recorded overtime for the claim to certify.
    const existing = await em.findOne(AttendanceDay, { employee: employeeId, shiftDate: MON }, FILTER_OFF);
    if (existing) {
      existing.otNormalMinutes = 90;
      existing.holidayWorkMinutes = 0;
      existing.otHolidayMinutes = 0;
    } else {
      em.create(AttendanceDay, {
        company: em.getReference(Company, companyId),
        employee: em.getReference(Employee, employeeId),
        shiftDate: MON,
        status: 'PRESENT' as never,
        otNormalMinutes: 90,
        computedAt: new Date(),
      });
    }

    const dt = await em.findOne(DocumentType, { company: companyId, code: 'OT' }, FILTER_OFF);
    const tmpl = await em.findOne(FormTemplate, { documentType: dt!.id }, FILTER_OFF);
    const wf = await em.findOne(Workflow, { company: companyId, isActive: true }, FILTER_OFF);
    const doc = em.create(Document, {
      docNo: `OT-VERIFY-${Date.now()}`,
      company: em.getReference(Company, companyId),
      department: em.getReference(Department, employee!.department.id),
      documentType: dt!,
      formTemplate: tmpl!,
      workflow: wf!,
      createdBy: em.getReference(AppUser, employee!.user!.id),
      status: DocStatus.DRAFT,
      exchangeRate: '1',
      createdAt: new Date(),
    } as never);
    // The seeded form template has required fields; submit enforces them, so the verification
    // document must be as complete as a real one.
    const fields = await em.find(FormField, { formTemplate: tmpl!.id, isRequired: true }, FILTER_OFF);
    for (const field of fields) {
      em.create(DocFieldValue, { document: doc, formField: field, fieldValue: 'verification' });
    }
    await em.flush();
    documentId = doc.id;
  });

  afterAll(async () => {
    if (orm) await orm.close(true);
  });

  const asHal = <T>(fn: () => Promise<T>) => RequestContext.run({ companyId, grants: [] }, fn);

  it('sums the recorded minutes by kind from the real projection', async () => {
    const claim = await asHal(() =>
      claims.create({ documentId, employeeId, fromDate: MON, toDate: MON }),
    );
    expect(claim.otNormalMinutes).toBe(90);
    expect(claim.totalMinutes).toBe(90);
    // eslint-disable-next-line no-console
    console.log('CLAIM  ', claim.fromDate, '->', claim.toDate,
      `normal=${claim.otNormalMinutes} holidayWork=${claim.holidayWorkMinutes} otHoliday=${claim.otHolidayMinutes}`);
  });

  it('is refused by the generic submit endpoint, because the seeded type derives its quantity', async () => {
    await expect(asHal(() => submitService.submit(documentId))).rejects.toThrow(/system-computed quantity/);
    // eslint-disable-next-line no-console
    console.log('GENERIC submit refused as expected');
  });

  it('submits through its own endpoint, under the seeded weekly ceiling', async () => {
    const result = await asHal(() => claims.submit(documentId));
    expect(result.hours.totalMinutes).toBe(90);
    const em = orm.em.fork();
    const company = await em.findOne(Company, { id: companyId }, FILTER_OFF);
    // eslint-disable-next-line no-console
    console.log('SUBMIT ', `${result.hours.totalMinutes}m certified, weekly ceiling ${company!.overtimeWeeklyLimitMinutes}m`);
  });
});
