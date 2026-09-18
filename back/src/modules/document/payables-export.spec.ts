import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import 'reflect-metadata';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { DocCategory, DocStatus, Scope } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { PERMISSIONS_KEY } from '../../auth/require-permissions.decorator';
import { Company, Department } from '../multi-company/multi-company.entities';
import { Currency } from '../currency/currency.entities';
import { AppUser } from '../rbac/rbac.entities';
import { Vendor, VendorBankAccount } from '../master-data/master-data.entities';
import { ApprovalLog, Workflow } from '../approval/approval.entities';
import { BudgetTxn } from '../budget/budget.entities';
import { DocumentController } from './document.controller';
import {
  DocFieldValue,
  Document,
  DocumentLine,
  DocumentType,
  FormField,
  FormTemplate,
} from './document.entities';
import { DocumentService } from './document.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * `DocumentService.exportPayables`: the filtered list, whole, shaped for finance's sheet.
 *
 * The contract is "never a row the list would not show": same filter, same visibility, no page.
 * The default is the pending set because that is the sheet finance builds.
 */
describe.skipIf(!hasDb)('payables export (DB-backed)', () => {
  let orm: MikroORM;
  let svc: DocumentService;
  let seq = 0;

  const ids = {
    companyA: '',
    companyB: '',
    adm: '',
    purchasing: '',
    hr: '',
    deptB: '',
    dtPr: '',
    dtRec: '',
    tmpl: '',
    reasonField: '',
    wf: '',
    wfB: '',
    user: '',
    other: '',
    payee: '',
  };

  const as = <T>(
    scope: Scope,
    fn: () => Promise<T>,
    departmentId = ids.adm,
    companyId = ids.companyA,
  ) =>
    RequestContext.run(
      {
        userId: ids.user,
        companyId,
        departmentId,
        grants: [{ code: 'DOC_VIEW', scope }],
      },
      fn,
    );

  interface DocSpec {
    status?: DocStatus;
    department?: string;
    type?: string;
    currency?: string | null;
    grandTotal?: string;
    submittedAt?: Date;
    createdAt?: Date;
    lines?: string[];
    reason?: string;
    company?: string;
    createdBy?: string;
    payee?: boolean;
  }

  async function doc(spec: DocSpec = {}): Promise<Document> {
    const em = orm.em.fork();
    const companyId = spec.company ?? ids.companyA;
    const n = String(++seq).padStart(4, '0');
    const d = em.create(Document, {
      docNo: `PR-X-2026-${n}`,
      company: em.getReference(Company, companyId),
      department: em.getReference(Department, spec.department ?? ids.adm),
      documentType: em.getReference(DocumentType, spec.type ?? ids.dtPr),
      formTemplate: em.getReference(FormTemplate, ids.tmpl),
      workflow: em.getReference(
        Workflow,
        companyId === ids.companyA ? ids.wf : ids.wfB,
      ),
      createdBy: em.getReference(AppUser, spec.createdBy ?? ids.user),
      vendorBankAccount: spec.payee ? em.getReference(VendorBankAccount, ids.payee) : undefined,
      currency:
        spec.currency === null
          ? undefined
          : em.getReference(Currency, spec.currency ?? 'LAK'),
      exchangeRate: '1',
      grandTotal: spec.grandTotal ?? '100.00',
      baseTotalAmount: spec.grandTotal ?? '100.00',
      status: spec.status ?? DocStatus.IN_APPROVAL,
      submittedAt: spec.submittedAt ?? new Date(2026, 8, 15),
      createdAt: spec.createdAt ?? new Date(2026, 8, 14),
    } as never);
    (spec.lines ?? []).forEach((description, i) =>
      em.create(DocumentLine, {
        document: d,
        lineNo: i + 1,
        description,
        qty: '1',
        unitPrice: '0',
        lineAmount: '0',
      } as never),
    );
    if (spec.reason !== undefined) {
      em.create(DocFieldValue, {
        document: d,
        formField: em.getReference(FormField, ids.reasonField),
        fieldValue: spec.reason,
      } as never);
    }
    await em.flush();
    return d;
  }

  const exportRows = (q: Record<string, unknown> = {}, scope = Scope.COMPANY) =>
    as(scope, () => svc.exportPayables(q as never));

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const lak = em.create(Currency, {
      code: 'LAK',
      name: 'Kip',
      decimalPlaces: 0,
      isActive: true,
    });
    em.create(Currency, {
      code: 'THB',
      name: 'Baht',
      decimalPlaces: 2,
      isActive: true,
    });
    const a = em.create(Company, {
      code: 'HAL',
      nameTh: 'A',
      taxId: '1',
      branchCode: '00000',
      baseCurrency: lak,
      isActive: true,
    });
    const b = em.create(Company, {
      code: 'OTH',
      nameTh: 'B',
      taxId: '2',
      branchCode: '00000',
      baseCurrency: lak,
      isActive: true,
    });
    const adm = em.create(Department, {
      company: a,
      deptCode: 'ADM',
      name: 'ພະແນກບໍລິຫານ',
      shortName: 'ບຫ',
      isActive: true,
    });
    const purchasing = em.create(Department, {
      company: a,
      deptCode: 'PUR',
      name: 'ໜ່ວຍງານຈັດຊື້',
      parentDept: adm,
      isActive: true,
    });
    const hr = em.create(Department, {
      company: a,
      deptCode: 'HR',
      name: 'ບຸກຄະລາກອນ',
      isActive: true,
    });
    const deptB = em.create(Department, {
      company: b,
      deptCode: 'X',
      name: 'X',
      isActive: true,
    });
    const user = em.create(AppUser, {
      username: 'pay-u',
      email: 'pay-u@x',
      status: 'ACTIVE',
    });
    const other = em.create(AppUser, {
      username: 'pay-o',
      email: 'pay-o@x',
      status: 'ACTIVE',
    });
    const dtPr = em.create(DocumentType, {
      company: a,
      code: 'PR',
      name: 'PR',
      shortName: 'ຈຊຈ',
      category: DocCategory.FINANCE,
      requiresBudget: false,
      requiresQuota: false,
      isActive: true,
    });
    const dtRec = em.create(DocumentType, {
      company: a,
      code: 'REC',
      name: 'REC',
      category: DocCategory.FINANCE,
      requiresBudget: false,
      requiresQuota: false,
      isActive: true,
    });
    const tmpl = em.create(FormTemplate, {
      documentType: dtPr,
      version: 1,
      status: 'PUBLISHED',
    });
    const reasonField = em.create(FormField, {
      formTemplate: tmpl,
      fieldName: 'Reson',
      fieldLabel: 'Reason',
      fieldType: 'text',
      isRequired: false,
      sortOrder: 1,
    });
    const vendor = em.create(Vendor, { company: a, vendorCode: 'V1', name: 'Khamseng', isActive: true } as never);
    const payee = em.create(VendorBankAccount, {
      vendor, bankCode: 'BCEL', accountNo: '2101203519110', accountName: 'KHAMSENG', isPrimary: true, isActive: true,
    } as never);
    const wf = em.create(Workflow, { company: a, name: 'WF', isActive: true });
    const wfB = em.create(Workflow, {
      company: b,
      name: 'WF-B',
      isActive: true,
    });
    await em.flush();
    Object.assign(ids, {
      companyA: a.id,
      companyB: b.id,
      adm: adm.id,
      purchasing: purchasing.id,
      hr: hr.id,
      deptB: deptB.id,
      dtPr: dtPr.id,
      dtRec: dtRec.id,
      tmpl: tmpl.id,
      reasonField: reasonField.id,
      wf: wf.id,
      wfB: wfB.id,
      user: user.id,
      other: other.id,
      payee: payee.id,
    });
    svc = new DocumentService(
      orm.em,
      new CompanyScopeService(orm.em),
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
    );
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  it('defaults to the pending set and lets a named status replace it', async () => {
    const draft = await doc({ status: DocStatus.DRAFT });
    const submitted = await doc({ status: DocStatus.SUBMITTED });
    const inApproval = await doc({ status: DocStatus.IN_APPROVAL });
    const completed = await doc({ status: DocStatus.COMPLETED });

    const pending = (await exportRows()).rows.map((r) => r.docNo);
    expect(pending).toEqual(
      expect.arrayContaining([submitted.docNo, inApproval.docNo]),
    );
    expect(pending).not.toContain(draft.docNo);
    expect(pending).not.toContain(completed.docNo);

    const done = (await exportRows({ status: [DocStatus.COMPLETED] })).rows.map(
      (r) => r.docNo,
    );
    expect(done).toContain(completed.docNo);
    expect(done).not.toContain(inApproval.docNo);
  });

  it("narrows by the list's filters and yields exactly the ids the list yields", async () => {
    const inRange = await doc({
      department: ids.hr,
      createdAt: new Date('2026-03-10T00:00:00Z'),
    });
    await doc({
      department: ids.hr,
      createdAt: new Date('2026-05-10T00:00:00Z'),
    });
    await doc({
      department: ids.adm,
      createdAt: new Date('2026-03-10T00:00:00Z'),
    });
    const q = {
      departmentId: ids.hr,
      createdFrom: '2026-03-01',
      createdTo: '2026-03-31',
    };

    const exported = (await exportRows(q)).rows.map((r) => r.docNo).sort();
    const listed = (
      await as(Scope.COMPANY, () =>
        svc.list({ ...q, status: [DocStatus.IN_APPROVAL] }),
      )
    ).items
      .map((d) => d.docNo)
      .sort();
    expect(exported).toEqual(listed);
    expect(exported).toEqual([inRange.docNo]);
  });

  it("is bounded by the reader's DOC_VIEW scope exactly as the list is", async () => {
    const mine = await doc({ department: ids.adm, createdBy: ids.user });
    const elsewhere = await doc({ department: ids.hr, createdBy: ids.other });
    const exported = (await exportRows({}, Scope.DEPARTMENT)).rows.map(
      (r) => r.docNo,
    );
    // The list has no status default; ask it for the pending set the export defaults to.
    const pending = { status: [DocStatus.SUBMITTED, DocStatus.IN_APPROVAL] };
    const listed = (
      await as(Scope.DEPARTMENT, () => svc.list(pending as never))
    ).items.map((d) => d.docNo);
    expect(exported).toContain(mine.docNo);
    expect(exported).not.toContain(elsewhere.docNo);
    expect(exported.sort()).toEqual(listed.sort());
  });

  it('never crosses companies, and a foreign departmentId matches nothing', async () => {
    const foreign = await doc({ company: ids.companyB, department: ids.deptB });
    expect((await exportRows()).rows.map((r) => r.docNo)).not.toContain(
      foreign.docNo,
    );
    expect((await exportRows({ departmentId: ids.deptB })).rows).toEqual([]);
  });

  it('composes the paper number from the running part and the configured abbreviations', async () => {
    const stamped = await doc({ type: ids.dtPr, department: ids.adm });
    const fallback = await doc({ type: ids.dtRec, department: ids.hr });
    const rows = (await exportRows()).rows;
    const running = (d: Document) => d.docNo.slice(-4);
    expect(rows.find((r) => r.docNo === stamped.docNo)).toMatchObject({
      runningNo: running(stamped),
      typeAbbrev: 'ຈຊຈ',
      deptAbbrev: 'ບຫ',
    });
    expect(rows.find((r) => r.docNo === fallback.docNo)).toMatchObject({
      runningNo: running(fallback),
      typeAbbrev: 'REC',
      deptAbbrev: 'HR',
    });
  });

  it('describes a document by its lines, else by its stripped form text, else blank', async () => {
    const itemised = await doc({
      lines: ['A', '', 'B'],
      reason: '<p>ignored</p>',
    });
    const letter = await doc({
      lines: [''],
      reason: '<p>ຂໍສະເໜີ&nbsp;ເບີກງົບ</p>',
    });
    const silent = await doc({});
    const rows = (await exportRows()).rows;
    expect(rows.find((r) => r.docNo === itemised.docNo)?.description).toBe(
      'A; B',
    );
    expect(rows.find((r) => r.docNo === letter.docNo)?.description).toBe(
      'ຂໍສະເໜີ ເບີກງົບ',
    );
    expect(rows.find((r) => r.docNo === silent.docNo)?.description).toBe('');
  });

  it('carries each amount in its own currency and puts a currency-less document in base', async () => {
    const thb = await doc({ currency: 'THB', grandTotal: '1500.00' });
    const none = await doc({ currency: null, grandTotal: '2500000.00' });
    const rows = (await exportRows()).rows;
    expect(rows.find((r) => r.docNo === thb.docNo)).toMatchObject({
      currencyCode: 'THB',
      grandTotal: '1500.00',
    });
    expect(rows.find((r) => r.docNo === none.docNo)).toMatchObject({
      currencyCode: 'LAK',
      grandTotal: '2500000.00',
    });
    expect((await exportRows()).options.decimalPlaces).toMatchObject({
      LAK: 0,
      THB: 2,
    });
  });

  it("carries the payee's bank code, and nothing for a document that names no payee", async () => {
    const paid = await doc({ payee: true });
    const bare = await doc({});
    const rows = (await exportRows()).rows;
    expect(rows.find((r) => r.docNo === paid.docNo)?.payeeBank).toBe('BCEL');
    expect(rows.find((r) => r.docNo === bare.docNo)?.payeeBank).toBe('');
  });

  it('resolves a sub-department to its root for grouping and keeps its own name for the section', async () => {
    const child = await doc({ department: ids.purchasing });
    const r = (await exportRows()).rows.find((x) => x.docNo === child.docNo);
    expect(r).toMatchObject({
      departmentName: 'ໜ່ວຍງານຈັດຊື້',
      deptAbbrev: 'PUR',
      rootDeptCode: 'ADM',
      rootDeptName: 'ພະແນກບໍລິຫານ',
    });
  });

  it('orders newest submit first and names the file after the company and the day', async () => {
    const older = await doc({ submittedAt: new Date(2026, 7, 1) });
    const newer = await doc({ submittedAt: new Date(2026, 8, 17) });
    const { rows, fileName } = await exportRows();
    const pos = (d: Document) => rows.findIndex((r) => r.docNo === d.docNo);
    expect(pos(newer)).toBeLessThan(pos(older));
    expect(fileName).toMatch(/^payables-HAL-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  it('writes nothing', async () => {
    await doc({});
    const em = orm.em.fork();
    const before = await Promise.all([
      em.count(Document, {}, FILTER_OFF),
      em.count(BudgetTxn, {}, FILTER_OFF),
      em.count(ApprovalLog, {}, FILTER_OFF),
    ]);
    await exportRows();
    const after = await Promise.all([
      em.count(Document, {}, FILTER_OFF),
      em.count(BudgetTxn, {}, FILTER_OFF),
      em.count(ApprovalLog, {}, FILTER_OFF),
    ]);
    expect(after).toEqual(before);
  });
});

describe('payables export route', () => {
  it('is gated by DOC_VIEW, the same code as the list', () => {
    const handlers = DocumentController.prototype as unknown as Record<
      string,
      object
    >;
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, handlers.exportPayables),
    ).toEqual(['DOC_VIEW']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handlers.list)).toEqual([
      'DOC_VIEW',
    ]);
  });
});

if (!hasDb) {
  console.warn(
    '[payables-export] no database reachable — skipping DB-backed spec',
  );
}
