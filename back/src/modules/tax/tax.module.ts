import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { TaxController } from './tax.controller';
import { TaxService } from './tax.service';
import { TaxCode } from './tax.entities';

// Purchase tax (VAT slice). Exports TaxService so the document submit flow can compute line VAT.
@Module({
  imports: [MikroOrmModule.forFeature([TaxCode])],
  controllers: [TaxController],
  providers: [CompanyScopeService, TaxService],
  exports: [TaxService],
})
export class TaxModule {}
