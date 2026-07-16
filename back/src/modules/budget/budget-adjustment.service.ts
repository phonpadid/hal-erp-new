import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { DocStatus } from '../../common/enums';
import { Company } from '../multi-company/multi-company.entities';
import { Department } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { Workflow } from '../approval/approval.entities';
import { DeptDocTypeService } from '../document/dept-doc-type.service';
import { NumberingService } from '../document/numbering.service';
import {
  Document,
  DocumentType,
  FormTemplate,
} from '../document/document.entities';
import { Budget, BudgetMovement } from './budget.entities';
import { BudgetService } from './budget.service';
import { resolveMovementDocType } from './movement-doctype.resolver';
import type { CreateAdjustmentDto } from './dto/movement.dto';

const FILTER_OFF = { filters: { company: false } } as const;

/** The adjustment direction maps to the document type's post_action (config, not a hardcoded code). */
const ADJUST_POST_ACTION = {
  INCREASE: 'ADJUST_INCREASE',
  DECREASE: 'ADJUST_DECREASE',
} as const;

/**
 * Creates a budget adjustment as an approvable document (spec: budget-control
 * "Budget Adjustment" / "Adjustment Document Creation"). It writes a `document` plus
 * its `budget_movement` only — NO `budget_txn`. The single ADJUST_INCREASE /
 * ADJUST_DECREASE is written later by the post-action on full approval, keeping the
 * ledger append-only and approval-gated.
 */
@Injectable()
export class BudgetAdjustmentService {
  constructor(
    private readonly em: EntityManager,
    private readonly budgets: BudgetService,
    private readonly deptDocTypes: DeptDocTypeService,
    private readonly numbering: NumberingService,
  ) {}

  async create(budgetId: string, dto: CreateAdjustmentDto): Promise<{ documentId: string }> {
    const companyId = RequestContext.companyId()!;
    const userId = RequestContext.userId()!;
    if (!(Number(dto.amount) > 0)) {
      throw new BadRequestException('Adjustment amount must be a positive number');
    }

    // Verify the budget belongs to the active company (scoped via fiscalYear.company)
    // and resolve its department for routing. Throws NotFound for another company.
    const budget = await this.budgets.get(budgetId);

    // Resolve the adjustment type by post_action (config), scoped to the active company. When
    // several types share the direction's post_action, dto.documentTypeId selects one.
    const docType = await resolveMovementDocType(
      this.em,
      companyId,
      ADJUST_POST_ACTION[dto.direction],
      dto.documentTypeId,
      'Adjustment',
    );
    // The type must be enabled for the budget's department (else the document is unroutable).
    const mapping = await this.deptDocTypes.resolve(budget.department.id, docType.id);

    const company = await this.em.findOne(Company, { id: companyId }, FILTER_OFF);
    const year = new Date().getUTCFullYear();
    const prefix = NumberingService.buildPrefix(docType.code, company!.code, year);
    const docNo = await this.numbering.next(companyId, docType.id, year, prefix);

    // Create the document + its movement atomically (mirrors DocumentService.createDraft).
    const em = this.em.fork();
    const document = em.create(Document, {
      docNo,
      company: em.getReference(Company, companyId),
      department: em.getReference(Department, budget.department.id),
      documentType: em.getReference(DocumentType, docType.id),
      formTemplate: em.getReference(FormTemplate, mapping.formTemplate.id),
      workflow: em.getReference(Workflow, mapping.workflow.id),
      currentStepNo: 0,
      createdBy: em.getReference(AppUser, userId),
      exchangeRate: '1',
      totalAmount: dto.amount,
      status: DocStatus.DRAFT,
      createdAt: new Date(),
    });
    em.persist(document);

    em.persist(
      em.create(BudgetMovement, {
        company: em.getReference(Company, companyId),
        document,
        movementType: docType.postAction!, // 'ADJUST_INCREASE' | 'ADJUST_DECREASE'
        toBudget: em.getReference(Budget, budget.id),
        amount: dto.amount,
        reason: dto.reason,
        createdAt: new Date(),
      }),
    );

    await em.flush();
    return { documentId: document.id };
  }
}
