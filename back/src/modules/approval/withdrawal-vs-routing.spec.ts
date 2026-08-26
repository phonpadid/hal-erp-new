import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { ApproveAction, DocCategory, DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Company, Department } from '../multi-company/multi-company.entities';
import { Currency } from '../currency/currency.entities';
import {
  Document,
  DocumentType,
  FormTemplate,
} from '../document/document.entities';
import { DocumentSubmitService } from '../document/document-submit.service';
import { AppUser } from '../rbac/rbac.entities';
import { ApprovalRoutingService } from './approval-routing.service';
import { ApproverResolverService } from './approver-resolver.service';
import { DocumentRouteService } from './document-route.service';
import { WorkflowStepResolver } from './workflow-step.resolver';
import {
  ApprovalLog,
  DocumentApprovalStep,
  Workflow,
  WorkflowStep,
} from './approval.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * Withdrawing a document and opening its route are two transactions that can overlap.
 *
 * Routing starts from the `document.submitted` event, after the submit transaction commits, so a
 * document sits in `SUBMITTED` with no route for as long as it takes the listener to run — and
 * `cancel()` accepts a withdrawal in exactly that window, as it should. What must not happen is
 * the router writing `IN_APPROVAL` over a withdrawal that has already been accepted, logged and
 * released: the request its author withdrew would reappear in an approver's queue holding nothing,
 * unable to be approved (settlement would find no outstanding reservation) and looking to everyone
 * like it was still moving.
 *
 * Both paths now read the document row under `LockMode.PESSIMISTIC_WRITE`, the lock `act()` has
 * always taken, so whichever gets there second sees what the first wrote.
 */
describe.skipIf(!hasDb)('a withdrawal racing the router (DB-backed)', () => {
  let orm: MikroORM;
  let routing: ApprovalRoutingService;
  let submit: DocumentSubmitService;
  let seq = 0;

  const ids = {
    company: '',
    dept: '',
    dt: '',
    tmpl: '',
    creator: '',
    approver: '',
    workflow: '',
  };

  const asCreator = <T>(fn: () => Promise<T>) =>
    RequestContext.run(
      {
        userId: ids.creator,
        companyId: ids.company,
        departmentId: ids.dept,
        grants: [],
      },
      fn,
    );

  /** A document already past submit: SUBMITTED, holding nothing, with no route opened yet. */
  async function submitted(): Promise<string> {
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `W-${seq++}`,
      company: em.getReference(Company, ids.company),
      department: em.getReference(Department, ids.dept),
      documentType: em.getReference(DocumentType, ids.dt),
      formTemplate: em.getReference(FormTemplate, ids.tmpl),
      workflow: em.getReference(Workflow, ids.workflow),
      currentStepNo: 0,
      createdBy: em.getReference(AppUser, ids.creator),
      exchangeRate: '1',
      totalAmount: '1000',
      baseTotalAmount: '1000',
      status: DocStatus.SUBMITTED,
      submittedAt: new Date(),
      createdAt: new Date(),
    });
    await em.flush();
    return doc.id;
  }

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();

    const em = orm.em.fork();
    const thb = em.create(Currency, {
      code: 'THB',
      name: 'Baht',
      decimalPlaces: 2,
      isActive: true,
    });
    const company = em.create(Company, {
      code: 'W',
      nameTh: 'W',
      taxId: '1',
      branchCode: '00000',
      baseCurrency: thb,
      isActive: true,
    });
    const dept = em.create(Department, {
      company,
      deptCode: 'D',
      name: 'D',
      isActive: true,
    });
    const creator = em.create(AppUser, {
      username: 'w-creator',
      email: 'w-creator@x',
      status: 'ACTIVE',
    });
    const approver = em.create(AppUser, {
      username: 'w-approver',
      email: 'w-approver@x',
      status: 'ACTIVE',
    });
    const dt = em.create(DocumentType, {
      company,
      code: 'WMEMO',
      name: 'Memo',
      category: DocCategory.ADMIN,
      requiresBudget: false,
      requiresQuota: false,
      isActive: true,
    });
    const tmpl = em.create(FormTemplate, {
      documentType: dt,
      version: 1,
      status: 'PUBLISHED',
    });
    const wf = em.create(Workflow, { company, name: 'W-WF', isActive: true });
    em.create(WorkflowStep, {
      workflow: wf,
      stepNo: 1,
      approverUser: approver,
      approveMode: 'SEQUENTIAL',
      showSignatureOnPdf: true,
    });
    await em.flush();
    Object.assign(ids, {
      company: company.id,
      dept: dept.id,
      dt: dt.id,
      tmpl: tmpl.id,
      creator: creator.id,
      approver: approver.id,
      workflow: wf.id,
    });

    const em2 = orm.em.fork();
    const resolver = new ApproverResolverService(em2);
    const route = new DocumentRouteService(
      em2,
      new WorkflowStepResolver(em2),
      resolver,
    );
    const postAction = {
      assertApprovable: () => Promise.resolve(undefined),
      run: () =>
        Promise.resolve({ paymentReady: false, stockTxnIds: [] as string[] }),
    } as never;

    // `cancel()` is the only method under test, so everything it does not reach is left out.
    // What it DOES reach — releasing budget and quota holds — is stubbed: this memo type holds
    // neither, and the release is another capability's business.
    const noHolds = { releaseAll: () => Promise.resolve(undefined) } as never;
    submit = new DocumentSubmitService(
      em2,
      null as never,
      null as never,
      null as never,
      null as never,
      noHolds,
      noHolds,
    );
    routing = new ApprovalRoutingService(
      em2,
      resolver,
      postAction,
      submit,
      route,
    );
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  it('never leaves a withdrawn document routing, however the two interleave', async () => {
    // Run the race several times: the interleaving is the operating system's to choose, and one
    // pass proves nothing about a lock that is missing.
    const ROUNDS = 8;
    const docIds = await Promise.all(
      Array.from({ length: ROUNDS }, () => submitted()),
    );

    for (const docId of docIds) {
      await Promise.allSettled([
        asCreator(() => submit.cancel(docId, { remark: 'withdrawn at once' })),
        routing.start(docId),
      ]);
    }

    const em = orm.em.fork();
    for (const docId of docIds) {
      const doc = await em.findOneOrFail(
        Document,
        { id: docId },
        { ...FILTER_OFF, refresh: true },
      );
      const log = await em.find(ApprovalLog, { document: docId }, FILTER_OFF);
      const withdrawn = log.some((l) => l.action === ApproveAction.CANCEL);

      // Either outcome is legitimate — the withdrawal may lose the race and find the document
      // already IN_APPROVAL, which `cancel()` also allows. What is never legitimate is a document
      // whose history says its author ended it and whose status says an approver still owns it.
      if (withdrawn) {
        expect(
          doc.status,
          `${doc.docNo} was withdrawn and then put back into approval`,
        ).toBe(DocStatus.CANCELLED);
      } else {
        expect(doc.status).toBe(DocStatus.IN_APPROVAL);
      }
    }
  });

  it('does not open a route on a document that was withdrawn first', async () => {
    const docId = await submitted();
    await asCreator(() =>
      submit.cancel(docId, { remark: 'withdrawn before routing' }),
    );

    await expect(routing.start(docId)).rejects.toThrow(/not SUBMITTED/i);

    const em = orm.em.fork();
    const doc = await em.findOneOrFail(Document, { id: docId }, FILTER_OFF);
    expect(doc.status).toBe(DocStatus.CANCELLED);
    expect(doc.currentStepNo, 'a withdrawn document waits on nobody').toBe(0);
    expect(
      await em.count(DocumentApprovalStep, { document: docId }, FILTER_OFF),
    ).toBe(0);
  });
});
