import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { StorageService } from '../../common/storage/storage.service';
import { BankFileFormatterRegistry } from './bank-file-formatter';
import { CsvBankFileFormatter } from './csv-bank-file.formatter';
import { PaymentBatchController } from './payment-batch.controller';
import { PaymentBatchService } from './payment-batch.service';
import { PaymentHandoffController } from './payment-handoff.controller';
import { PaymentHandoffListener } from './payment-handoff.listener';
import { PaymentHandoffService } from './payment-handoff.service';
import { Payment, PaymentBatch, PaymentBatchLine } from './payment.entities';
import { PaymentAttachmentService } from './payment-attachment.service';
import { PaymentService } from './payment.service';

@Module({
  imports: [MikroOrmModule.forFeature([Payment, PaymentBatch, PaymentBatchLine])],
  controllers: [PaymentHandoffController, PaymentBatchController],
  providers: [
    CompanyScopeService,
    StorageService,
    PaymentHandoffService,
    PaymentService,
    PaymentAttachmentService,
    PaymentBatchService,
    PaymentHandoffListener,
    CsvBankFileFormatter,
    // The CSV layout is provisional — no bank has confirmed the columns. It is registered so the
    // feature works today; a real spec means editing CsvBankFileFormatter alone, and a second
    // format means adding one more entry here.
    {
      provide: BankFileFormatterRegistry,
      useFactory: (csv: CsvBankFileFormatter) => new BankFileFormatterRegistry([csv]),
      inject: [CsvBankFileFormatter],
    },
  ],
  exports: [PaymentHandoffService, PaymentService, PaymentBatchService],
})
export class PaymentHandoffModule {}
