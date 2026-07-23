import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { DocStatus, DocCategory } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Company, Department } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { Currency } from '../currency/currency.entities';
import { Workflow } from '../approval/approval.entities';
import { Document, DocumentLine, DocumentType, FormTemplate } from './document.entities';
import { ReceivingService } from './receiving.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

describe.skipIf(!hasDb)('goods receipt / partial receive (DB-backed)', () => {
  let orm: MikroORM;
  const ids = { company: '', dept: '', user: '', type: '', tmpl: '', wf: '' };
  let seq = 0;

  function asUser<T>(fn: () => Promise<T>): Promise<T> {
    return RequestContext.run({ userId: ids.user, companyId: ids.company, departmentId: ids.dept, grants: [] }, fn);
  }

  /** A PO document with one line of the given ordered qty; returns [docId, lineId]. */
  async function poWithLine(qty: string): Promise<{ docId: string; lineId: string }> {
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `PO-${seq++}`,
      company: em.getReference(Company, ids.company),
      department: em.getReference(Department, ids.dept),
      documentType: em.getReference(DocumentType, ids.type),
      formTemplate: em.getReference(FormTemplate, ids.tmpl),
      workflow: em.getReference(Workflow, ids.wf),
      createdBy: em.getReference(AppUser, ids.user),
      exchangeRate: '1',
      status: DocStatus.APPROVED,
      createdAt: new Date(),
    });
    const line = em.create(DocumentLine, { document: doc, lineNo: 1, description: 'Widget', qty, unitPrice: '10', lineAmount: '100' });
    await em.flush();
    return { docId: doc.id, lineId: line.id };
  }

  const reloadLine = (id: string) => orm.em.fork().findOneOrFail(DocumentLine, { id }, FILTER_OFF);

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const company = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true });
    const dept = em.create(Department, { company, deptCode: 'DA', name: 'DA', isActive: true });
    const user = em.create(AppUser, { username: 'buyer', email: 'buyer@x', status: 'ACTIVE' });
    const type = em.create(DocumentType, { company: company, code: 'PO', name: 'PO', category: DocCategory.PROCUREMENT, requiresBudget: false, requiresQuota: false, isActive: true });
    const tmpl = em.create(FormTemplate, { documentType: type, version: 1, status: 'PUBLISHED' });
    const wf = em.create(Workflow, { company, name: 'WF', isActive: true });
    await em.flush();
    Object.assign(ids, { company: company.id, dept: dept.id, user: user.id, type: type.id, tmpl: tmpl.id, wf: wf.id });
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  it('advances line status from PARTIAL to RECEIVED across receipts', async () => {
    const { docId, lineId } = await poWithLine('10');
    const svc = new ReceivingService(new CompanyScopeService(orm.em));

    await asUser(() => svc.receive(docId, { lines: [{ lineId, qty: '4' }] }));
    let line = await reloadLine(lineId);
    expect(line.lineStatus).toBe('PARTIAL');
    expect(Number(line.receivedQty)).toBe(4);

    await asUser(() => svc.receive(docId, { lines: [{ lineId, qty: '6' }] }));
    line = await reloadLine(lineId);
    expect(line.lineStatus).toBe('RECEIVED');
    expect(Number(line.receivedQty)).toBe(10);
  });

  it('rejects over-receipt and leaves received_qty unchanged', async () => {
    const { docId, lineId } = await poWithLine('10');
    const svc = new ReceivingService(new CompanyScopeService(orm.em));
    await asUser(() => svc.receive(docId, { lines: [{ lineId, qty: '8' }] }));

    await expect(asUser(() => svc.receive(docId, { lines: [{ lineId, qty: '3' }] }))).rejects.toThrow(/over-receipt/i);
    expect(Number((await reloadLine(lineId)).receivedQty)).toBe(8);
  });

  it('serializes concurrent receipts without lost updates', async () => {
    const { docId, lineId } = await poWithLine('10');
    // Each service on its own fork — mirrors two concurrent requests.
    const a = new ReceivingService(new CompanyScopeService(orm.em));
    const b = new ReceivingService(new CompanyScopeService(orm.em));

    await Promise.all([
      asUser(() => a.receive(docId, { lines: [{ lineId, qty: '3' }] })),
      asUser(() => b.receive(docId, { lines: [{ lineId, qty: '3' }] })),
    ]);

    expect(Number((await reloadLine(lineId)).receivedQty)).toBe(6);
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[receiving] no database reachable — skipping DB-backed spec');
}
