import { Entity, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { CompanyScopedEntity } from '../../common/entities/base.entity';
import { Account } from '../accounting/accounting.entities';
import { Currency } from '../currency/currency.entities';
import { Company } from '../multi-company/multi-company.entities';

/**
 * The company's OWN account at a bank — not `vendor_bank_account`, which is where money goes.
 *
 * It NAMES a GL account rather than being one. The chart of accounts is configuration a company
 * already owns; a bank account is a fact about the outside world, and keeping them separate lets
 * two bank accounts share nothing, or share one GL account if a company deliberately wants that.
 *
 * Deactivated rather than deleted: payments point at it.
 */
@Entity({ tableName: 'bank_account' })
@Unique({ properties: ['company', 'accountNo'] })
export class BankAccount extends CompanyScopedEntity {
  @ManyToOne(() => Company)
  company!: Company;

  @Property()
  name!: string;

  @Property()
  bankName!: string;

  @Property()
  accountNo!: string;

  @ManyToOne(() => Currency)
  currency!: Currency;

  /** The GL account whose balance represents this bank account. */
  @ManyToOne(() => Account)
  glAccount!: Account;

  @Property({ default: true })
  isActive: boolean = true;

  @Property({ columnType: 'timestamptz', nullable: true })
  createdAt?: Date = new Date();
}
