import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RequestContext } from '../../common/context/request-context';
import { DocStatus } from '../../common/enums';
import { Money } from '../../common/money/money';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { localDateIn } from '../../common/time/company-clock';
import { PeriodGuardService } from '../accounting/period/period-guard.service';
import { AccountService } from '../accounting/account.service';
import { Account } from '../accounting/accounting.entities';
import { DocumentService } from '../document/document.service';
import { DocumentSubmitService } from '../document/document-submit.service';
import { Document, DocumentType } from '../document/document.entities';
import { Company } from '../multi-company/multi-company.entities';
import { SOURCE_REVERSAL } from './gl-posting.service';
import { JournalEntry, JournalLine } from './gl.entities';
import { JournalVoucher, JournalVoucherLine } from './journal-voucher.entities';
import { PostJournalVoucherDto, ReverseEntryDto } from './dto/journal-voucher.dto';

const FILTER_OFF = { filters: { company: false } } as const;

/** The post-action that marks a document type as the one that posts journal vouchers. */
export const POST_JOURNAL_ACTION = 'POST_JOURNAL';

/**
 * The door for the entry no event produces — and it opens onto the same approval route as every
 * other document.
 *
 * `GL_JV_POST` used to write the ledger directly, then briefly through one checker written by hand
 * here. That hand-written control gave its reason: `approval_log`'s document is a required foreign
 * key and a voucher was not a document. The FK is real; the conclusion was not. A voucher is a
 * document now, and everything the maker-checker version implemented by hand is the engine's:
 *
 *   who may act        approver resolution, roles, delegation (one hop)
 *   how many must act  workflow_step amount bands — a voucher of 50m is not a voucher of 5,000
 *   self-approval      routing blocks the creator AND their delegator (invariant 8)
 *   taking it back     document cancellation, by its creator, before it is finalized
 *   the audit trail    approval_log — every step, not only the last decision
 *
 * This service still adds NO ledger rules of its own. Balance, the company's calendar day, refusal
 * inside a closed period and append-only all come from `createEntry`; whether an account may be
 * posted to comes from `AccountService.resolvePostable`. Those are checked at SUBMIT as well, so a
 * voucher that could never post is refused before anyone is asked to look at it.
 *
 * It writes no `budget_txn` and records no `gl_posting_attempt` row, for the reasons it always did.
 */
@Injectable()
export class JournalVoucherService {
  constructor(
    private readonly em: EntityManager,
    private readonly companyScope: CompanyScopeService,
    private readonly accounts: AccountService,
    private readonly periods: PeriodGuardService,
    private readonly documents: DocumentService,
    private readonly submits: DocumentSubmitService,
  ) {}

  /**
   * Raise a voucher and send it down its route. Writes a document, a voucher and its lines, and
   * NOTHING to the ledger.
   *
   * Posting at submit and reversing on rejection would put unapproved entries in an append-only
   * ledger, where "briefly" means permanently visible — which is what the control exists to prevent.
   */
  async submit(dto: PostJournalVoucherDto): Promise<JournalVoucher> {
    const companyId = RequestContext.companyId()!;
    const em = this.companyScope.forActiveCompany();

    const voucherId = dto.id ?? randomUUID();
    const already = await em.findOne(JournalVoucher, { id: voucherId }, { populate: ['document'] });
    if (already) return already;

    const resolved = await this.validateLines(dto.lines, companyId);
    await this.assertPeriodOpen(em, companyId, dto.entryDate);

    return this.raise(voucherId, dto.entryDate, dto.memo, resolved, undefined);
  }

  /**
   * Raise a REVERSAL as a voucher whose lines the system computed.
   *
   * Not a separate immediate path. `GL_JV_POST` describes a reversal as "a voucher whose lines were
   * computed for you"; leaving it outside the route would make that one code mean both "submit for
   * approval" and "write the ledger unreviewed", and the second is the stronger. An unreviewed path
   * beside a control is what makes the control decorative.
   */
  async submitReversal(entryId: string, dto: ReverseEntryDto = {}): Promise<JournalVoucher> {
    const companyId = RequestContext.companyId()!;
    const em = this.companyScope.forActiveCompany();

    const original = await em.findOne(JournalEntry, { id: entryId });
    if (!original) throw new NotFoundException(`Journal entry ${entryId} not found`);

    // "Reversed at most once" counts both what is posted and what is still in approval: two
    // in-flight reversals of the same entry would both be approvable, and the second would fail at
    // the unique index with nobody having been told.
    const posted = await em.findOne(JournalEntry, { sourceType: SOURCE_REVERSAL, sourceId: entryId });
    if (posted) {
      throw new BadRequestException(
        `Journal entry ${entryId} has already been reversed by entry ${posted.id}`,
      );
    }
    const inFlight = await em.find(
      JournalVoucher,
      { reversesEntryId: entryId },
      { populate: ['document'] },
    );
    if (inFlight.some((v) => IN_FLIGHT.includes(v.document.status))) {
      throw new BadRequestException(
        `A reversal of journal entry ${entryId} is already awaiting approval`,
      );
    }

    const lines = await em.find(
      JournalLine,
      { journalEntry: entryId },
      { ...FILTER_OFF, populate: ['account'] },
    );
    if (!lines.length) {
      throw new BadRequestException(`Journal entry ${entryId} has no lines to reverse`);
    }

    // Today by default, NOT the original's date: its period is frequently closed — often the reason
    // it is being reversed — and dating a correction into a reported month would either be refused
    // or restate figures somebody has acted on.
    const entryDate = dto.entryDate ?? (await this.companyToday(companyId));
    await this.assertPeriodOpen(em, companyId, entryDate);

    return this.raise(
      randomUUID(),
      entryDate,
      dto.memo ?? `Reversal of ${original.sourceType} entry ${entryId}`,
      // Sides exchanged. The balance is inherited, so `createEntry`'s assertion cannot fail for a
      // reason of our making.
      lines.map((l) => ({ account: l.account as Account, debit: l.credit, credit: l.debit })),
      entryId,
    );
  }

  /**
   * Take back a voucher of one's own that is still in approval.
   *
   * The document engine's cancellation, not a rule of this service's: only the creator may cancel,
   * and only before the document is finalized. A voucher dated in a month that closes before its
   * route completes can never be posted, and without this it would sit in the queue for good. An
   * approver who wants one gone rejects it with a remark, on the record; this is for the author's
   * own second thoughts.
   */
  cancel(documentId: string): Promise<void> {
    return this.submits.cancel(documentId);
  }

  /**
   * The vouchers still in approval, with the step each is waiting at.
   *
   * The step is part of the answer now: a voucher can require more than one approval, so "pending"
   * alone stopped telling an approver whether they are the one being waited for.
   */
  async pending(): Promise<
    Array<{
      voucher: JournalVoucher;
      docNo: string;
      status: DocStatus;
      currentStepNo: number;
      total: string;
    }>
  > {
    const em = this.companyScope.forActiveCompany();
    const vouchers = await em.find(
      JournalVoucher,
      { document: { status: { $in: IN_FLIGHT } } },
      {
        populate: ['lines', 'lines.account', 'document', 'document.createdBy'],
        orderBy: { createdAt: 'ASC' },
      },
    );
    return vouchers.map((v) => ({
      voucher: v,
      docNo: v.document.docNo,
      status: v.document.status,
      currentStepNo: v.document.currentStepNo,
      total: v.document.totalAmount ?? '0',
    }));
  }

  /**
   * Create the document, hang the voucher off it, and submit it.
   *
   * The document is created and submitted through the engine's own services rather than by writing
   * `document` rows here — it is a document, so it gets its number, its department's form template
   * and workflow, and its routing from the same code every other document uses. Routing starts on
   * the `document.submitted` event the submit service emits.
   */
  private async raise(
    voucherId: string,
    entryDate: string,
    memo: string,
    lines: Array<{ account: Account; debit: string; credit: string }>,
    reversesEntryId: string | undefined,
  ): Promise<JournalVoucher> {
    const companyId = RequestContext.companyId()!;
    const docType = await this.voucherType(companyId);

    // Σ debits, which for a voucher that balances is also Σ credits — so "the amount of a voucher"
    // is not a choice. This is what the workflow's amount bands compare against, and the reason the
    // lines are NOT document lines: their sum would be zero.
    const total = lines.reduce((t, l) => Money.add(t, l.debit), '0');

    const document = await this.documents.createDraft({
      documentTypeId: docType.id,
      totalAmount: total,
    } as never);

    const em = this.companyScope.forActiveCompany();
    const voucher = em.create(JournalVoucher, {
      id: voucherId,
      company: em.getReference(Company, companyId),
      document: em.getReference(Document, document.id),
      entryDate,
      memo,
      reversesEntryId,
      createdAt: new Date(),
    } as never);
    for (const line of lines) {
      em.create(JournalVoucherLine, {
        company: em.getReference(Company, companyId),
        voucher,
        account: line.account,
        debit: line.debit,
        credit: line.credit,
      } as never);
    }
    await em.flush();

    await this.submits.submit(document.id);
    // Populated so the caller learns the NUMBER its voucher was given: the author follows it through
    // the route by that number, and a reference serialises to an id nobody can look anything up by.
    await em.populate(voucher, ['document']);
    return voucher;
  }

  /**
   * The company's document type for vouchers, found by its POST_JOURNAL post-action rather than by
   * a type code (invariant 7): which type posts journals is configuration, and a company that
   * renames it must not lose the ability to raise one.
   */
  private async voucherType(companyId: string): Promise<DocumentType> {
    const types = await this.em.fork().find(
      DocumentType,
      { company: companyId, postAction: POST_JOURNAL_ACTION, isActive: true },
      FILTER_OFF,
    );
    if (!types.length) {
      throw new BadRequestException(
        `This company has no active document type with the '${POST_JOURNAL_ACTION}' post-action, ` +
          'so a journal voucher has no route to travel. Configure one.',
      );
    }
    if (types.length > 1) {
      throw new BadRequestException(
        `This company has ${types.length} active '${POST_JOURNAL_ACTION}' document types ` +
          `(${types.map((t) => t.code).join(', ')}); a voucher cannot choose between them.`,
      );
    }
    return types[0];
  }

  /**
   * Refuse a voucher dated in a closed period at SUBMIT.
   *
   * `createEntry` refuses it too, and that refusal is the invariant. This one is in front of it so
   * the refusal reaches the person who chose the date, rather than an approver several steps later
   * who did not choose it and cannot open the period.
   */
  private async assertPeriodOpen(
    em: EntityManager,
    companyId: string,
    entryDate: string,
  ): Promise<void> {
    const closed = await this.periods.closedPeriodOn(em, companyId, entryDate);
    if (closed) {
      throw new BadRequestException(
        `Accounting period ${closed.periodStart} to ${closed.periodEnd} is closed, so a voucher ` +
          `dated ${entryDate} cannot be raised`,
      );
    }
  }

  /**
   * Every rule a voucher must satisfy to be postable, checked at SUBMIT so a voucher that could
   * never post is refused before anyone is asked to read it.
   */
  private async validateLines(
    lines: PostJournalVoucherDto['lines'],
    companyId: string,
  ): Promise<Array<{ account: Account; debit: string; credit: string }>> {
    for (const l of lines) {
      const oneSided = (Money.compare(l.debit, '0') > 0) !== (Money.compare(l.credit, '0') > 0);
      if (!oneSided) {
        throw new BadRequestException(
          `Line for account '${l.accountCode}' must carry exactly one non-zero side`,
        );
      }
    }
    const debit = lines.reduce((t, l) => Money.add(t, l.debit), '0');
    const credit = lines.reduce((t, l) => Money.add(t, l.credit), '0');
    if (Money.compare(debit, credit) !== 0) {
      throw new BadRequestException(
        `Voucher does not balance: debits ${debit}, credits ${credit}`,
      );
    }
    // The resolver rejects an account that is missing, inactive, non-postable, or another
    // company's — every account rule a voucher needs, already written down once.
    return Promise.all(
      lines.map(async (l) => ({
        account: await this.accounts.resolvePostable(l.accountCode, companyId),
        debit: l.debit,
        credit: l.credit,
      })),
    );
  }

  /** The company's calendar day, for a reversal that did not name a date. */
  private async companyToday(companyId: string): Promise<string> {
    const em = this.companyScope.forActiveCompany();
    const company = await em.findOneOrFail(Company, { id: companyId }, FILTER_OFF);
    return localDateIn(new Date(), company.timezone);
  }
}

/** A voucher is still in approval while its document has not reached a terminal state. */
const IN_FLIGHT = [DocStatus.DRAFT, DocStatus.SUBMITTED, DocStatus.IN_APPROVAL];
