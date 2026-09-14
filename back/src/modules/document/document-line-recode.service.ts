import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import {
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { ApproveAction, DocStatus } from '../../common/enums';
import { ErrorCode, coded } from '../../common/errors/error-code';
import { Money } from '../../common/money/money';
import { inTransaction } from '../../common/uow/unit-of-work';
import { Account } from '../accounting/accounting.entities';
import { ApprovalLog } from '../approval/approval.entities';
import { ApproverResolverService } from '../approval/approver-resolver.service';
import { DocumentRouteService } from '../approval/document-route.service';
import { JournalEntry } from '../gl/gl.entities';
import { AppUser } from '../rbac/rbac.entities';
import { Document, DocumentLine } from './document.entities';

const FILTER_OFF = { filters: { company: false } } as const;

/** What a recode did, for the caller to report without a second read. */
export interface RecodedLine {
  documentId: string;
  lineNo: number;
  from: { id: string; code: string };
  to: { id: string; code: string };
}

/**
 * Re-coding the account a document line posts to: the correction the person who knows the chart of
 * accounts makes, while the document can still be refused.
 *
 * `document_line.account_id` is resolved from configuration once, at submit, and never re-derived
 * — an item's default GL edited after approval must not move the account a settlement debits. That
 * rule stands. What this narrows is who else may move it: nobody was the answer, and the people who
 * know where a line belongs are the accounting step at the end of every route, who could only
 * approve what they were handed or send the whole document back to a requester who cannot fix the
 * account either. So one line's account can be restated by a person, on a step configured to allow
 * it, attributed, and only while an approval remains — the same narrowing invariant 6 received for
 * the rate in `DocumentRateService`.
 *
 * Not an `act()` action. The verdict path opens and closes route steps, releases holds and emits
 * `approval.outcome`; a recode does none of that. It is a correction made BETWEEN verdicts, like a
 * restatement, and it borrows the approve path's lock and its eligibility resolver rather than its
 * branches. It borrows nothing from the budget: `budget_id`, every amount and every basis are what
 * they were at submit, and no `budget_txn` is written — the money still comes out of the same
 * budget, only the account it is expensed to moves.
 */
@Injectable()
export class DocumentLineRecodeService {
  constructor(
    private readonly em: EntityManager,
    private readonly route: DocumentRouteService,
    private readonly resolver: ApproverResolverService,
  ) {}

  /**
   * Move `lineNo` of `documentId` to `accountId`.
   *
   * One transaction under the document's PESSIMISTIC_WRITE lock — the lock `act()` takes — so a
   * recode and the final APPROVE serialise: whichever is second sees the first's result. An approve
   * that lands first completes the document and the status gate below refuses; a recode that lands
   * first is what the approve's posting reads. There is no interleaving in which an entry is written
   * from lines that then change.
   *
   * Every gate runs before the write and before the `approval_log` row. The log is append-only
   * (invariant 2): a recode that must be refused is refused before it is recorded, never compensated
   * after.
   */
  async recode(documentId: string, lineNo: number, accountId: string): Promise<RecodedLine> {
    const actingUserId = RequestContext.userId()!;
    const companyId = RequestContext.companyId()!;

    return inTransaction(this.em, async (tem) => {
      // Read without the filter and compared to the active company by hand, as `DocumentRateService`
      // does: another company's document is not-found, not forbidden (invariant 1). Locked so the
      // approve path cannot advance underneath us.
      const document = await tem.findOne(
        Document,
        { id: documentId },
        { ...FILTER_OFF, lockMode: LockMode.PESSIMISTIC_WRITE, populate: ['company', 'createdBy'] },
      );
      if (!document || document.company.id !== companyId) {
        throw new NotFoundException(`Document ${documentId} not found`);
      }
      if (document.status !== DocStatus.IN_APPROVAL) {
        throw coded(
          ErrorCode.INVALID_STATE,
          `Document ${document.docNo} is ${document.status}; a line's account can only be re-coded while it is in approval`,
        );
      }

      // The ROUTE step, not the live workflow_step: the route is what this document is running, so
      // a flag turned on after submit reaches documents submitted afterwards and cannot change the
      // terms of one already in approval (invariant 7, and the slip gate's reasoning).
      const step = await this.route.routeStep(documentId, document.currentStepNo, tem);
      if (!step) throw new BadRequestException('No current workflow step');
      if (!step.allowsAccountRecode) {
        throw new BadRequestException(
          `Step ${step.stepNo} of ${document.docNo} does not allow re-coding a line's account`,
        );
      }

      // Eligibility for the current step — principal or active delegate — is the resolver's one
      // definition, shared with `act()`. Self-approval is not checked here: a recode is not an
      // approval, and a creator is never an eligible approver of their own document anyway.
      const actors = await this.resolver.eligible(step, document);
      const entry = actors.find((a) => a.userId === actingUserId);
      if (!entry) throw new ForbiddenException('Not an eligible approver for this step');

      // Belt and braces: IN_APPROVAL already precedes every accrual and settlement, but this is the
      // invariant the whole change rests on and it costs one indexed read. An entry already posted
      // is corrected through a reversing voucher, never by moving the line beneath it.
      const posted = await tem.findOne(
        JournalEntry,
        { company: companyId, sourceId: documentId },
        FILTER_OFF,
      );
      if (posted) {
        throw coded(
          ErrorCode.INVALID_STATE,
          `Document ${document.docNo} already has a journal entry (${posted.sourceType}); ` +
            'its lines can no longer be re-coded — reverse the entry and post a voucher instead',
        );
      }

      const line = await tem.findOne(
        DocumentLine,
        { document: documentId, lineNo },
        { ...FILTER_OFF, populate: ['account'] },
      );
      if (!line) throw new NotFoundException(`Line ${lineNo} not found on ${document.docNo}`);
      if (Money.compare(line.lineAmount, '0') <= 0) {
        throw new BadRequestException(
          `Line ${lineNo} of ${document.docNo} has no amount, so it posts nothing and has no account to re-code`,
        );
      }

      // The same three checks submit applies when it stamps the line: in this company, active,
      // postable. A code naming nothing postable is the state the posting dies on.
      const account = await tem.findOne(Account, { id: accountId, company: companyId }, FILTER_OFF);
      if (!account || !account.isActive || !account.isPostable) {
        throw new BadRequestException(
          `Account ${accountId} is not an active, postable account of this company`,
        );
      }
      if (line.account?.id === account.id) {
        throw coded(
          ErrorCode.INVALID_STATE,
          `Line ${lineNo} of ${document.docNo} already posts to ${account.code}; nothing to re-code`,
          HttpStatus.CONFLICT,
        );
      }

      const from = line.account
        ? { id: line.account.id, code: line.account.code }
        : { id: '', code: line.glAccount ?? '' };

      // The write: the stamp and its display code, kept in step so the line table, the PDF and the
      // ledger never disagree. Nothing else on the line moves.
      line.account = account;
      line.glAccount = account.code;

      // Append-only audit row, in the same transaction as the line — a document whose account moved
      // between two approvals must be distinguishable from one that never did.
      tem.persist(
        tem.create(ApprovalLog, {
          document: tem.getReference(Document, documentId),
          stepNo: document.currentStepNo,
          approver: tem.getReference(AppUser, actingUserId),
          delegatedFrom: entry.delegatedFrom
            ? tem.getReference(AppUser, entry.delegatedFrom)
            : undefined,
          action: ApproveAction.RECODE_ACCOUNT,
          remark: `line ${lineNo}: ${from.code || '—'} → ${account.code}`,
          actedAt: new Date(),
        }),
      );

      return {
        documentId,
        lineNo,
        from,
        to: { id: account.id, code: account.code },
      };
    });
  }
}
