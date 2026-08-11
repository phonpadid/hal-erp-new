import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RequestContext } from '../../common/context/request-context';
import { Money } from '../../common/money/money';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { PeriodGuardService } from '../accounting/period/period-guard.service';
import { AccountService } from '../accounting/account.service';
import { Account } from '../accounting/accounting.entities';
import { Company } from '../multi-company/multi-company.entities';
import { createEntry, SOURCE_MANUAL, SOURCE_REVERSAL } from './gl-posting.service';
import { JournalEntry, JournalLine } from './gl.entities';
import { PostJournalVoucherDto, ReverseEntryDto } from './dto/journal-voucher.dto';

const FILTER_OFF = { filters: { company: false } } as const;

/**
 * The door for the entry no event produces.
 *
 * This service deliberately adds NO rules of its own. Balance, the company's calendar day, refusal
 * inside a closed accounting period and append-only all come from `createEntry`; whether an account
 * may be posted to comes from `AccountService.resolvePostable`. A voucher and a payment posting are
 * subject to the same ledger, and anything validated twice here would be the bug.
 *
 * It writes no `budget_txn`: an accountant correcting the ledger is not adjusting anyone's budget,
 * and the budget is a separate book (invariants 3 and 6). It records no `gl_posting_attempt` row
 * either — that table holds postings the SYSTEM owes itself and the period close reads it to decide
 * whether a month is drained, so putting a person's synchronous act there would make a close wait
 * on human work it cannot resolve. A voucher succeeds, or the caller gets the error.
 */
@Injectable()
export class JournalVoucherService {
  constructor(
    private readonly companyScope: CompanyScopeService,
    private readonly accounts: AccountService,
    private readonly periods: PeriodGuardService,
  ) {}

  /** Write a balanced entry by hand: depreciation, an accrual, opening balances, a correction. */
  async post(dto: PostJournalVoucherDto): Promise<JournalEntry> {
    const companyId = RequestContext.companyId()!;
    const em = this.companyScope.forActiveCompany();

    for (const l of dto.lines) {
      const oneSided =
        (Money.compare(l.debit, '0') > 0) !== (Money.compare(l.credit, '0') > 0);
      if (!oneSided) {
        throw new BadRequestException(
          `Line for account '${l.accountCode}' must carry exactly one non-zero side`,
        );
      }
    }

    // The resolver rejects an account that is missing, inactive, non-postable, or another
    // company's — every account rule a voucher needs, already written down once.
    const resolved = await Promise.all(
      dto.lines.map(async (l) => ({
        account: await this.accounts.resolvePostable(l.accountCode, companyId),
        debit: l.debit,
        credit: l.credit,
      })),
    );

    const sourceId = dto.id ?? randomUUID();
    // Idempotency is a LOOKUP, not a constraint violation. Leaving it to the unique index would
    // hand a retrying caller a duplicate-key error rather than the entry they already have — the
    // same `if (existing) return` every posting path uses, for the same reason.
    const already = await em.findOne(JournalEntry, { sourceType: SOURCE_MANUAL, sourceId });
    if (already) return already;

    const company = await em.findOneOrFail(Company, { id: companyId }, FILTER_OFF);
    return em.transactional((tem) =>
      createEntry(
        tem,
        {
          company,
          // Midday, so converting to the company's calendar day cannot land on a neighbouring one:
          // the caller named a DATE, and it must survive the timezone resolution unchanged.
          instant: new Date(`${dto.entryDate}T12:00:00Z`),
          sourceType: SOURCE_MANUAL,
          sourceId,
          memo: dto.memo,
          createdById: RequestContext.userId(),
          lines: resolved,
        },
        this.periods,
      ),
    );
  }

  /**
   * Correct an entry by writing its opposite. Corrections are reversing entries, never edits
   * (invariant 2) — this is what makes that rule usable rather than merely restrictive.
   *
   * ANY entry may be reversed, not only a manual one: a wrong automatic posting is the likelier
   * case, and refusing it would leave the ledger unable to correct what it most often gets wrong.
   */
  async reverse(entryId: string, dto: ReverseEntryDto = {}): Promise<JournalEntry> {
    const companyId = RequestContext.companyId()!;
    const em = this.companyScope.forActiveCompany();

    const original = await em.findOne(JournalEntry, { id: entryId });
    if (!original) throw new NotFoundException(`Journal entry ${entryId} not found`);

    // "Reversed at most once" is CHECKED here and BACKED by the unique index on
    // (company, source_type, source_id). The index alone would surface a duplicate-key error rather
    // than an explanation, so the lookup exists to give the caller a sentence; the constraint
    // exists so two concurrent requests cannot both get past it.
    const existing = await em.findOne(JournalEntry, {
      sourceType: SOURCE_REVERSAL,
      sourceId: entryId,
    });
    if (existing) {
      throw new BadRequestException(
        `Journal entry ${entryId} has already been reversed by entry ${existing.id}`,
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

    const company = await em.findOneOrFail(Company, { id: companyId }, FILTER_OFF);
    // Today by default, NOT the original's date (design D3). "Today" is `now` handed straight to
    // `createEntry`, which resolves it in the COMPANY's zone — deriving a date string here would
    // reintroduce the UTC-day bug the whole posting engine was corrected for.
    const instant = dto.entryDate ? new Date(`${dto.entryDate}T12:00:00Z`) : new Date();

    return em.transactional(async (tem) =>
      createEntry(
        tem,
        {
          company,
          instant,
          sourceType: SOURCE_REVERSAL,
          sourceId: entryId,
          memo: dto.memo ?? `Reversal of ${original.sourceType} entry ${entryId}`,
          createdById: RequestContext.userId(),
          // Sides exchanged. The balance is inherited: swapping every line's two sides leaves the
          // totals equal, so `createEntry`'s assertion cannot fail for a reason of our making.
          lines: lines.map((l) => ({
            account: l.account as Account,
            debit: l.credit,
            credit: l.debit,
          })),
        },
        this.periods,
      ),
    );
  }
}
