import 'reflect-metadata';
import { ForbiddenException, type Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Workflow } from '../approval/approval.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { DeptDocTypeService } from './dept-doc-type.service';
import { DocumentConfigController } from './document-config.controller';
import { DeptDocType, DocumentType, FormTemplate } from './document.entities';
import { DocCategory } from '../../common/enums';
import type { MikroORM } from '@mikro-orm/postgresql';

const FILTER_OFF = { filters: { company: false } } as const;
const hasDb = await dbAvailable();

/**
 * The mapping screen shows a department column, a document type column and an active column, and
 * offered no way to narrow by any of them. On the customer's data that is 80 mappings over four
 * pages, and the question the screen exists to answer — which document types may this department
 * raise — could only be approached by guessing a word the department's name shares.
 *
 * Every narrowing here is asserted to NARROW the company-scoped predicate rather than replace it.
 * That is the one property that matters: a department id from another company must match nothing,
 * not reach across (invariant 1).
 */
describe.skipIf(!hasDb)('the mapping list narrows by what it shows (DB-backed)', () => {
  let orm: MikroORM;
  let mappings: DeptDocTypeService;
  const ids = { company: '', other: '', admin: '', sales: '', otherDept: '', pr: '', memo: '' };

  const asA = <T>(fn: () => Promise<T>, companyId = ids.company) =>
    RequestContext.run({ companyId, departmentId: ids.admin, userId: 'u', grants: [] }, fn);

  const codesOf = async (q: Parameters<DeptDocTypeService['listForCompany']>[0]) => {
    const page = await asA(() => mappings.listForCompany(q));
    return {
      rows: page.items.map((r) => `${r.departmentName}/${r.documentTypeCode}`).sort(),
      total: page.total,
    };
  };

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();

    const company = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', isActive: true });
    const other = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', isActive: true });
    const admin = em.create(Department, { company, deptCode: 'ADM', name: 'Administration', isActive: true });
    const sales = em.create(Department, { company, deptCode: 'MK', name: 'Marketing', isActive: true });
    // Company A has a department with NO mapping, so "the options offer only mapped departments"
    // is a claim with something to exclude.
    em.create(Department, { company, deptCode: 'BG', name: 'Budget office', isActive: true });
    const otherDept = em.create(Department, { company: other, deptCode: 'BD', name: 'B dept', isActive: true });
    const wf = em.create(Workflow, { company, name: 'WF', isActive: true });
    const otherWf = em.create(Workflow, { company: other, name: 'WF-B', isActive: true });

    const type = (c: Company, code: string) => {
      const t = em.create(DocumentType, {
        company: c, code, name: code, category: DocCategory.ADMIN,
        requiresBudget: false, requiresQuota: false, isActive: true,
      } as never);
      const tmpl = em.create(FormTemplate, { documentType: t, version: 1, status: 'PUBLISHED' });
      return { t, tmpl };
    };
    const pr = type(company, 'PR');
    const memo = type(company, 'MEMO');
    const otherType = type(other, 'PR');

    const map = (d: Department, t: ReturnType<typeof type>, w: Workflow, isActive = true) =>
      em.create(DeptDocType, { department: d, documentType: t.t, formTemplate: t.tmpl, workflow: w, isActive });

    map(admin, pr, wf);
    map(admin, memo, wf, false);   // the deactivated one
    map(sales, pr, wf);
    map(otherDept, otherType, otherWf);   // company B — must never be reachable

    await em.persistAndFlush(company);
    Object.assign(ids, {
      company: company.id, other: other.id,
      admin: admin.id, sales: sales.id, otherDept: otherDept.id,
      pr: pr.t.id, memo: memo.t.id,
    });
    mappings = new DeptDocTypeService(orm.em);
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  it('returns the company’s mappings and nothing from another company', async () => {
    const { rows, total } = await codesOf({});
    expect(rows).toEqual(['Administration/MEMO', 'Administration/PR', 'Marketing/PR']);
    expect(total).toBe(3);
  });

  it('narrows to one department', async () => {
    const { rows } = await codesOf({ departmentId: ids.sales });
    expect(rows).toEqual(['Marketing/PR']);
  });

  it('narrows to one document type, across departments', async () => {
    const { rows } = await codesOf({ documentTypeId: ids.pr });
    expect(rows).toEqual(['Administration/PR', 'Marketing/PR']);
  });

  it('composes the narrowings with each other', async () => {
    const { rows } = await codesOf({ departmentId: ids.admin, documentTypeId: ids.pr });
    expect(rows).toEqual(['Administration/PR']);
  });

  it('composes them with the search term too', async () => {
    const { rows } = await codesOf({ documentTypeId: ids.pr, search: 'Marketing' });
    expect(rows).toEqual(['Marketing/PR']);
  });

  it('cannot be used to reach another company’s mapping', async () => {
    // Invariant 1. The narrowing must NARROW the scoped predicate, never replace it — so naming
    // company B's department from inside company A matches nothing rather than crossing over.
    expect((await codesOf({ departmentId: ids.otherDept })).rows).toEqual([]);
    // And from the other side: company B sees only its own.
    const fromB = await RequestContext.run(
      { companyId: ids.other, departmentId: ids.otherDept, userId: 'u', grants: [] },
      () => mappings.listForCompany({}),
    );
    expect(fromB.items.map((r) => r.documentTypeCode)).toEqual(['PR']);
    expect(fromB.total).toBe(1);
  });

  describe('the active narrowing', () => {
    it('does not hide the deactivated mappings when unset', async () => {
      // Not a default. A list that hid them could not answer why a department lost a type.
      expect((await codesOf({})).rows).toContain('Administration/MEMO');
    });

    it('returns only the deactivated ones when asked for them', async () => {
      const { rows, total } = await codesOf({ isActive: false });
      expect(rows).toEqual(['Administration/MEMO']);
      expect(total).toBe(1);
    });

    it('returns only the active ones when asked for those', async () => {
      const { rows } = await codesOf({ isActive: true });
      expect(rows).toEqual(['Administration/PR', 'Marketing/PR']);
    });
  });

  it('reports a total that matches the narrowing, not the whole company', async () => {
    // The screen renders "showing N of M" from this. A total that ignored the filter would be a
    // lie in the direction that matters — it would understate how much is hidden.
    expect((await codesOf({ departmentId: ids.admin })).total).toBe(2);
    expect((await codesOf({})).total).toBe(3);
  });

  describe('the department options for the filter', () => {
    it('offers only departments that hold a mapping', async () => {
      const opts = await asA(() => mappings.listFilterDepartments());
      expect(opts.map((d) => d.name)).toEqual(['Administration', 'Marketing']);
      // A filter must never offer an option that yields an empty list.
      expect(opts.map((d) => d.name)).not.toContain('Budget office');
    });

    it('never offers another company’s department', async () => {
      const opts = await asA(() => mappings.listFilterDepartments());
      expect(opts.map((d) => d.id)).not.toContain(ids.otherDept);
    });
  });

  describe('the gate', () => {
    const guard = new PermissionsGuard(new Reflector());
    const call = (cls: Type<unknown>, method: string, permissionCodes: string[]) =>
      guard.canActivate({
        getHandler: () => (cls.prototype as Record<string, never>)[method],
        getClass: () => cls,
        switchToHttp: () => ({ getRequest: () => ({ user: { permissionCodes } }) }),
      } as never);

    it('gates the options read exactly as the list it serves', () => {
      // Same code, deliberately: an option list authorized differently from the list it narrows is
      // the trap that emptied two other screens this month.
      expect(call(DocumentConfigController, 'listMappingDepartments', ['DOC_CONFIG_MANAGE'])).toBe(true);
      expect(() => call(DocumentConfigController, 'listMappingDepartments', ['DOC_VIEW'])).toThrow(
        ForbiddenException,
      );
    });
  });
});
