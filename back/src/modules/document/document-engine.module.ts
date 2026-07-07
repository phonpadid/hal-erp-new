import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { StorageService } from '../../common/storage/storage.service';
import { BudgetControlModule } from '../budget/budget-control.module';
import { MultiCurrencyModule } from '../currency/multi-currency.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { MultiCompanyModule } from '../multi-company/multi-company.module';
import { QuotaManagementModule } from '../quota/quota-management.module';
import { AttachmentService } from './attachment.service';
import { DeptDocTypeService } from './dept-doc-type.service';
import { DocumentConfigController } from './document-config.controller';
import { DocumentController } from './document.controller';
import { DocumentSubmitService } from './document-submit.service';
import { MatchingService } from './matching.service';
import { ReceivingService } from './receiving.service';
import { DocumentTypeService } from './document-type.service';
import {
  DeptDocType,
  DocFieldValue,
  DocRunningNumber,
  Document,
  DocumentAttachment,
  DocumentLine,
  DocumentType,
  FormField,
  FormTemplate,
} from './document.entities';
import { DocumentService } from './document.service';
import { FormTemplateService } from './form-template.service';
import { NumberingService } from './numbering.service';

@Module({
  imports: [
    MikroOrmModule.forFeature([
      DocumentType,
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
  ],
  controllers: [DocumentConfigController, DocumentController],
  providers: [
    CompanyScopeService,
    DocumentTypeService,
    FormTemplateService,
    DeptDocTypeService,
    NumberingService,
    DocumentService,
    DocumentSubmitService,
    ReceivingService,
    MatchingService,
    AttachmentService,
    StorageService,
  ],
  // releaseDocumentHolds is reused by approval-workflow's reject path.
  exports: [DocumentService, DocumentSubmitService],
})
export class DocumentEngineModule {}
