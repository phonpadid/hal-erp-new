import { Entity, Enum, Index, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { AccountType } from '../../common/enums';
import { CompanyScopedEntity } from '../../common/entities/base.entity';
import { Company } from '../multi-company/multi-company.entities';

// account — per-company chart of accounts. gl_account codes on budgets reference these;
// account_type drives the future general ledger's normal balance. Company-scoped
// (invariant 1); code is unique per company.
@Entity({ tableName: 'account' })
@Unique({ properties: ['company', 'code'] })
// Created by Migration20260707000000. Hierarchy reads always filter by the active company first
// (invariant 1), so the company/parent pair is the useful index — a bare parent_id one would be
// redundant behind that filter.
@Index({ properties: ['company', 'parent'] })
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
  // Indexed by the class-level (company, parent) index above.
  @ManyToOne(() => Account, { fieldName: 'parent_id', nullable: true })
  parent?: Account;

  // false = summary/header node; not selectable as a postable GL account.
  @Property({ default: true })
  isPostable: boolean = true;

  @Property({ default: true })
  isActive: boolean = true;
}
