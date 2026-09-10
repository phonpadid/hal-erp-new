import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { DocCategory, DocStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { AccountService } from '../accounting/account.service';
import { Workflow } from '../approval/approval.entities';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { BudgetService } from '../budget/budget.service';
import { BudgetTxn } from '../budget/budget.entities';
import { Currency } from '../currency/currency.entities';
import { ItemService } from '../master-data/item.service';
import {
  Company,
  Department,
  FiscalYear,
} from '../multi-company/multi-company.entities';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { AppUser } from '../rbac/rbac.entities';
import { ScopeService } from '../rbac/scope.service';
import { DeptDocTypeService } from './dept-doc-type.service';
import {
  DeptDocType,
  DocFieldValue,
  Document,
  DocumentType,
  DocumentTypeRef,
  FormField,
  FormTemplate,
} from './document.entities';
import { DocumentService } from './document.service';
import { NumberingService } from './numbering.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();

/**
 * A successor raised automatically has nobody to fill it in.
 *
 * The claim recovery is the case that forced this: it is created by `CREATE_SUCCESSOR` at the
 * moment its predecessor is approved, and the system that raised the claim is finished by then, so
 * without inheritance the recovery reaches a person holding an amount and nothing that says who it
 * is against. What is pinned here is the boundary — a name both forms declare travels, anything
 * else does not, and the successor's own field definition still decides what it may hold.
 */
describe.skipIf(!hasDb)('successor field inheritance (DB-backed)', () => {
  let orm: MikroORM;
  let documents: DocumentService;
  const ids = {
    company: '',
    dept: '',
    user: '',
    predType: '',
    succType: '',
    predTmpl: '',
    succTmpl: '',
    wf: '',
  };

  /** An APPROVED predecessor carrying the field values given, keyed by field name. */
  async function approvedPredecessor(
    values: Record<string, string>,
  ): Promise<string> {
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `PRED-${Math.abs(hash(JSON.stringify(values)))}`,
      company: em.getReference(Company, ids.company),
      department: em.getReference(Department, ids.dept),
      documentType: em.getReference(DocumentType, ids.predType),
      formTemplate: em.getReference(FormTemplate, ids.predTmpl),
      workflow: em.getReference(Workflow, ids.wf),
      createdBy: em.getReference(AppUser, ids.user),
      exchangeRate: '1',
      totalAmount: '500000.00',
      baseTotalAmount: '500000.00',
      status: DocStatus.APPROVED,
      createdAt: new Date(),
    });
    const fields = await em.find(FormField, { formTemplate: ids.predTmpl });
    for (const [name, value] of Object.entries(values)) {
      const field = fields.find((f) => f.fieldName === name)!;
      em.create(DocFieldValue, {
        document: doc,
        formField: field,
        fieldValue: value,
      });
    }
    await em.flush();
    return doc.id;
  }

  /** The successor's field values, keyed by field name. */
  async function valuesOf(documentId: string): Promise<Record<string, string>> {
    const em = orm.em.fork();
    // Read outside a request context, so the company filter has no arguments to apply — the same
    // trap the production read avoids by running on a company-scoped EntityManager.
    const rows = await em.find(
      DocFieldValue,
      { document: documentId },
      { populate: ['formField'], filters: { company: false } },
    );
    return Object.fromEntries(
      rows.map((r) => [r.formField.fieldName, r.fieldValue]),
    );
  }

  /** Stable enough for a document number; the spec asserts nothing about it. */
  function hash(s: string): number {
    let h = 0;
    for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return h;
  }

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
    const company = em.create(Company, {
      code: 'A',
      nameTh: 'A',
      taxId: '1',
      branchCode: '00000',
      baseCurrency: lak,
      timezone: 'Asia/Vientiane',
      isActive: true,
    });
    const dept = em.create(Department, {
      company,
      deptCode: 'DA',
      name: 'DA',
      isActive: true,
    });
    const y = new Date().getUTCFullYear();
    em.create(FiscalYear, {
      company,
      year: y,
      startDate: `${y}-01-01`,
      endDate: `${y}-12-31`,
      status: 'OPEN',
    });
    const wf = em.create(Workflow, { company, name: 'WF', isActive: true });
    const user = em.create(AppUser, {
      username: 'raiser',
      email: 'raiser@x',
      status: 'ACTIVE',
    });

    // The pair the claim line will configure: what we paid on somebody's behalf, and the note to
    // go and recover it. Neither requires budget here — this spec is about the fields.
    const predType = em.create(DocumentType, {
      company,
      code: 'CLAIM_ADVANCE',
      name: 'Advance',
      category: DocCategory.FINANCE,
      requiresBudget: false,
      requiresQuota: false,
      postAction: 'CREATE_SUCCESSOR',
      isActive: true,
    });
    const succType = em.create(DocumentType, {
      company,
      code: 'CLAIM_RECOVERY',
      name: 'Recovery',
      category: DocCategory.FINANCE,
      requiresBudget: false,
      requiresQuota: false,
      isActive: true,
    });
    const predTmpl = em.create(FormTemplate, {
      documentType: predType,
      version: 1,
      status: 'PUBLISHED',
    });
    const succTmpl = em.create(FormTemplate, {
      documentType: succType,
      version: 1,
      status: 'PUBLISHED',
    });

    // The predecessor asks four things; the successor asks for two of them by the same name, one
    // of them with a NARROWER option list, and one thing of its own.
    em.create(FormField, {
      formTemplate: predTmpl,
      fieldName: 'liableParty',
      fieldLabel: 'Party',
      fieldType: 'text',
      isRequired: true,
      sortOrder: 1,
    });
    em.create(FormField, {
      formTemplate: predTmpl,
      fieldName: 'claimRef',
      fieldLabel: 'Claim',
      fieldType: 'text',
      isRequired: true,
      sortOrder: 2,
    });
    em.create(FormField, {
      formTemplate: predTmpl,
      fieldName: 'claimKind',
      fieldLabel: 'Kind',
      fieldType: 'text',
      isRequired: false,
      sortOrder: 3,
    });
    em.create(FormField, {
      formTemplate: predTmpl,
      fieldName: 'settlementKind',
      fieldLabel: 'Settlement',
      fieldType: 'dropdown',
      isRequired: false,
      sortOrder: 4,
      optionsJson: JSON.stringify(['CASH', 'TRANSFER']),
    });

    em.create(FormField, {
      formTemplate: succTmpl,
      fieldName: 'liableParty',
      fieldLabel: 'Party',
      fieldType: 'text',
      isRequired: true,
      sortOrder: 1,
    });
    em.create(FormField, {
      formTemplate: succTmpl,
      fieldName: 'claimRef',
      fieldLabel: 'Claim',
      fieldType: 'text',
      isRequired: true,
      sortOrder: 2,
    });
    em.create(FormField, {
      formTemplate: succTmpl,
      fieldName: 'settlementKind',
      fieldLabel: 'Settlement',
      fieldType: 'dropdown',
      isRequired: false,
      sortOrder: 3,
      optionsJson: JSON.stringify(['TRANSFER']),
    });
    em.create(FormField, {
      formTemplate: succTmpl,
      fieldName: 'collectedBy',
      fieldLabel: 'Collector',
      fieldType: 'text',
      isRequired: false,
      sortOrder: 4,
    });

    em.create(DeptDocType, {
      department: dept,
      documentType: predType,
      formTemplate: predTmpl,
      workflow: wf,
      isActive: true,
    });
    em.create(DeptDocType, {
      department: dept,
      documentType: succType,
      formTemplate: succTmpl,
      workflow: wf,
      isActive: true,
    });
    em.create(DocumentTypeRef, {
      company,
      predecessorType: predType,
      successorType: succType,
      autoCreate: true,
    });

    await em.flush();
    Object.assign(ids, {
      company: company.id,
      dept: dept.id,
      user: user.id,
      predType: predType.id,
      succType: succType.id,
      predTmpl: predTmpl.id,
      succTmpl: succTmpl.id,
      wf: wf.id,
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
    const accounts = new AccountService(orm.em, scope);
    documents = new DocumentService(
      orm.em,
      scope,
      new DeptDocTypeService(orm.em),
      new NumberingService(orm.em),
      new ItemService(orm.em, scope, new ScopeService(), accounts),
      new BudgetService(orm.em, accounts, new BudgetBalanceService(orm.em)),
      new FiscalYearService(scope),
    );
  });

  const asRaiser = <T>(fn: () => Promise<T>) =>
    RequestContext.run(
      {
        userId: ids.user,
        companyId: ids.company,
        departmentId: ids.dept,
        grants: [],
      },
      fn,
    );

  it('carries a field both forms declare', async () => {
    const pred = await approvedPredecessor({
      liableParty: 'BRANCH 352',
      claimRef: 'CLM-2026-010576',
    });

    const succ = await asRaiser(() => documents.createFrom(pred, ids.succType));

    expect(await valuesOf(succ.id)).toMatchObject({
      liableParty: 'BRANCH 352',
      claimRef: 'CLM-2026-010576',
    });
  });

  it('does not carry a field only the predecessor declares', async () => {
    const pred = await approvedPredecessor({
      liableParty: 'BRANCH 1',
      claimKind: 'LOST',
    });

    const succ = await asRaiser(() => documents.createFrom(pred, ids.succType));

    // The successor asks four questions, not the predecessor's four different ones.
    expect(await valuesOf(succ.id)).not.toHaveProperty('claimKind');
  });

  it('leaves a value the successor own field would refuse empty rather than writing it', async () => {
    const pred = await approvedPredecessor({
      liableParty: 'BRANCH 2',
      settlementKind: 'CASH',
    });

    const succ = await asRaiser(() => documents.createFrom(pred, ids.succType));

    // The successor's dropdown offers TRANSFER alone. Narrowing it was deliberate, and inheritance
    // is not a way past it — the field is simply empty, which the person filling it can see.
    const values = await valuesOf(succ.id);
    expect(values).not.toHaveProperty('settlementKind');
    expect(values.liableParty).toBe('BRANCH 2');
  });

  it('leaves the successor empty where the predecessor was empty', async () => {
    const pred = await approvedPredecessor({
      liableParty: 'BRANCH 3',
      claimRef: '',
    });

    const succ = await asRaiser(() => documents.createFrom(pred, ids.succType));

    // An empty answer is not an answer: no row, rather than a row holding nothing.
    expect(await valuesOf(succ.id)).not.toHaveProperty('claimRef');
  });

  it('takes no budget hold while inheriting', async () => {
    const pred = await approvedPredecessor({
      liableParty: 'BRANCH 4',
      claimRef: 'CLM-X',
    });

    const succ = await asRaiser(() => documents.createFrom(pred, ids.succType));

    const em = orm.em.fork();
    expect(
      await em.count(
        BudgetTxn,
        { document: succ.id },
        { filters: { company: false } },
      ),
    ).toBe(0);
  });
});
