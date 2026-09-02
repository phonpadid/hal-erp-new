import { Entity, Index, ManyToOne, OneToMany, Collection, Property, Unique } from '@mikro-orm/core';
import { CompanyScopedEntity } from '../../common/entities/base.entity';
import { Account } from '../accounting/accounting.entities';
import { Document } from '../document/document.entities';
import { Company } from '../multi-company/multi-company.entities';

/**
 * The accounting content of a journal voucher. Its header, its routing and its state live on the
 * `document` this hangs off.
 *
 * The document cannot express two things, and they are all that is left here: the accounting DATE
 * the preparer stated, and — for a reversal — the entry whose lines were computed into it. Everything
 * else a voucher used to carry is now the document's: who raised it, what number it has, which
 * workflow it rides, what step it waits at, and whether it was approved, rejected or cancelled.
 *
 * The lines stay in their own table rather than becoming `document_line` rows. A voucher line has a
 * SIDE, and `document_line` has one amount: signed amounts sum to zero for any voucher that balances
 * and unsigned amounts sum to double, while the document's total is exactly what the workflow bands
 * against. A voucher whose total reads zero routes into the lowest band no matter how large it is.
 *
 * It is not a duplicate of the entry. The entry is created FROM it, once, and never edited; the
 * voucher's id IS the entry's `source_id`, so the two are one record in two states.
 */
@Entity({ tableName: 'journal_voucher' })
@Unique({ properties: ['document'] })
export class JournalVoucher extends CompanyScopedEntity {
  @ManyToOne(() => Company)
  company!: Company;

  /**
   * The document that carries this voucher through its approval route.
   *
   * One document per voucher, enforced by the unique key: a second document for the same voucher
   * would be a second route to the same entry, and both could complete.
   */
  @ManyToOne(() => Document)
  document!: Document;

  /** The accounting date the preparer stated. NOT the date an approver got to it. */
  @Property({ columnType: 'date' })
  entryDate!: string;

  @Property()
  memo!: string;

  /**
   * Set when this voucher is a REVERSAL: the entry whose lines were computed into it. A reversal is
   * a voucher whose lines were computed for the submitter rather than typed by them, so it takes
   * the same route and the same approvers.
   */
  @Property({ type: 'uuid', nullable: true })
  reversesEntryId?: string;

  @Property({ columnType: 'timestamptz', nullable: true })
  createdAt?: Date = new Date();

  @OneToMany(() => JournalVoucherLine, (l) => l.voucher)
  lines = new Collection<JournalVoucherLine>(this);
}

@Entity({ tableName: 'journal_voucher_line' })
export class JournalVoucherLine extends CompanyScopedEntity {
  @ManyToOne(() => Company)
  company!: Company;

  @Index()
  @ManyToOne(() => JournalVoucher)
  voucher!: JournalVoucher;

  @ManyToOne(() => Account)
  account!: Account;

  @Property({ type: 'decimal', precision: 15, scale: 2, defaultRaw: '0' })
  debit: string = '0';

  @Property({ type: 'decimal', precision: 15, scale: 2, defaultRaw: '0' })
  credit: string = '0';

  @Property({ nullable: true })
  memo?: string;
}
