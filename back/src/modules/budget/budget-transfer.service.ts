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
import type { CreateTransferDto } from './dto/movement.dto';

const FILTER_OFF = { filters: { company: false } } as const;

/** Document type code seeded for the transfer direction (post_action driven). */
const TRANSFER_TYPE_CODE = 'BUDGET_TRANSFER';

/**
 * Creates a budget transfer as an approvable document (spec: budget-control
 * "Budget Transfer via Approved Document" / "Transfer Request Intake"). It writes a
 * `document` plus its `budget_movement` only — NO `budget_txn`. The paired
 * TRANSFER_OUT / TRANSFER_IN is written later by the post-action on full approval,
 * keeping the ledger append-only and approval-gated. Mirrors BudgetAdjustmentService.
 */
@Injectable()
export class BudgetTransferService {
  constructor(
    private readonly em: EntityManager,
    private readonly budgets: BudgetService,
    private readonly deptDocTypes: DeptDocTypeService,
    private readonly numbering: NumberingService,
  ) {}

  async create(dto: CreateTransferDto): Promise<{ documentId: string }> {
    const companyId = RequestContext.companyId()!;
    const userId = RequestContext.userId()!;

    if (dto.fromBudgetId === dto.toBudgetId) {
      throw new BadRequestException('Source and destination budgets must differ');
    }
    if (!(Number(dto.amount) > 0)) {
      throw new BadRequestException('Transfer amount must be a positive number');
    }

    // Resolve both budgets company-scoped (NotFound for another company). The source
    // budget's department drives routing — it is the budget giving up money.
    const from = await this.budgets.get(dto.fromBudgetId);
    const to = await this.budgets.get(dto.toBudgetId);

    // Defensive same-company / same-fiscal-year check at intake (executeTransfer
    // re-checks under lock at approval). Both budgets are already in the active company.
    if (from.fiscalYear.company.id !== to.fiscalYear.company.id) {
      throw new BadRequestException('Transfer across companies is forbidden');
    }
    if (from.fiscalYear.id !== to.fiscalYear.id) {
      throw new BadRequestException('Transfer across fiscal years is forbidden');
    }

    const docType = await this.em.findOne(DocumentType, { code: TRANSFER_TYPE_CODE }, FILTER_OFF);
    if (!docType) {
      throw new BadRequestException(`Transfer document type ${TRANSFER_TYPE_CODE} is not configured`);
    }
    // The type must be enabled for the source budget's department (else unroutable).
    const mapping = await this.deptDocTypes.resolve(from.department.id, docType.id);

    const company = await this.em.findOne(Company, { id: companyId }, FILTER_OFF);
    const year = new Date().getUTCFullYear();
    const prefix = NumberingService.buildPrefix(docType.code, company!.code, year);
    const docNo = await this.numbering.next(companyId, docType.id, year, prefix);

    // Create the document + its movement atomically (mirrors BudgetAdjustmentService).
    const em = this.em.fork();
    const document = em.create(Document, {
      docNo,
      company: em.getReference(Company, companyId),
      department: em.getReference(Department, from.department.id),
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
        movementType: 'TRANSFER',
        fromBudget: em.getReference(Budget, from.id),
        toBudget: em.getReference(Budget, to.id),
        amount: dto.amount,
        reason: dto.reason,
        createdAt: new Date(),
      }),
    );

    await em.flush();
    return { documentId: document.id };
  }
}
