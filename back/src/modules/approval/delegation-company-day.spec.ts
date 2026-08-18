import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { ApproverResolverService } from './approver-resolver.service';
import { ApprovalDelegation, Workflow, WorkflowStep } from './approval.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { Currency } from '../currency/currency.entities';
import { DocCategory, DocStatus } from '../../common/enums';
import { Document, DocumentType, FormTemplate } from '../document/document.entities';
import { AppUser } from '../rbac/rbac.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * A delegation's window is the DOCUMENT COMPANY's calendar day.
 *
 * It used to be `new Date().toISOString()` — the server's UTC day, wherever the box happens to be.
 * `gl-journal` settled this argument for `entry_date`: a date decides which side of a boundary a
 * fact falls on, so it must be the company's own day. Read in UTC, a delegation written "to the
 * 31st" for a company in UTC+7 stopped working at 07:00 on the 31st, local — seventeen hours early,
 * silently, on the last day somebody arranged cover for.
 */
describe.skipIf(!hasDb)('delegation windows on the company day (DB-backed)', () => {
  let orm: MikroORM;
  let resolver: ApproverResolverService;
  let docId = '';
  let ids = { principal: '', delegate: '' };

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    // UTC+7: the company's day turns over seven hours before UTC's does.
    const company = em.create(Company, {
      code: 'TZ', nameTh: 'TZ', taxId: '1', branchCode: '00000', baseCurrency: thb,
      timezone: 'Asia/Bangkok', isActive: true,
    });
    const dept = em.create(Department, { company, deptCode: 'D', name: 'D', isActive: true });
    const principal = em.create(AppUser, { username: 'tz-principal', email: 'p@x', status: 'ACTIVE' });
    const delegate = em.create(AppUser, { username: 'tz-delegate', email: 'd@x', status: 'ACTIVE' });
    const dt = em.create(DocumentType, {
      company, code: 'TZMEMO', name: 'Memo', category: DocCategory.ADMIN,
      requiresBudget: false, requiresQuota: false, isActive: true,
    });
    const tmpl = em.create(FormTemplate, { documentType: dt, version: 1, status: 'PUBLISHED' });
    const wf = em.create(Workflow, { company, name: 'TZ WF', isActive: true });
    em.create(WorkflowStep, { workflow: wf, stepNo: 1, approverUser: principal, approveMode: 'SEQUENTIAL', showSignatureOnPdf: true });
    // The window ends on the 31st — the company's 31st.
    em.create(ApprovalDelegation, {
      company, delegator: principal, delegate,
      startDate: '2026-03-01', endDate: '2026-03-31', status: 'ACTIVE', createdAt: new Date(),
    });
    const doc = em.create(Document, {
      docNo: 'TZ-1', company, department: dept, documentType: dt, formTemplate: tmpl, workflow: wf,
      currentStepNo: 1, createdBy: em.getReference(AppUser, principal.id), exchangeRate: '1',
      baseTotalAmount: '10', status: DocStatus.IN_APPROVAL, submittedAt: new Date(), createdAt: new Date(),
    });
    await em.flush();
    docId = doc.id;
    ids = { principal: principal.id, delegate: delegate.id };
  });

  afterAll(async () => {
    vi.useRealTimers();
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  async function eligibleAt(instant: string): Promise<string[]> {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(instant));
    try {
      const em = orm.em.fork();
      const svc = new ApproverResolverService(em);
      const document = await em.findOneOrFail(Document, { id: docId }, { ...FILTER_OFF, populate: ['company', 'createdBy'] });
      const step = await em.findOneOrFail(WorkflowStep, { workflow: document.workflow.id, stepNo: 1 }, { ...FILTER_OFF, populate: ['approverUser', 'approverRole'] });
      const actors = await svc.eligible(step, document);
      return actors.map((a) => a.userId);
    } finally {
      vi.useRealTimers();
    }
  }

  it('keeps the delegate eligible on the last local day, when UTC still says yesterday', async () => {
    // 08:00 on the 31st in Bangkok is 01:00 on the 31st UTC — both agree here.
    expect(await eligibleAt('2026-03-31T01:00:00Z')).toContain(ids.delegate);
  });

  it('keeps the delegate eligible in the local morning of the last day, which UTC calls the 30th', async () => {
    // 06:00 on the 31st in Bangkok is 23:00 on the 30th UTC. Reading the UTC day gives the 30th —
    // still inside the window — so this case passes either way; it is the boundary below that bites.
    expect(await eligibleAt('2026-03-30T23:00:00Z')).toContain(ids.delegate);
  });

  it('drops the delegate only when the COMPANY day has passed the window', async () => {
    // 06:00 on 1 April in Bangkok is 23:00 on 31 March UTC. The company is into April and the
    // delegation is over; reading the UTC day would still call it the 31st and keep the delegate.
    expect(await eligibleAt('2026-03-31T23:00:00Z')).not.toContain(ids.delegate);
    expect(await eligibleAt('2026-03-31T23:00:00Z')).toContain(ids.principal);
  });
});
