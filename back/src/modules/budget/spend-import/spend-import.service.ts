import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { DocStatus } from '../../../common/enums';
import { RequestContext } from '../../../common/context/request-context';
import { Workflow } from '../../approval/approval.entities';
import {
  DeptDocType,
  Document,
  DocumentLine,
  DocumentType,
  FormTemplate,
} from '../../document/document.entities';
import { NumberingService } from '../../document/numbering.service';
import { Company, Department, FiscalYear } from '../../multi-company/multi-company.entities';
import { AppUser } from '../../rbac/rbac.entities';
import { Budget, BudgetControlPoint, BudgetNode } from '../budget.entities';
import { BudgetCoverageService } from '../budget-coverage.service';
import { BudgetLedgerService } from '../budget-ledger.service';
import { ToleranceLadder } from '../tolerance-ladder';
import { budgetsToCreate, departmentOf, planSpendImport } from './spend-plan';
import type { PlannedDocument, PlannedLine, SpendPlan } from './spend-plan';
import { readSpendFile } from './spend-reader';

const FILTER_OFF = { filters: { company: false } } as const;

/** `document_line.description` is varchar(255); 44 rows of this sheet state more than that. */
export const DESCRIPTION_LIMIT = 255;

/**
 * The line's description, with the sheet's own reference to the row it came from.
 *
 * The reference is kept whole and the words are cut when the two do not fit, marked with an
 * ellipsis. That way round because the reference is what leads back to the full text: their sheet
 * still holds every word, and a line that cannot be traced to a row is one nobody can check. 44 of
 * the 5,689 rows are affected; the longest states 520 characters.
 */
export function describe(planned: PlannedDocument, line: PlannedLine): string {
  const words = line.description || `${planned.code} — sheet row ${line.sheetRow}`;
  const ref = [line.sequence ? `#${line.sequence}` : '', line.spentOn].filter(Boolean).join(' · ');
  const tail = ` — ${ref}`;
  if (words.length + tail.length <= DESCRIPTION_LIMIT) return `${words}${tail}`;
  return `${words.slice(0, DESCRIPTION_LIMIT - tail.length - 1)}…${tail}`;
}

/** The feed name every document this importer creates carries, so a re-run can find them. */
export const SPEND_HISTORY_SOURCE = 'BUDGET_HISTORY';
/** The document type these are raised as, so they can be told from documents somebody raised. */
export const SPEND_HISTORY_DOC_TYPE = 'SPEND_HIST';

export interface SpendImportOptions {
  companyCode: string;
  /** The fiscal year's `year`, e.g. 2026. */
  year: number;
  file: string;
  /** Overrides {@link SPEND_HISTORY_DOC_TYPE} for a company that named its own. */
  docTypeCode?: string;
  dryRun?: boolean;
}

export interface CreatedBudget {
  code: string;
  departmentCode: string;
  /** What the history charges to it — every kip of which is overspending, since it holds zero. */
  charged: string;
  /** Filled once the row exists; absent on a dry run. */
  budgetId?: string;
}

export interface SpendImportResult {
  companyCode: string;
  year: number;
  dryRun: boolean;
  /** Documents this run inserted. Zero on a re-run. */
  documentsCreated: number;
  /** Documents already present from an earlier run, left exactly as they were. */
  documentsUnchanged: number;
  linesCreated: number;
  /** Two per document created: one RESERVE and one ACTUAL. */
  ledgerRows: number;
  budgetsCreatedAtZero: CreatedBudget[];
  /** Control points minted so the budgets created above are governed by something. */
  controlPointsCreated: number;
  /** Rows that carried no description, given one naming the sheet row they came from. */
  descriptionsSupplied: number;
  /** Rows whose description was longer than the column, cut with the sheet reference kept. */
  descriptionsTruncated: number;
  plan: SpendPlan;
}

/**
 * Bring a year of recorded expenditure into the budget ledger from the customer's own monitoring
 * sheet.
 *
 * The reading is `spend-reader`'s and the grouping is `spend-plan`'s; this puts the result in the
 * database. It is the first importer in this repo that writes `budget_txn` — an append-only table,
 * where a duplicated row can never be removed and can only be answered with a compensating entry.
 * That is why every document carries an external source, and why the whole run is one transaction.
 */
@Injectable()
export class SpendImportService {
  constructor(
    private readonly em: EntityManager,
    private readonly ledger: BudgetLedgerService,
    private readonly numbering: NumberingService,
    private readonly coverage: BudgetCoverageService,
  ) {}

  async import(opts: SpendImportOptions): Promise<SpendImportResult> {
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

    // What a document cannot be raised without, resolved BEFORE the workbook is opened — the same
    // order the plan import uses, so a missing route is reported while the operator can still fix
    // it without waiting on the customer's file.
    const typeCode = opts.docTypeCode ?? SPEND_HISTORY_DOC_TYPE;
    const { docType, template, workflow } = await this.requireRouting(em, company.id, typeCode);

    const { rows, skipped } = readSpendFile(opts.file);
    const plan = planSpendImport(rows, skipped, fiscalYear.startDate);

    const nodes = new Map(
      (await em.find(BudgetNode, { fiscalYear: fiscalYear.id }, FILTER_OFF)).map((n) => [
        n.code,
        n,
      ]),
    );
    const departments = new Map(
      (await em.find(Department, { company: company.id }, FILTER_OFF)).map((d) => [d.deptCode, d]),
    );
    const budgets = await em.find(
      Budget,
      { fiscalYear: fiscalYear.id },
      { ...FILTER_OFF, populate: ['node', 'department'] },
    );
    const budgetByCode = new Map<string, Budget[]>();
    for (const b of budgets) {
      budgetByCode.set(b.node.code, [...(budgetByCode.get(b.node.code) ?? []), b]);
    }

    // A plan line this import would have to invent is refused, not improvised. The plan decides
    // what lines exist; a code charged that the plan never names means the two files disagree, and
    // guessing a node into existence here would put a line in the plan that nobody approved.
    this.requireStructure(plan, nodes, departments);

    const missing = budgetsToCreate(plan, new Set(budgetByCode.keys()));
    const budgetsCreatedAtZero: CreatedBudget[] = missing.map((code) => ({
      code,
      departmentCode: departmentOf(code),
      charged: plan.chargedByCode.get(code)!,
    }));

    const existing = new Set(
      (
        await em.find(
          Document,
          { company: company.id, sourceType: SPEND_HISTORY_SOURCE },
          FILTER_OFF,
        )
      ).map((d) => d.sourceId!),
    );
    const toCreate = plan.documents.filter((d) => !existing.has(d.sourceId));
    const descriptionsSupplied = toCreate.reduce(
      (n, d) => n + d.lines.filter((l) => !l.description).length,
      0,
    );
    const descriptionsTruncated = toCreate.reduce(
      (n, d) => n + d.lines.filter((l) => describe(d, l).length >= DESCRIPTION_LIMIT).length,
      0,
    );

    const result: SpendImportResult = {
      companyCode: opts.companyCode,
      year: opts.year,
      dryRun: !!opts.dryRun,
      documentsCreated: toCreate.length,
      documentsUnchanged: plan.documents.length - toCreate.length,
      linesCreated: toCreate.reduce((n, d) => n + d.lines.length, 0),
      ledgerRows: toCreate.length * 2,
      budgetsCreatedAtZero,
      // Every budget created needs a governing point; one already covered by an ancestor's would
      // not, and the real count is settled against the database inside the transaction.
      controlPointsCreated: budgetsCreatedAtZero.length,
      descriptionsSupplied,
      descriptionsTruncated,
      plan,
    };
    if (opts.dryRun) return result;
    if (!toCreate.length) return result;

    const userId = RequestContext.userId() ?? (await this.anyUser(em));

    // ONE transaction for the run. A history half-imported is worse than one not imported: the
    // ledger it half-wrote cannot be deleted, and the operator would have to work out which
    // months landed before writing compensating entries for them.
    await em.transactional(async (tem) => {
      for (const created of budgetsCreatedAtZero) {
        const budget = tem.create(Budget, {
          fiscalYear: tem.getReference(FiscalYear, fiscalYear.id),
          department: tem.getReference(Department, departments.get(created.departmentCode)!.id),
          node: tem.getReference(BudgetNode, nodes.get(created.code)!.id),
          budgetName: nodes.get(created.code)!.name,
          // Zero, and ACTIVE. Zero because the plan funded nothing here and inventing a figure
          // would authorise the overspending instead of showing it; ACTIVE because the money was
          // spent against it, and a DRAFT budget is one nothing may be charged to.
          amountTotal: '0',
          status: 'ACTIVE',
        } as never);
        tem.persist(budget);
        budgetByCode.set(created.code, [budget]);
        created.budgetId = budget.id;
      }
      await tem.flush();

      result.controlPointsCreated = await this.cover(
        tem,
        company.id,
        fiscalYear.id,
        budgetsCreatedAtZero,
        departments,
        nodes,
      );

      const numbers = await this.numbering.nextBlock(
        company.id,
        docType.id,
        opts.year,
        NumberingService.buildPrefix(docType.code, company.code, opts.year),
        toCreate.length,
        tem,
      );

      const routed = new Set<string>();
      for (const [i, planned] of toCreate.entries()) {
        const department = this.departmentFor(planned, departments);
        if (!routed.has(department.id)) {
          await this.ensureRouting(tem, department, docType, template, workflow);
          routed.add(department.id);
        }
        const budget = this.budgetFor(planned, budgetByCode);
        const document = tem.create(Document, {
          docNo: numbers[i],
          company: tem.getReference(Company, company.id),
          department: tem.getReference(Department, department.id),
          documentType: tem.getReference(DocumentType, docType.id),
          formTemplate: tem.getReference(FormTemplate, template.id),
          workflow: tem.getReference(Workflow, workflow.id),
          createdBy: tem.getReference(AppUser, userId),
          currency: company.baseCurrency,
          exchangeRate: '1',
          totalAmount: planned.amount,
          baseTotalAmount: planned.amount,
          budgetBaseTotalAmount: planned.amount,
          // COMPLETED, with no approval trail. What happened is that an import put a year of
          // already-paid spending into the system; a document left awaiting an approval nobody is
          // going to give would sit in an approver's queue for the rest of the year.
          status: DocStatus.COMPLETED,
          submittedAt: new Date(`${planned.date}T00:00:00Z`),
          approvedAt: new Date(`${planned.date}T00:00:00Z`),
          createdAt: new Date(),
          sourceType: SPEND_HISTORY_SOURCE,
          sourceId: planned.sourceId,
        } as never);
        tem.persist(document);

        for (const [n, line] of planned.lines.entries()) {
          tem.persist(
            tem.create(DocumentLine, {
              document,
              lineNo: n + 1,
              // The row's own words, followed by their `ເລກລຳດັບ` and the day it states.
              //
              // Appended to the description because `document_line` has no free field to put them
              // in, and both are worth more than a tidy line: the document is dated to its month,
              // so the day survives nowhere else, and the sequence is the thread back to the row
              // in their sheet. One row of this file states an amount and no description at all,
              // and is named by where it came from — the column is NOT NULL, and a line reading
              // nothing is a line nobody can look up.
              description: describe(planned, line),
              qty: '1',
              unitPrice: line.amount,
              lineAmount: line.amount,
              baseLineAmount: line.amount,
              budgetBaseLineAmount: line.amount,
              budget: tem.getReference(Budget, budget.id),
            } as never),
          );
        }
        await tem.flush();

        await this.ledger.recordHistoricSpend(
          tem,
          document.id,
          budget.id,
          planned.amount,
          planned.date,
          `${SPEND_HISTORY_SOURCE} ${planned.sourceId}`,
        );
      }
      await tem.flush();
    });

    return result;
  }

  /**
   * Put every budget this import created under a control point.
   *
   * An ACTIVE budget governed by nothing is the one budget failure that is invisible: it raises no
   * error when it is spent against, it simply stops being checked (the coverage invariant, D3).
   * And the next real request against one of these would be refused outright — `reserve` will not
   * check a budget no point governs — so leaving them uncovered would hand the customer 125 lines
   * they cannot spend on and no explanation.
   *
   * The ladder is BLOCK at the ceiling, the same one a plan mints. On a budget of zero that reads
   * as "every further request is refused", which is what a line the plan never funded should do:
   * the money already spent is recorded, and the next one is a decision for a person.
   */
  private async cover(
    tem: EntityManager,
    companyId: string,
    fiscalYearId: string,
    created: CreatedBudget[],
    departments: Map<string, Department>,
    nodes: Map<string, BudgetNode>,
  ): Promise<number> {
    const ids = created.map((c) => c.budgetId!).filter(Boolean);
    if (!ids.length) return 0;
    // Resolved for all of them at once, before minting anything: the resolver memoises per
    // EntityManager, so asking line by line would read the answer cached before the previous
    // insert. Each budget here sits on its own node, so one round is enough.
    const before = await this.coverage.resolveControlPoints(ids, tem);
    let minted = 0;
    for (const c of created) {
      if ((before.get(c.budgetId!) ?? []).length) continue;
      tem.persist(
        tem.create(BudgetControlPoint, {
          company: tem.getReference(Company, companyId),
          fiscalYear: tem.getReference(FiscalYear, fiscalYearId),
          budgetNode: tem.getReference(BudgetNode, nodes.get(c.code)!.id),
          departmentNode: tem.getReference(Department, departments.get(c.departmentCode)!.id),
          capAmount: undefined,
          toleranceJson: ToleranceLadder.stringify(ToleranceLadder.BLOCK_AT_CEILING),
          isActive: true,
        }),
      );
      minted += 1;
    }
    await tem.flush();
    this.coverage.invalidate(tem);
    const after = await this.coverage.resolveControlPoints(ids, tem);
    const uncovered = created.filter((c) => !(after.get(c.budgetId!) ?? []).length);
    if (uncovered.length) {
      throw new Error(
        `${uncovered.length} budget(s) this import created are governed by no control point ` +
          `(${uncovered.map((c) => c.code).join(', ')}); the run is rolled back rather than leaving ` +
          'money nothing checks',
      );
    }
    return minted;
  }

  /**
   * The document's department: who spent, from the sheet's own column.
   *
   * Falls back to the plan code's department when the column holds something that is not a
   * department — two rows of this sheet have the plan code pasted into it. The budget is not
   * chosen here and never is: see {@link budgetFor}.
   */
  private departmentFor(
    planned: PlannedDocument,
    departments: Map<string, Department>,
  ): Department {
    return (
      (planned.departmentCode ? departments.get(planned.departmentCode) : undefined) ??
      departments.get(departmentOf(planned.code))!
    );
  }

  /**
   * The budget charged, chosen by the PLAN CODE.
   *
   * When one node carries budgets in more than one department, the one in the code's own
   * department is taken; a node with several and none of them the code's own is a shape this
   * import refuses rather than guesses at, because either choice would charge somebody's money.
   */
  private budgetFor(planned: PlannedDocument, byCode: Map<string, Budget[]>): Budget {
    const candidates = byCode.get(planned.code) ?? [];
    if (candidates.length === 1) return candidates[0];
    const own = candidates.find((b) => b.department.deptCode === departmentOf(planned.code));
    if (own) return own;
    throw new Error(
      `Plan code ${planned.code} has ${candidates.length} budgets and none of them belongs to ` +
        `department ${departmentOf(planned.code)}; which one the history charges cannot be guessed`,
    );
  }

  /**
   * Refuse before writing anything if the plan has no home for a code the sheet charges.
   *
   * Reported together, not one at a time: an operator fixing these is going to run the plan import
   * again, and a list of every code it has to cover is worth more than the first one.
   */
  private requireStructure(
    plan: SpendPlan,
    nodes: Map<string, BudgetNode>,
    departments: Map<string, Department>,
  ): void {
    const missingNodes = [...plan.chargedByCode.keys()].filter((c) => !nodes.has(c)).sort();
    if (missingNodes.length) {
      throw new Error(
        `The plan has no line for ${missingNodes.length} code(s) this history charges: ` +
          `${missingNodes.join(', ')}. Import the plan first — this import will not invent a plan line.`,
      );
    }
    const missingDepts = [
      ...new Set([...plan.chargedByCode.keys()].map(departmentOf)),
    ]
      .filter((d) => !departments.has(d))
      .sort();
    if (missingDepts.length) {
      throw new Error(
        `The company has no department ${missingDepts.join(', ')}, which this history charges`,
      );
    }
  }

  /** The route a document of this type takes from this department. Created if absent. */
  private async ensureRouting(
    tem: EntityManager,
    department: Department,
    docType: DocumentType,
    template: FormTemplate,
    workflow: Workflow,
  ): Promise<void> {
    const already = await tem.findOne(
      DeptDocType,
      { department: department.id, documentType: docType.id },
      FILTER_OFF,
    );
    if (already) return;
    tem.persist(
      tem.create(DeptDocType, {
        department: tem.getReference(Department, department.id),
        documentType: tem.getReference(DocumentType, docType.id),
        formTemplate: tem.getReference(FormTemplate, template.id),
        workflow: tem.getReference(Workflow, workflow.id),
        isActive: true,
      } as never),
    );
    await tem.flush();
  }

  /**
   * What a document cannot be created without — and none of it is invented here.
   *
   * A document type carries the approval route and the flags that decide how a document behaves,
   * and a workflow decides who approves. Both are configuration; `prepare:spend-history` creates
   * them as a separate, explicit act.
   */
  private async requireRouting(
    em: EntityManager,
    companyId: string,
    typeCode: string,
  ): Promise<{ docType: DocumentType; template: FormTemplate; workflow: Workflow }> {
    const docType = await em.findOne(
      DocumentType,
      { company: companyId, code: typeCode, isActive: true },
      FILTER_OFF,
    );
    if (!docType) {
      throw new Error(
        `Company has no active document type ${typeCode}; run prepare:spend-history first`,
      );
    }
    const template = await em.findOne(
      FormTemplate,
      { documentType: docType.id, status: 'PUBLISHED' },
      { ...FILTER_OFF, orderBy: { version: 'DESC' } },
    );
    if (!template) throw new Error(`Document type ${typeCode} has no PUBLISHED form template`);
    const workflow = await em.findOne(
      Workflow,
      { company: companyId, isActive: true },
      { ...FILTER_OFF, orderBy: { name: 'ASC' } },
    );
    if (!workflow) {
      throw new Error(
        'Company has no active workflow, so no document can be routed. Create one before importing.',
      );
    }
    return { docType, template, workflow };
  }

  private async anyUser(em: EntityManager): Promise<string> {
    const user = await em.findOne(AppUser, { status: 'ACTIVE' }, FILTER_OFF);
    if (!user) throw new Error('No active user to attribute the imported history to');
    return user.id;
  }
}
