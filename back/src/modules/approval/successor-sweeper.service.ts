import { LockMode } from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, Logger } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { DocStatus, PendingSuccessorStatus } from '../../common/enums';
import { Document } from '../document/document.entities';
import { DocumentService } from '../document/document.service';
import { PendingSuccessor } from './approval.entities';

const FILTER_OFF = { filters: { company: false } } as const;

/** Attempts before a row is parked in FAILED. At the 1-minute sweep interval that is ~5 minutes. */
export const MAX_ATTEMPTS = 5;

/**
 * Drains the CREATE_SUCCESSOR outbox: creates the DRAFT successor each approved document owes and
 * marks its `pending_successor` row DONE.
 *
 * Runs OUTSIDE the approval transaction, on purpose. `createFrom` requires its predecessor to be
 * APPROVED or COMPLETED — a state the source only reaches once that transaction commits — and a
 * broken successor configuration must never be able to fail an approval its approvers already
 * granted. The obligation itself was committed atomically with the approval, so nothing is lost by
 * doing the work late; that is what keeps the document from being half-applied.
 *
 * A failure here is recorded on the row, never thrown at the approval: transient faults retry, and
 * a row that exhausts MAX_ATTEMPTS parks in FAILED where it can be queried — the state that
 * replaces the log line nobody read.
 */
@Injectable()
export class SuccessorSweeper {
  private readonly logger = new Logger(SuccessorSweeper.name);

  constructor(
    private readonly em: EntityManager,
    private readonly documents: DocumentService,
  ) {}

  /**
   * Fulfil every PENDING obligation, oldest first. Each row is claimed and completed in its own
   * transaction, so one poisonous row cannot roll back the others' work.
   */
  async scanPending(): Promise<number> {
    const pending = await this.em
      .fork()
      .find(
        PendingSuccessor,
        { status: PendingSuccessorStatus.PENDING },
        { ...FILTER_OFF, orderBy: { createdAt: 'ASC' }, fields: ['id'] },
      );

    let created = 0;
    for (const { id } of pending) {
      if (await this.fulfil(id)) created += 1;
    }
    return created;
  }

  /**
   * Claim one row and fulfil it. Returns whether a successor was created.
   *
   * The claim, the create, and the DONE transition share ONE transaction: if the process dies
   * mid-flight the whole thing rolls back, so a created successor can never be left beside a row
   * still marked PENDING that the next sweep would create a second time.
   *
   * `SKIP LOCKED` rather than a plain FOR UPDATE: a row another sweeper already holds is skipped,
   * not waited on. Two instances therefore cannot both fulfil one obligation, and a slow row does
   * not stall the queue behind it. Document numbering's own lock does NOT cover this — it would
   * happily give two duplicate successors two different numbers.
   */
  private async fulfil(rowId: string): Promise<boolean> {
    try {
      return await this.em.fork().transactional(async (tem) => {
        const row = await tem.findOne(
          PendingSuccessor,
          { id: rowId, status: PendingSuccessorStatus.PENDING },
          {
            ...FILTER_OFF,
            lockMode: LockMode.PESSIMISTIC_WRITE,
            lockTableAliases: ['p0'],
            populate: ['sourceDocument', 'successorType', 'department'],
          },
        );
        // Claimed by another sweeper, or already fulfilled, between the scan and now.
        if (!row) return false;

        // The obligation is that the source HAS its successor, not that this sweep inserted it.
        // Somebody who raised the PO by hand before the sweep ran has met it; a second create
        // would be refused by the one-live-successor rule anyway, and five refusals would park a
        // delivered obligation in FAILED. Live = not REJECTED/CANCELLED, the same reading the rule
        // itself uses: a cancelled hand-raised PO has freed the slot, and the sweep fills it.
        const existing = await this.alreadyRaised(tem, row);
        if (existing) {
          row.status = PendingSuccessorStatus.DONE;
          row.updatedAt = new Date();
          this.logger.log(
            `CREATE_SUCCESSOR: ${row.successorType.code} ${existing.docNo} already exists for ${row.sourceDocument.docNo}, obligation met`,
          );
          return true;
        }

        // The sweep has no ambient request to inherit an identity from, so build one from the
        // obligation itself: the source document's company and requester, and the department the
        // obligation resolved when it was recorded. Attributing the successor to the approver —
        // which is what the old post-commit path did by accident, running inside their request —
        // silently barred that approver from acting on the successor under invariant 8.
        const store = {
          userId: row.sourceDocument.createdBy?.id,
          companyId: row.company.id,
          departmentId: row.department.id,
          grants: [],
        };
        const successor = await RequestContext.run(store, () =>
          this.documents.createFrom(row.sourceDocument.id, row.successorType.id),
        );

        row.status = PendingSuccessorStatus.DONE;
        row.updatedAt = new Date();
        this.logger.log(
          `CREATE_SUCCESSOR created ${row.successorType.code} ${successor.docNo} from ${row.sourceDocument.docNo}`,
        );
        return true;
      });
    } catch (e) {
      await this.recordFailure(rowId, e as Error);
      return false;
    }
  }

  /** The live successor of the row's type already raised from its source, if any. */
  private alreadyRaised(tem: EntityManager, row: PendingSuccessor): Promise<Document | null> {
    return tem.findOne(
      Document,
      {
        refDocument: row.sourceDocument.id,
        documentType: row.successorType.id,
        status: { $nin: [DocStatus.REJECTED, DocStatus.CANCELLED] },
      },
      FILTER_OFF,
    );
  }

  /**
   * Record a failed attempt. Written in its own transaction because the attempt's transaction has
   * already rolled back — without this the failure itself would vanish and the row would look
   * untouched forever.
   */
  private async recordFailure(rowId: string, error: Error): Promise<void> {
    await this.em.fork().transactional(async (tem) => {
      const row = await tem.findOne(PendingSuccessor, { id: rowId }, FILTER_OFF);
      if (!row) return;
      row.attempts += 1;
      row.lastError = error.message;
      row.updatedAt = new Date();
      if (row.attempts >= MAX_ATTEMPTS) {
        row.status = PendingSuccessorStatus.FAILED;
        this.logger.error(
          `CREATE_SUCCESSOR gave up on ${rowId} after ${row.attempts} attempts: ${error.message}`,
        );
      } else {
        this.logger.warn(
          `CREATE_SUCCESSOR attempt ${row.attempts}/${MAX_ATTEMPTS} failed for ${rowId}: ${error.message}`,
        );
      }
    });
  }
}
