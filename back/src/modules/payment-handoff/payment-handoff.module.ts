import { Module } from '@nestjs/common';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { PaymentHandoffController } from './payment-handoff.controller';
import { PaymentHandoffListener } from './payment-handoff.listener';
import { PaymentHandoffService } from './payment-handoff.service';
import { PaymentService } from './payment.service';

@Module({
  controllers: [PaymentHandoffController],
  providers: [CompanyScopeService, PaymentHandoffService, PaymentService, PaymentHandoffListener],
  exports: [PaymentHandoffService, PaymentService],
})
export class PaymentHandoffModule {}
