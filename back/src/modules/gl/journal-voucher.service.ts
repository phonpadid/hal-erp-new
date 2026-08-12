import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RequestContext } from '../../common/context/request-context';
import { Money } from '../../common/money/money';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { localDateIn } from '../../common/time/company-clock';
import { PeriodGuardService } from '../accounting/period/period-guard.service';
import { AccountService } from '../accounting/account.service';
import { Account } from '../accounting/accounting.entities';
import { Company } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { createEntry, SOURCE_MANUAL, SOURCE_REVERSAL } from './gl-posting.service';
import { JournalEntry, JournalLine } from './gl.entities';
import { JournalVoucher, JournalVoucherLine, JournalVoucherStatus } from './journal-voucher.entities';
import { PostJournalVoucherDto, ReverseEntryDto } from './dto/journal-voucher.dto';

const FILTER_OFF = { filters: { company: false } } as const;

/**
 * The door for the entry no event produces — now with a second pair of eyes on it.
 *
 * `GL_JV_POST` used to write the ledger directly. It documented its own gap: the largest privilege
 * in the system, guarded by a permission rather than by an approval route, with the instruction to
 * grant it to very few people until that route existed. This is that route, and it is
 * maker-checker rather than a configured chain: `approval_log.document` is a required foreign key
 * to `document`, and a voucher is not a document — its lines are account, debit and credit, which
 * `form_template` does not model. What the standard asks for here is segregation of duties, which
 * is one checker.
 *
 * This service still adds NO ledger rules of its own. Balance, the company's calendar day, refusal
 * inside a closed period and append-only all come from `createEntry`; whether an account may be
 * posted to comes from `AccountService.resolvePostable`. Those are checked at SUBMIT as well, so a
 * voucher that could never post is refused before a second person is asked to look at it.
 *
 * It writes no `budget_txn` and records no `gl_posting_attempt` row, for the reasons it always did.
 */
@Injectable()
export class JournalVoucherService {
  constructor(
    private readonly companyScope: CompanyScopeService,
    private readonly accounts: AccountService,
    private readonly periods: PeriodGuardService,
  ) {}

  /**
   * Record a voucher for approval. Writes `journal_voucher` and NOTHING else.
   *
   * Posting at submit and reversing on rejection would put unapproved entries in an append-only
   * ledger, where "briefly" means permanently visible — which is what the control exists to prevent.
   */
  async submit(dto: PostJournalVoucherDto): Promise<JournalVoucher> {
    const companyId = RequestContext.companyId()!;
    const userId = RequestContext.userId()!;
    const em = this.companyScope.forActiveCompany();

    const resolved = await this.validateLines(dto.lines, companyId);

    const voucherId = dto.id ?? randomUUID();
    const already = await em.findOne(JournalVoucher, { id: voucherId });
    if (already) return already;

    const voucher = em.create(JournalVoucher, {
      id: voucherId,
      company: em.getReference(Company, companyId),
      entryDate: dto.entryDate,
      memo: dto.memo,
      status: JournalVoucherStatus.PENDING,
      createdBy: em.getReference(AppUser, userId),
      createdAt: new Date(),
    } as never);
    for (const line of resolved) {
      em.create(JournalVoucherLine, {
        company: em.getReference(Company, companyId),
        voucher,
        account: line.account,
        debit: line.debit,
        credit: line.credit,
      } as never);
    }
    await em.flush();
    return voucher;
  }

  /**
   * Submit a REVERSAL as a voucher whose lines the system computed.
   *
   * Not a separate immediate path. `GL_JV_POST` describes a reversal as "a voucher whose lines were
   * computed for you"; leaving it outside the checker would make that one code mean both "submit
   * for approval" and "write the ledger unreviewed", and the second is the stronger. An unreviewed
   * path beside a control is what makes the control decorative.
   */
  async submitReversal(entryId: string, dto: ReverseEntryDto = {}): Promise<JournalVoucher> {
    const companyId = RequestContext.companyId()!;
    const userId = RequestContext.userId()!;
    const em = this.companyScope.forActiveCompany();

    const original = await em.findOne(JournalEntry, { id: entryId });
    if (!original) throw new NotFoundException(`Journal entry ${entryId} not found`);

    // "Reversed at most once" counts both what is posted and what is waiting: two pending reversals
    // of the same entry would both be approvable, and the second would fail at the unique index
    // with nobody having been told.
    const posted = await em.findOne(JournalEntry, { sourceType: SOURCE_REVERSAL, sourceId: entryId });
    if (posted) {
      throw new BadRequestException(
        `Journal entry ${entryId} has already been reversed by entry ${posted.id}`,
      );
    }
    const pending = await em.findOne(JournalVoucher, {
      reversesEntryId: entryId,
      status: JournalVoucherStatus.PENDING,
    });
    if (pending) {
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

    const voucher = em.create(JournalVoucher, {
      company: em.getReference(Company, companyId),
      // Today by default, NOT the original's date: its period is frequently closed — often the
      // reason it is being reversed — and dating a correction into a reported month would either be
      // refused or restate figures somebody has acted on.
      entryDate: dto.entryDate ?? (await this.companyToday(companyId)),
      memo: dto.memo ?? `Reversal of ${original.sourceType} entry ${entryId}`,
      status: JournalVoucherStatus.PENDING,
      reversesEntryId: entryId,
      createdBy: em.getReference(AppUser, userId),
      createdAt: new Date(),
    } as never);
    for (const l of lines) {
      em.create(JournalVoucherLine, {
        company: em.getReference(Company, companyId),
        voucher,
        account: l.account as Account,
        // Sides exchanged. The balance is inherited, so `createEntry`'s assertion cannot fail for a
        // reason of our making.
        debit: l.credit,
        credit: l.debit,
      } as never);
    }
    await em.flush();
    return voucher;
  }

  /**
   * Approve a pending voucher and post it.
   *
   * The submitter may not approve their own, whatever codes they hold: two people with both codes
   * still constitute a control, one person with both does not (invariant 8). Enforced here rather
   * than left to permission configuration, because a rule that depends on nobody granting two codes
   * to one user is a convention.
   */
  async approve(voucherId: string): Promise<JournalEntry> {
    const companyId = RequestContext.companyId()!;
    const userId = RequestContext.userId()!;
    const em = this.companyScope.forActiveCompany();

    const voucher = await this.requirePending(em, voucherId);
    if (voucher.createdBy.id === userId) {
      throw new ForbiddenException(
        'A voucher cannot be approved by the person who submitted it',
      );
    }

    const sourceType = voucher.reversesEntryId ? SOURCE_REVERSAL : SOURCE_MANUAL;
    const sourceId = voucher.reversesEntryId ?? voucher.id;
    const existing = await em.findOne(JournalEntry, { sourceType, sourceId });
    if (existing) return existing;

    const lines = await em.find(
      JournalVoucherLine,
      { voucher: voucher.id },
      { ...FILTER_OFF, populate: ['account'] },
    );
    const company = await em.findOneOrFail(Company, { id: companyId }, FILTER_OFF);

    const entry = await em.transactional((tem) =>
      createEntry(
        tem,
        {
          company,
          // Midday, so converting to the company's calendar day cannot land on a neighbouring one:
          // the preparer named a DATE, and the moment a checker reached it is not an accounting
          // fact.
          instant: new Date(`${voucher.entryDate}T12:00:00Z`),
          sourceType,
          sourceId,
          memo: voucher.memo,
          // The SUBMITTER. An entry is what its preparer wrote; the approval is a control event
          // about it, not authorship of it, and it lives on the voucher.
          createdById: voucher.createdBy.id,
          lines: lines.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit })),
        },
        this.periods,
      ),
    );

    voucher.status = JournalVoucherStatus.APPROVED;
    voucher.decidedBy = em.getReference(AppUser, userId);
    voucher.decidedAt = new Date();
    await em.flush();
    return entry;
  }

  /** Refuse a voucher, with a reason. Posts nothing. */
  async reject(voucherId: string, reason: string): Promise<JournalVoucher> {
    const userId = RequestContext.userId()!;
    const em = this.companyScope.forActiveCompany();
    if (!reason?.trim()) {
      throw new BadRequestException('Rejecting a voucher requires a reason');
    }
    const voucher = await this.requirePending(em, voucherId);
    voucher.status = JournalVoucherStatus.REJECTED;
    voucher.rejectReason = reason.trim();
    voucher.decidedBy = em.getReference(AppUser, userId);
    voucher.decidedAt = new Date();
    await em.flush();
    return voucher;
  }

  /**
   * Take back a pending voucher of one's own.
   *
   * A voucher dated in a month that closes before a checker reaches it can never be approved — the
   * period guard refuses it, correctly — and without this it would sit in the queue for good. A
   * checker who wants one gone rejects it with a reason, on the record; this is for the author's own
   * second thoughts.
   */
  async withdraw(voucherId: string): Promise<JournalVoucher> {
    const userId = RequestContext.userId()!;
    const em = this.companyScope.forActiveCompany();
    const voucher = await this.requirePending(em, voucherId);
    if (voucher.createdBy.id !== userId) {
      throw new ForbiddenException('Only the person who submitted a voucher may withdraw it');
    }
    voucher.status = JournalVoucherStatus.WITHDRAWN;
    voucher.decidedBy = em.getReference(AppUser, userId);
    voucher.decidedAt = new Date();
    await em.flush();
    return voucher;
  }

  /** What a checker is being asked to accept. */
  pending(): Promise<JournalVoucher[]> {
    return this.companyScope
      .forActiveCompany()
      .find(
        JournalVoucher,
        { status: JournalVoucherStatus.PENDING },
        { populate: ['lines', 'lines.account', 'createdBy'], orderBy: { createdAt: 'ASC' } },
      );
  }

  private async requirePending(
    em: ReturnType<CompanyScopeService['forActiveCompany']>,
    voucherId: string,
  ): Promise<JournalVoucher> {
    const voucher = await em.findOne(JournalVoucher, { id: voucherId }, { populate: ['createdBy'] });
    if (!voucher) throw new NotFoundException(`Journal voucher ${voucherId} not found`);
    if (voucher.status !== JournalVoucherStatus.PENDING) {
      throw new BadRequestException(`Voucher ${voucherId} is ${voucher.status}`);
    }
    return voucher;
  }

  /**
   * Every rule a voucher must satisfy to be postable, checked at SUBMIT so a voucher that could
   * never post is refused before a checker is asked to read it.
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
