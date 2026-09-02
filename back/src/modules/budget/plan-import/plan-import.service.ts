import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../common/context/request-context';
import { Workflow } from '../../approval/approval.entities';
import { DocStatus } from '../../../common/enums';
import { DeptDocType, Document, DocumentType, FormTemplate } from '../../document/document.entities';
import { Company, Department, FiscalYear } from '../../multi-company/multi-company.entities';
import { AppUser } from '../../rbac/rbac.entities';
import { Budget, BudgetNode } from '../budget.entities';
import { BudgetPlanService } from '../budget-plan.service';
import { readPlanFile } from './plan-reader';
import { planImport } from './plan-tree';
import type { PlanImportPlan } from './plan-tree';

const FILTER_OFF = { filters: { company: false } } as const;
const PLAN_POST_ACTION = 'ACTIVATE_BUDGET';

export interface PlanImportOptions {
  companyCode: string;
  /** The fiscal year's `year`, e.g. 2026. */
  year: number;
  file: string;
  /** `dept_code` of the department the plan's own departments hang beneath. */
  parentDeptCode?: string;
  dryRun?: boolean;
}

export interface PlanImportResult {
  companyCode: string;
  year: number;
  dryRun: boolean;
  departmentsCreated: string[];
  mappingsCreated: string[];
  nodesCreated: number;
  /** Budgets this run actually inserted. Zero on a re-run — see {@link budgetsPlanned}. */
  budgetsCreated: number;
  /** Budgets the plan calls for, created by this run or already present. */
  budgetsPlanned: number;
  /** Already present and left as they were. */
  budgetsUnchanged: number;
  budgetsTotal: string;
  /** The plan documents raised and put in force, one per department. */
  planDocumentIds: string[];
  plan: PlanImportPlan;
}

const DEFAULT_PARENT = 'PLAN';

/**
 * Load a company's expenditure plan from its own monitoring workbook.
 *
 * The structure and the money are decided in `plan-tree`; this puts the result in the database and
 * hands it to the ordinary activation path. Nothing here decides how much money exists.
 */
@Injectable()
export class PlanImportService {
  constructor(
    private readonly em: EntityManager,
    private readonly plans: BudgetPlanService,
  ) {}

  async import(opts: PlanImportOptions): Promise<PlanImportResult> {
    if (!opts.companyCode) throw new Error('A company code is required');
    if (!opts.year) throw new Error('A fiscal year is required');
    if (!opts.file) throw new Error('A workbook is required');

    const em = this.em.fork();
    const company = await em.findOne(Company, { code: opts.companyCode }, FILTER_OFF);
    if (!company) throw new Error(`Company '${opts.companyCode}' does not exist`);
    const fiscalYear = await em.findOne(
      FiscalYear,
      { company: company.id, year: opts.year },
      FILTER_OFF,
    );
    if (!fiscalYear) {
      throw new Error(`Company '${opts.companyCode}' has no fiscal year ${opts.year}`);
    }

    // What a plan document cannot be raised without, resolved BEFORE the workbook is opened. The
    // destination is the operator's to fix and the file is the customer's; reporting a missing
    // workflow first is reporting the one they can act on without waiting for anybody.
    const { docType, template, workflow } = await this.requirePlanRouting(em, company.id);

    const { rows, ignored } = readPlanFile(opts.file);
    const plan = planImport(rows, ignored);

    const budgetsTotal = plan.budgets.reduce((s, b) => s + BigInt(b.amountTotal), 0n).toString();
    const existingDepts = await em.find(Department, { company: company.id }, FILTER_OFF);
    const deptByCode = new Map(existingDepts.map((d) => [d.deptCode, d]));
    const parentCode = opts.parentDeptCode ?? DEFAULT_PARENT;
    const departmentsCreated = plan.departments
      .map((d) => d.departmentCode)
      .filter((code) => !deptByCode.has(code));
    if (!deptByCode.has(parentCode)) departmentsCreated.unshift(parentCode);

    const result: PlanImportResult = {
      companyCode: opts.companyCode,
      year: opts.year,
      dryRun: !!opts.dryRun,
      departmentsCreated,
      mappingsCreated: [],
      nodesCreated: 0,
      budgetsCreated: plan.budgets.length,
      budgetsPlanned: plan.budgets.length,
      budgetsUnchanged: 0,
      budgetsTotal,
      planDocumentIds: [],
      plan,
    };

    result.mappingsCreated = plan.departments
      .map((d) => d.departmentCode)
      .filter((code) => {
        const dept = deptByCode.get(code);
        return !dept; // a department that does not exist yet certainly has no mapping
      });

    if (opts.dryRun) return result;

    const userId = RequestContext.userId() ?? (await this.anyUser(em));

    // Departments, nodes and DRAFT budgets first, in one transaction. The plans are raised after,
    // because `BudgetPlanService` opens transactions of its own.
    const nodeIds = new Map<string, string>();
    const budgetIdsByDept = new Map<string, string[]>();
    // Counted, not assumed. The first cut reported `plan.budgets.length` as "created", so a re-run
    // that inserted nothing still claimed 241 — a report that cannot be believed on the one run
    // where it matters most.
    let created = 0;
    let unchanged = 0;
    await em.transactional(async (tem) => {
      const parent = await this.upsertDepartment(tem, company.id, parentCode, 'Budget plan', undefined);
      const deptIds = new Map<string, string>();
      for (const d of plan.departments) {
        const dept = await this.upsertDepartment(tem, company.id, d.departmentCode, d.name, parent);
        deptIds.set(d.departmentCode, dept.id);
      }

      // Nodes parentless first, then linked — a self-referencing tree cannot be inserted in
      // dependency order without sorting it, and the sort is the part most likely to be wrong.
      const nodes = new Map<string, BudgetNode>();
      for (const n of plan.nodes) {
        let node = await tem.findOne(
          BudgetNode,
          { fiscalYear: fiscalYear.id, code: n.code },
          FILTER_OFF,
        );
        if (!node) {
          node = tem.create(BudgetNode, {
            fiscalYear: tem.getReference(FiscalYear, fiscalYear.id),
            code: n.code,
            name: n.name,
          });
        }
        nodes.set(n.code, node);
      }
      await tem.flush();
      for (const n of plan.nodes) {
        if (!n.parentCode) continue;
        const node = nodes.get(n.code)!;
        if (!node.parent) node.parent = nodes.get(n.parentCode);
      }
      await tem.flush();
      result.nodesCreated = nodes.size;
      for (const [code, node] of nodes) nodeIds.set(code, node.id);

      for (const b of plan.budgets) {
        const existing = await tem.findOne(
          Budget,
          { fiscalYear: fiscalYear.id, node: nodes.get(b.code)!.id, department: deptIds.get(b.departmentCode) },
          FILTER_OFF,
        );
        if (existing) {
          // Fill a name this importer failed to set on an earlier run. Only when it is missing:
          // a name somebody corrected in the app is never overwritten.
          if (!existing.budgetName) existing.budgetName = b.name;
          unchanged += 1;
          continue;
        }
        const budget = tem.create(Budget, {
          fiscalYear: tem.getReference(FiscalYear, fiscalYear.id),
          department: tem.getReference(Department, deptIds.get(b.departmentCode)!),
          node: nodes.get(b.code)!,
          // The plan line's name. The first cut left this null and let the node carry the name
          // alone, which reads fine on the budgets list — it falls back to the node — and left
          // every dashboard row showing a dash.
          budgetName: b.name,
          amountTotal: b.amountTotal,
          status: 'DRAFT',
        } as never);
        tem.persist(budget);
        created += 1;
        budgetIdsByDept.set(b.departmentCode, [
          ...(budgetIdsByDept.get(b.departmentCode) ?? []),
          budget.id,
        ]);
      }
      await tem.flush();

      // The routing mapping each plan needs, on the parent every plan is routed at.
      for (const code of [parentCode]) {
        const dept = code === parentCode ? parent : tem.getReference(Department, deptIds.get(code)!);
        const already = await tem.findOne(
          DeptDocType,
          { department: dept.id, documentType: docType.id },
          FILTER_OFF,
        );
        if (already) continue;
        tem.persist(
          tem.create(DeptDocType, {
            department: dept,
            documentType: tem.getReference(DocumentType, docType.id),
            formTemplate: tem.getReference(FormTemplate, template.id),
            workflow: tem.getReference(Workflow, workflow.id),
            isActive: true,
          } as never),
        );
        result.mappingsCreated.push(code);
      }
      await tem.flush();

      // The parent is the routing department for every plan: it is the only department whose
      // subtree contains all of them.
      result.mappingsCreated = [...new Set(result.mappingsCreated)];
      result.budgetsCreated = created;
      result.budgetsUnchanged = unchanged;
      void parent;
    });

    // Plan whatever is still DRAFT, not only what this run created.
    //
    // The first cut planned only the budgets it had just inserted, which made the import
    // unresumable: a run that created 241 budgets and then failed to raise their plans left them
    // DRAFT for ever, because every later run found them already present and created nothing to
    // plan. Reading the DRAFT rows back is what lets a second run finish the job.
    result.planDocumentIds = await this.raiseAndActivate(
      company.id,
      fiscalYear.id,
      userId,
      parentCode,
      await this.unplannedByDepartment(fiscalYear.id),
    );
    return result;
  }

  /**
   * One plan per department, routed at the parent, then put in force through the post-action that
   * full approval runs — the one code path that mints control points.
   *
   * The plan document is marked COMPLETED rather than walked through its approval steps. What
   * happened is that an import put an already-approved plan into the system, and a document left
   * awaiting an approval nobody is going to give would sit in every approver's queue for a year
   * while its budgets were already spendable.
   */
  /** Every DRAFT budget of the year, grouped by the department that holds it. */
  private async unplannedByDepartment(fiscalYearId: string): Promise<Map<string, string[]>> {
    const em = this.em.fork();
    const drafts = await em.find(
      Budget,
      { fiscalYear: fiscalYearId, status: 'DRAFT' },
      { ...FILTER_OFF, populate: ['department'] },
    );
    const out = new Map<string, string[]>();
    for (const b of drafts) {
      out.set(b.department.deptCode, [...(out.get(b.department.deptCode) ?? []), b.id]);
    }
    return out;
  }

  private async raiseAndActivate(
    companyId: string,
    fiscalYearId: string,
    userId: string,
    parentCode: string,
    budgetIdsByDept: Map<string, string[]>,
  ): Promise<string[]> {
    const em = this.em.fork();
    const parent = await em.findOneOrFail(
      Department,
      { company: companyId, deptCode: parentCode },
      FILTER_OFF,
    );
    const documentIds: string[] = [];
    void fiscalYearId;
    for (const [, budgetIds] of budgetIdsByDept) {
      if (!budgetIds.length) continue;
      const { documentId } = await RequestContext.run(
        { userId, companyId, departmentId: parent.id, grants: [] },
        () =>
          this.plans.create({
            departmentId: parent.id,
            lines: budgetIds.map((budgetId) => ({ budgetId })),
          } as never),
      );
      const fork = this.em.fork();
      const document = await fork.findOneOrFail(Document, { id: documentId }, FILTER_OFF);
      await fork.transactional(async (tem) => {
        await this.plans.activate(document, tem);
        const doc = await tem.findOneOrFail(Document, { id: documentId }, FILTER_OFF);
        doc.status = DocStatus.COMPLETED;
        doc.approvedAt = doc.approvedAt ?? new Date();
      });
      documentIds.push(documentId);
    }
    return documentIds;
  }

  /**
   * What a budget plan cannot be raised without. Resolved up front so a failure lands before
   * anything is written, and never invented: an approval route decides who may approve a budget.
   */
  private async requirePlanRouting(
    em: EntityManager,
    companyId: string,
  ): Promise<{ docType: DocumentType; template: FormTemplate; workflow: Workflow }> {
    const docType = await em.findOne(
      DocumentType,
      { company: companyId, postAction: PLAN_POST_ACTION, isActive: true },
      FILTER_OFF,
    );
    if (!docType) {
      throw new Error(
        `Company has no active document type with post action ${PLAN_POST_ACTION}; a budget plan cannot be raised without one`,
      );
    }
    const template = await em.findOne(
      FormTemplate,
      { documentType: docType.id, status: 'PUBLISHED' },
      { ...FILTER_OFF, orderBy: { version: 'DESC' } },
    );
    if (!template) {
      throw new Error(`Document type ${docType.code} has no PUBLISHED form template`);
    }
    const workflow = await em.findOne(
      Workflow,
      { company: companyId, isActive: true },
      { ...FILTER_OFF, orderBy: { name: 'ASC' } },
    );
    if (!workflow) {
      throw new Error(
        'Company has no active workflow, so budget plans cannot be routed. Create one before importing: an approval route decides who may approve a budget, and this import will not invent that.',
      );
    }
    return { docType, template, workflow };
  }

  private async upsertDepartment(
    em: EntityManager,
    companyId: string,
    deptCode: string,
    name: string,
    parent?: Department,
  ): Promise<Department> {
    const found = await em.findOne(
      Department,
      { company: companyId, deptCode },
      FILTER_OFF,
    );
    // Never renamed and never re-parented: an import is not a reorganisation.
    if (found) return found;
    const dept = em.create(Department, {
      company: em.getReference(Company, companyId),
      deptCode,
      name: name || deptCode,
      parentDept: parent,
      isActive: true,
    } as never);
    em.persist(dept);
    await em.flush();
    return dept;
  }

  private async anyUser(em: EntityManager): Promise<string> {
    const user = await em.findOne(AppUser, { status: 'ACTIVE' }, FILTER_OFF);
    if (!user) throw new Error('No active user to attribute the imported plan to');
    return user.id;
  }
}
