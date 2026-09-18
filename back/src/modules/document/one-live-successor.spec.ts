import { BadRequestException, ConflictException } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { DocCategory, DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Workflow } from '../approval/approval.entities';
import { AccountService } from '../accounting/account.service';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { BudgetService } from '../budget/budget.service';
import { BudgetTxn } from '../budget/budget.entities';
import { Currency } from '../currency/currency.entities';
import { ItemService } from '../master-data/item.service';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { QuotaUsage } from '../quota/quota.entities';
import { AppUser } from '../rbac/rbac.entities';
import { ScopeService } from '../rbac/scope.service';
import { DeptDocTypeService } from './dept-doc-type.service';
import {
  DeptDocType,
  Document,
  DocumentType,
  DocumentTypeRef,
  FormTemplate,
} from './document.entities';
import { DocumentService } from './document.service';
import { NumberingService } from './numbering.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * One live successor per pairing.
 *
 * A chain reserves budget once and settles it once — the first DISB's approval converts ACTUAL
 * and releases the rest — so a second PO from the same PR could only fail at its LAST approval.
 * The engine refuses it at creation instead, names the one that exists, and lets a REJECTED or
 * CANCELLED successor be replaced. The partial unique index closes the race the service read
 * cannot; these tests build their schema from the entity, so the index is real here.
 */
describe.skipIf(!hasDb)('one live successor per pairing (DB-backed)', () => {
  let orm: MikroORM;
  let documents: DocumentService;

  const ids = { company: '', dept: '', user: '', dtPr: '', dtPo: '', dtDisb: '', tmplPr: '', wf: '' };
  let seq = 0;

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();

    const em = orm.em.fork();
    const lak = em.create(Currency, { code: 'LAK', name: 'Kip', decimalPlaces: 0, isActive: true });
    const company = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: lak, isActive: true });
    const dept = em.create(Department, { company, deptCode: 'DA', name: 'DA', isActive: true });
    const y = new Date().getUTCFullYear();
    em.create(FiscalYear, { company, year: y, startDate: `${y}-01-01`, endDate: `${y}-12-31`, status: 'OPEN' });
    const wf = em.create(Workflow, { company, name: 'WF', isActive: true });
    const user = em.create(AppUser, { username: 'u', email: 'u@x', status: 'ACTIVE' });

    const mk = (code: string, category: DocCategory) =>
      em.create(DocumentType, { company, code, name: code, category, requiresBudget: false, requiresQuota: false, isActive: true });
    const dtPr = mk('PR', DocCategory.PROCUREMENT);
    const dtPo = mk('PO', DocCategory.PROCUREMENT);
    const dtDisb = mk('DISB', DocCategory.FINANCE);
    const tmpls = [dtPr, dtPo, dtDisb].map((dt) => {
      const tmpl = em.create(FormTemplate, { documentType: dt, version: 1, status: 'PUBLISHED' });
      em.create(DeptDocType, { department: dept, documentType: dt, formTemplate: tmpl, workflow: wf, isActive: true });
      return tmpl;
    });
    em.create(DocumentTypeRef, { company, predecessorType: dtPr, successorType: dtPo, autoCreate: false });
    em.create(DocumentTypeRef, { company, predecessorType: dtPo, successorType: dtDisb, autoCreate: false });
    // A second successor type on the same predecessor: the rule is per pairing, not per predecessor.
    em.create(DocumentTypeRef, { company, predecessorType: dtPr, successorType: dtDisb, autoCreate: false });

    await em.flush();
    Object.assign(ids, {
      company: company.id, dept: dept.id, user: user.id,
      dtPr: dtPr.id, dtPo: dtPo.id, dtDisb: dtDisb.id, tmplPr: tmpls[0].id, wf: wf.id,
    });
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  beforeEach(() => {
    const scope = new CompanyScopeService(orm.em);
    documents = new DocumentService(
      orm.em, scope, new DeptDocTypeService(orm.em), new NumberingService(orm.em),
      new ItemService(orm.em, scope, new ScopeService(), new AccountService(orm.em, scope)),
      new BudgetService(orm.em, new AccountService(orm.em, scope), new BudgetBalanceService(orm.em)),
      new FiscalYearService(scope),
    );
  });

  const asUser = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId: ids.user, companyId: ids.company, departmentId: ids.dept, grants: [] }, fn);

  /** A COMPLETED predecessor of the given type, ready to be created from. */
  async function completed(typeId: string): Promise<{ id: string; docNo: string }> {
    const em = orm.em.fork();
    const d = em.create(Document, {
      docNo: `P-${seq++}`,
      company: em.getReference(Company, ids.company),
      department: em.getReference(Department, ids.dept),
      documentType: em.getReference(DocumentType, typeId),
      formTemplate: em.getReference(FormTemplate, ids.tmplPr),
      workflow: em.getReference(Workflow, ids.wf),
      currentStepNo: 1,
      createdBy: em.getReference(AppUser, ids.user),
      exchangeRate: '1',
      status: DocStatus.COMPLETED,
      createdAt: new Date(),
    });
    await em.flush();
    return { id: d.id, docNo: d.docNo };
  }

  async function setStatus(id: string, status: DocStatus): Promise<void> {
    const em = orm.em.fork();
    const d = await em.findOneOrFail(Document, { id }, FILTER_OFF);
    d.status = status;
    await em.flush();
  }

  const successorsOf = (id: string) =>
    orm.em.fork().find(Document, { refDocument: id }, FILTER_OFF);

  it('refuses a second PO from the same PR, naming the one that exists', async () => {
    const pr = await completed(ids.dtPr);
    const po = await asUser(() => documents.createFrom(pr.id, ids.dtPo));

    const again = asUser(() => documents.createFrom(pr.id, ids.dtPo));
    await expect(again).rejects.toBeInstanceOf(BadRequestException);
    await expect(again).rejects.toThrow(`${pr.docNo} already has PO ${po.docNo} (DRAFT)`);
    expect(await successorsOf(pr.id)).toHaveLength(1);
  });

  it('refuses a second DISB from a PO whose DISB is already COMPLETED', async () => {
    const po = await completed(ids.dtPo);
    const disb = await asUser(() => documents.createFrom(po.id, ids.dtDisb));
    await setStatus(disb.id, DocStatus.COMPLETED);

    await expect(asUser(() => documents.createFrom(po.id, ids.dtDisb))).rejects.toThrow(
      `${po.docNo} already has DISB ${disb.docNo} (COMPLETED)`,
    );
  });

  it.each([DocStatus.CANCELLED, DocStatus.REJECTED])('a %s successor frees the slot', async (status) => {
    const pr = await completed(ids.dtPr);
    const first = await asUser(() => documents.createFrom(pr.id, ids.dtPo));
    await setStatus(first.id, status);

    const second = await asUser(() => documents.createFrom(pr.id, ids.dtPo));

    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe(DocStatus.DRAFT);
    expect(await successorsOf(pr.id)).toHaveLength(2);
  });

  it('does not block a different successor type on the same predecessor', async () => {
    const pr = await completed(ids.dtPr);
    await asUser(() => documents.createFrom(pr.id, ids.dtPo));

    const disb = await asUser(() => documents.createFrom(pr.id, ids.dtDisb));

    expect(disb.status).toBe(DocStatus.DRAFT);
    expect(await successorsOf(pr.id)).toHaveLength(2);
  });

  it('writes no budget or quota ledger row while refusing', async () => {
    const pr = await completed(ids.dtPr);
    await asUser(() => documents.createFrom(pr.id, ids.dtPo));
    await expect(asUser(() => documents.createFrom(pr.id, ids.dtPo))).rejects.toThrow();

    const em = orm.em.fork();
    expect(await em.count(BudgetTxn, {}, FILTER_OFF)).toBe(0);
    expect(await em.count(QuotaUsage, {}, FILTER_OFF)).toBe(0);
  });

  // ---- Detail ----------------------------------------------------------------

  it('detail lists the live successors and omits a cancelled one', async () => {
    const pr = await completed(ids.dtPr);
    const po = await asUser(() => documents.createFrom(pr.id, ids.dtPo));
    const disb = await asUser(() => documents.createFrom(pr.id, ids.dtDisb));
    await setStatus(disb.id, DocStatus.CANCELLED);

    const { successors } = await asUser(() => documents.detail(pr.id));

    expect(successors).toEqual([{ id: po.id, docNo: po.docNo, typeCode: 'PO', status: DocStatus.DRAFT }]);
  });

  it('detail returns an empty list for a document nothing was raised from', async () => {
    const pr = await completed(ids.dtPr);
    const { successors } = await asUser(() => documents.detail(pr.id));
    expect(successors).toEqual([]);
  });

  // ---- Concurrency ------------------------------------------------------------

  it('lets exactly one of two concurrent create-froms through', async () => {
    const pr = await completed(ids.dtPr);

    const results = await Promise.allSettled([
      asUser(() => documents.createFrom(pr.id, ids.dtPo)),
      asUser(() => documents.createFrom(pr.id, ids.dtPo)),
    ]);

    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    // Refused by the service read (400) or by the index (409) — which one depends on the
    // interleaving; that exactly one PO exists does not.
    expect(
      lost[0].reason instanceof BadRequestException || lost[0].reason instanceof ConflictException,
    ).toBe(true);
    expect(lost[0].reason.message).toMatch(new RegExp(`^${pr.docNo} already has PO `));
    expect(await successorsOf(pr.id)).toHaveLength(1);
  });

  it('turns the index violation into a 409 naming the winner when the service read is stale', async () => {
    const pr = await completed(ids.dtPr);
    const po = await asUser(() => documents.createFrom(pr.id, ids.dtPo));
    // Simulate the race deterministically: the pre-insert read saw no successor.
    const read = vi.spyOn(documents as unknown as { liveSuccessor: () => Promise<string | null> }, 'liveSuccessor');
    read.mockResolvedValueOnce(null);

    const lost = asUser(() => documents.createFrom(pr.id, ids.dtPo));

    await expect(lost).rejects.toBeInstanceOf(ConflictException);
    await expect(lost).rejects.toThrow(`${pr.docNo} already has PO ${po.docNo} (DRAFT)`);
    expect(await successorsOf(pr.id)).toHaveLength(1);
    read.mockRestore();
  });
});
