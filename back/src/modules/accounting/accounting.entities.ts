import { Entity, Enum, Index, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { AccountType } from '../../common/enums';
import { CompanyScopedEntity } from '../../common/entities/base.entity';
import { Company } from '../multi-company/multi-company.entities';

// account — per-company chart of accounts. gl_account codes on budgets reference these;
// account_type drives the future general ledger's normal balance. Company-scoped
// (invariant 1); code is unique per company.
@Entity({ tableName: 'account' })
@Unique({ properties: ['company', 'code'] })
export class Account extends CompanyScopedEntity {
  @ManyToOne(() => Company)
  company!: Company;

  @Property()
  code!: string;

  @Property()
  name!: string;

  @Enum({ items: () => AccountType })
  accountType!: AccountType;

  // Self-reference for the account hierarchy: parent must be the same company + same type.
  @Index()
  @ManyToOne(() => Account, { fieldName: 'parent_id', nullable: true })
  parent?: Account;

  // false = summary/header node; not selectable as a postable GL account.
  @Property({ default: true })
  isPostable: boolean = true;

  @Property({ default: true })
  isActive: boolean = true;
}
