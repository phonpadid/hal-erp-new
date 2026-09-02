import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { DocStatus, LeaveHalf } from '../../common/enums';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Workflow } from '../approval/approval.entities';
import { Document, DocumentType, FormTemplate } from '../document/document.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { Quota } from '../quota/quota.entities';
import { AppUser, Employee } from '../rbac/rbac.entities';
import { AttendanceDay } from './attendance.entities';
import { AttendancePeriodGuard } from './attendance-period.guard';
import { AttendanceDayService } from './attendance-day.service';
import { LeaveApprovedListener } from './leave-approved.listener';
import { LeaveRequestService } from './leave-request.service';
import { ShiftResolutionService } from './shift-resolution.service';
import type { MikroORM } from '@mikro-orm/postgresql';

/**
 * Task 10.3 — against the DEV database, with its real seeded shift, holidays and quotas.
 *
 * Does NOT call refreshDatabase(): it must read the seeded world as it is. It writes a leave
 * request and `attendance_day` rows, both of which are rebuildable, and skips entirely unless
 * DB_NAME points at the dev database.
 */
const hasDb = await dbAvailable();
const isDevDb = process.env.DB_NAME === 'new_erp';
const FILTER_OFF = { filters: { company: false } } as const;

// 2026-03-06 is a Friday, 2026-03-07 the seeded half-day Saturday, 2026-03-08 a Sunday.
const FRI = '2026-03-06';
const SAT = '2026-03-07';

describe.skipIf(!hasDb || !isDevDb)('dev-database leave (manual verification)', () => {
  let orm: MikroORM;
  let leave: LeaveRequestService;
  let days: AttendanceDayService;
  let companyId = '';
  let employeeId = '';
  let documentId = '';

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    const scope = new CompanyScopeService(orm.em);
    const periodGuard = new AttendancePeriodGuard(orm.em);
    const resolution = new ShiftResolutionService(orm.em);
    leave = new LeaveRequestService(orm.em, scope, resolution, null as never, periodGuard);
    days = new AttendanceDayService(orm.em, scope, resolution, leave, periodGuard);

    const em = orm.em.fork();
    const company = await em.findOne(Company, { code: 'HAL' }, FILTER_OFF);
    const employee = await em.findOne(Employee, { empCode: 'EMP-REQ' }, { ...FILTER_OFF, populate: ['department', 'user'] });
    companyId = company!.id;
    employeeId = employee!.id;

    const dt = await em.findOne(DocumentType, { company: companyId, code: 'LEAVE' }, FILTER_OFF);
    const tmpl = await em.findOne(FormTemplate, { documentType: dt!.id }, FILTER_OFF);
    // Workflow is not bound to a document type on the entity; any active one of this company
    // serves, since this verification never routes the document for approval.
    const wf = await em.findOne(Workflow, { company: companyId, isActive: true }, FILTER_OFF);
    const annual = await em.findOne(Quota, { company: companyId, quotaType: 'ANNUAL_LEAVE' }, FILTER_OFF);

    const doc = em.create(Document, {
      docNo: `LV-VERIFY-${Date.now()}`,
      company: em.getReference(Company, companyId),
      department: em.getReference(Department, employee!.department.id),
      documentType: dt!,
      formTemplate: tmpl!,
      workflow: wf!,
      createdBy: em.getReference(AppUser, employee!.user!.id),
      relatedEmployee: em.getReference(Employee, employeeId),
      status: DocStatus.DRAFT,
      exchangeRate: '1',
      createdAt: new Date(),
    } as never);
    await em.flush();
    documentId = doc.id;

    await RequestContext.run({ companyId, grants: [] }, () =>
      leave.create({
        documentId,
        quotaId: annual!.id,
        fromDate: FRI,
        toDate: SAT,
        toHalf: LeaveHalf.AM,
      }),
    );
  });

  afterAll(async () => {
    if (orm) await orm.close(true);
  });

  const asHal = <T>(fn: () => Promise<T>) => RequestContext.run({ companyId, grants: [] }, fn);

  it('charges a full Friday plus half of the seeded short Saturday', async () => {
    const row = await asHal(() => leave.findForDocument(documentId));
    // Friday is a full working day; Saturday runs 08:00-12:00 and only its morning is taken.
    expect(row!.totalDays).toBe('1.50');
    // eslint-disable-next-line no-console
    console.log('LEAVE  ', row!.fromDate, '->', row!.toDate, row!.toHalf, '=', row!.totalDays, 'days');
  });

  it('flips the covered days from ABSENT to LEAVE once approved', async () => {
    const before = await asHal(() => days.recomputeRange(employeeId, FRI, SAT));
    // eslint-disable-next-line no-console
    console.log('BEFORE ', before.map((r) => `${r.shiftDate}=${r.status}`).join(' '));
    expect(before[0].status).toBe('ABSENT');

    const em = orm.em.fork();
    const doc = await em.findOne(Document, { id: documentId }, FILTER_OFF);
    doc!.status = DocStatus.APPROVED;
    doc!.approvedAt = new Date();
    await em.flush();

    await new LeaveApprovedListener(orm.em, days).onOutcome({ documentId, status: 'COMPLETED' });

    const em2 = orm.em.fork();
    const after = await em2.find(
      AttendanceDay,
      { employee: employeeId, shiftDate: { $gte: FRI, $lte: SAT } },
      { ...FILTER_OFF, orderBy: { shiftDate: 'ASC' } },
    );
    // eslint-disable-next-line no-console
    console.log('AFTER  ', after.map((r) => `${r.shiftDate}=${r.status}(exp ${r.expectedMinutes}m)`).join(' '));
    expect(after[0].status).toBe('LEAVE');
    // Saturday keeps a working half, so it is not excused — the expectation is halved instead.
    expect(after[1].status).not.toBe('LEAVE');
    expect(after[1].expectedMinutes).toBe(120);
  });
});
