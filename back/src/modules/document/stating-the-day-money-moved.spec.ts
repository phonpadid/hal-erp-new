import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { localDateIn } from '../../common/time/company-clock';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { AccountService } from '../accounting/account.service';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { BudgetService } from '../budget/budget.service';
import { ItemService } from '../master-data/item.service';
import { Company, Department } from '../multi-company/multi-company.entities';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { ScopeService } from '../rbac/scope.service';
import { seedDatabase, SEED_COMPANY_CODE } from '../../seed/seed-data';
import { DeptDocTypeService } from './dept-doc-type.service';
import { DocumentService } from './document.service';
import { DocumentType } from './document.entities';
import { NumberingService } from './numbering.service';
import { DocumentPermissions } from './permissions';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
let tz = 'Asia/Bangkok';
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * Both dates are resolved in the COMPANY's timezone, because that is where the service resolves
 * the day it compares them against — `assertMayStateTheDay` calls `localDateIn(new Date(), tz)`.
 *
 * Reading them in UTC instead made this suite fail for the seven hours a day when the two zones
 * disagree on the date: at UTC+7, 18:00 UTC is already tomorrow in Bangkok, so `today()` returned
 * yesterday, "today" was refused as a backdate and "tomorrow" was accepted as today. Green until
 * 17:00 UTC and red after it, which is a clock the suite should not have.
 */
const today = () => localDateIn(new Date(), tz);
const shift = (days: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return localDateIn(d, tz);
};

/**
 * Who may say when the money moved, and on which documents.
 *
 * Two gates, deliberately separate. The TYPE decides whether a day belongs on this document at all —
 * a configuration question, so that a per-document choice cannot let any requester re-date today's
 * disbursement as last March's. The PERMISSION decides whether this person may put that day in the
 * past — because deciding which quarter a spend falls in is a different act from raising the
 * document, and it is the one an auditor asks about.
 *
 * Both refuse rather than dropping the field: a date silently ignored looks like it worked and puts
 * the money in the wrong quarter, which is the failure the whole capability exists to prevent.
 */
describe.skipIf(!hasDb)('stating the day money moved', () => {
  let orm: MikroORM;
  let documents: DocumentService;
  let companyId = '';
  let deptId = '';
  let historyTypeId = '';
  let ordinaryTypeId = '';
  let userId = '';

  const asUser = <T>(grants: string[], fn: () => Promise<T>): Promise<T> =>
    RequestContext.run(
      { userId, companyId, departmentId: deptId, grants: grants.map((code) => ({ code, scope: 'COMPANY' })) as never },
      fn,
    );

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());

    const em = orm.em.fork();
    const company = await em.findOneOrFail(Company, { code: SEED_COMPANY_CODE }, FILTER_OFF);
    companyId = company.id;
    tz = company.timezone;
    deptId = (await em.findOneOrFail(Department, { company: companyId, deptCode: 'PROC' }, FILTER_OFF)).id;
    // A real user: createDraft stamps created_by, and a made-up id fails the foreign key.
    const { AppUser } = await import('../rbac/rbac.entities');
    userId = (await em.findOneOrFail(AppUser, { username: 'requester' }, FILTER_OFF)).id;

    // The seeded PR type is the control: an ordinary type, flag off, must refuse a day outright.
    const ordinary = await em.findOneOrFail(DocumentType, { company: companyId, code: 'PR' }, FILTER_OFF);
    ordinaryTypeId = ordinary.id;

    // A history type built by cloning the seeded one's routing, so a document of it is raisable in
    // the same department without configuring a second workflow and template by hand.
    const mapping = await new DeptDocTypeService(orm.em).resolve(deptId, ordinary.id);
    const history = em.create(DocumentType, {
      company: em.getReference(Company, companyId),
      code: 'SPEND_HIST',
      name: 'history',
      category: ordinary.category,
      recordsPastEvents: true,
    } as never);
    await em.persistAndFlush(history);
    historyTypeId = history.id;

    const em2 = orm.em.fork();
    const { DeptDocType, FormTemplate } = await import('./document.entities');
    const template = em2.create(FormTemplate, {
      documentType: em2.getReference(DocumentType, historyTypeId),
      version: 1,
      status: 'PUBLISHED',
    });
    await em2.persistAndFlush(template);
    em2.create(DeptDocType, {
      department: em2.getReference(Department, deptId),
      documentType: em2.getReference(DocumentType, historyTypeId),
      formTemplate: template,
      workflow: em2.getReference(
        (await import('../approval/approval.entities')).Workflow,
        mapping.workflow.id,
      ),
      isActive: true,
    } as never);
    await em2.flush();

    const scope = new CompanyScopeService(orm.em);
    documents = new DocumentService(
      orm.em,
      scope,
      new DeptDocTypeService(orm.em),
      new NumberingService(orm.em),
      new ItemService(orm.em, scope, new ScopeService(), new AccountService(orm.em, scope)),
      new BudgetService(orm.em, new AccountService(orm.em, scope), new BudgetBalanceService(orm.em)),
      new FiscalYearService(scope),
    );
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  it('refuses a day on a type that does not record past events', async () => {
    await expect(
      asUser([DocumentPermissions.DOC_BACKDATE], () =>
        documents.createDraft({ documentTypeId: ordinaryTypeId, moneyMovedOn: shift(-30) } as never),
      ),
    ).rejects.toThrow(/does not record past events/);
  });

  it('refuses a past day from a user without DOC_BACKDATE', async () => {
    await expect(
      asUser([DocumentPermissions.DOC_CREATE], () =>
        documents.createDraft({ documentTypeId: historyTypeId, moneyMovedOn: shift(-30) } as never),
      ),
    ).rejects.toThrow(/DOC_BACKDATE/);
  });

  it('lets that same user raise the type with no day at all', async () => {
    const doc = await asUser([DocumentPermissions.DOC_CREATE], () =>
      documents.createDraft({ documentTypeId: historyTypeId } as never),
    );
    expect(doc.moneyMovedOn).toBeUndefined();
  });

  it('refuses a day in the future even from a holder of DOC_BACKDATE', async () => {
    await expect(
      asUser([DocumentPermissions.DOC_BACKDATE], () =>
        documents.createDraft({ documentTypeId: historyTypeId, moneyMovedOn: shift(1) } as never),
      ),
    ).rejects.toThrow(/future/);
  });

  it('stores the day when the type allows it and the caller may backdate', async () => {
    const day = shift(-45);
    const doc = await asUser([DocumentPermissions.DOC_BACKDATE], () =>
      documents.createDraft({ documentTypeId: historyTypeId, moneyMovedOn: day } as never),
    );
    expect(doc.moneyMovedOn).toBe(day);
  });

  it('accepts today from a user who cannot backdate', async () => {
    // Today is not a past day, so it asks nothing of DOC_BACKDATE. The boundary matters: a rule
    // written as "any stated day needs the permission" would lock an ordinary user out of a type
    // configured for them.
    const doc = await asUser([DocumentPermissions.DOC_CREATE], () =>
      documents.createDraft({ documentTypeId: historyTypeId, moneyMovedOn: today() } as never),
    );
    expect(doc.moneyMovedOn).toBe(today());
  });
});
