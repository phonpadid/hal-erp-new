import { MikroOrmModule } from '@mikro-orm/nestjs';
import { forwardRef, Module } from '@nestjs/common';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { StorageService } from '../../common/storage/storage.service';
import { AccountingModule } from '../accounting/accounting.module';
import { BudgetControlModule } from '../budget/budget-control.module';
import { InventoryModule } from '../inventory/inventory.module';
import { MultiCurrencyModule } from '../currency/multi-currency.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { MultiCompanyModule } from '../multi-company/multi-company.module';
import { QuotaManagementModule } from '../quota/quota-management.module';
import { GeneralLedgerModule } from '../gl/general-ledger.module';
import { ApprovalWorkflowModule } from '../approval/approval-workflow.module';
import { AttachmentService } from './attachment.service';
import { DeptDocTypeService } from './dept-doc-type.service';
import { DocumentCategoryService } from './document-category.service';
import { DocumentConfigController } from './document-config.controller';
import { DocumentController } from './document.controller';
import { DocumentSubmitService } from './document-submit.service';
import { MatchingService } from './matching.service';
import { ReceivingService } from './receiving.service';
import { DocumentTypeService } from './document-type.service';
import { RefChainService } from './ref-chain.service';
import {
  DeptDocType,
  DocFieldValue,
  DocRunningNumber,
  Document,
  DocumentAttachment,
  DocumentCategory,
  DocumentLine,
  DocumentType,
  DocumentTypeRef,
  FormField,
  FormTemplate,
} from './document.entities';
import { DocumentPdfService } from './document-pdf.service';
import { DocumentService } from './document.service';
import { FormTemplateService } from './form-template.service';
import { NumberingService } from './numbering.service';

@Module({
  imports: [
    MikroOrmModule.forFeature([
      DocumentType,
      DocumentCategory,
      DocumentTypeRef,
      FormTemplate,
      FormField,
      DeptDocType,
      Document,
      DocFieldValue,
      DocumentLine,
      DocumentAttachment,
      DocRunningNumber,
    ]),
    MultiCompanyModule,
    MultiCurrencyModule,
    MasterDataModule,
    BudgetControlModule,
    QuotaManagementModule,
    // PeriodGuardService, so a document stating the day its money moved is refused when that day
    // sits in a closed accounting period — the same guard the GL asks, rather than a second copy of
    // the question living here.
    AccountingModule,
    // Submit-time stock reservation + the release hook. Inventory is downstream of
    // document-engine in the build order and imports no module from here, so this is not a cycle.
    InventoryModule,
    // GlPostingService, to clear the payable in the same transaction that records a settlement.
    //
    // This IS a cycle, and deliberately so: the GL imports this module back, because a journal
    // voucher is a document — it needs a number, a department's workflow and the submit path, all
    // of which live here. The two capabilities genuinely depend on each other, and forwardRef is
    // how Nest is told that rather than a smell to be refactored away. Breaking it would mean
    // either the voucher writing `document` rows by hand (a second create path that would drift
    // from this one) or the settlement posting its own entry (a second posting path, worse).
    forwardRef(() => GeneralLedgerModule),
    // WorkflowStepResolver, so submit can ask whether a document is routable BEFORE it takes any
    // hold. Also a deliberate cycle: approval imports this module back (a route is about a
    // document). Asking "can this be approved by anyone" is genuinely a question for approval, and
    // the alternative — a second copy of the step-applicability predicate living here — is the
    // drift this codebase keeps paying for elsewhere (design D3a).
    forwardRef(() => ApprovalWorkflowModule),
  ],
  controllers: [DocumentConfigController, DocumentController],
  providers: [
    CompanyScopeService,
    DocumentTypeService,
    DocumentCategoryService,
    RefChainService,
    FormTemplateService,
    DeptDocTypeService,
    NumberingService,
    DocumentService,
    DocumentSubmitService,
    ReceivingService,
    MatchingService,
    AttachmentService,
    DocumentPdfService,
    StorageService,
  ],
  // releaseDocumentHolds is reused by approval-workflow's reject path.
  exports: [DocumentService, DocumentSubmitService],
})
export class DocumentEngineModule {}
