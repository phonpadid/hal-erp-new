import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { Currency, ExchangeRate } from './currency.entities';
import { CurrencyController } from './currency.controller';
import { CurrencyService } from './currency.service';
import { ExchangeRateController } from './exchange-rate.controller';
import { ExchangeRateService } from './exchange-rate.service';

@Module({
  imports: [MikroOrmModule.forFeature([Currency, ExchangeRate])],
  controllers: [CurrencyController, ExchangeRateController],
  providers: [CurrencyService, ExchangeRateService],
  // Resolver + converter consumed by budget-control and document-engine.
  exports: [CurrencyService, ExchangeRateService],
})
export class MultiCurrencyModule {}
