import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { Money } from '../../common/money/money';
import { inTransaction } from '../../common/uow/unit-of-work';
import { DocumentLine } from './document.entities';
import type { ReceiveDto } from './dto/document.dto';

const FILTER_OFF = { filters: { company: false } } as const;

export interface ReceivedLineView {
  lineId: string;
  lineNo: number;
  qty: string;
  receivedQty: string;
  lineStatus: string;
}

/** Goods receipt: accumulate received_qty on a document's lines and advance line_status. */
@Injectable()
export class ReceivingService {
  constructor(private readonly em: EntityManager) {}

  /** Derive line_status from received vs ordered qty. */
  private statusOf(receivedQty: string, orderedQty: string): string {
    if (Money.compare(receivedQty, '0') <= 0) return 'OPEN';
    if (Money.compare(receivedQty, orderedQty) >= 0) return 'RECEIVED';
    return 'PARTIAL';
  }

  /**
   * Record received quantities against the document's lines (company-scoped). Each line is
   * locked FOR UPDATE so concurrent receipts accumulate without lost updates; over-receipt
   * (received_qty above ordered qty) is rejected.
   */
  async receive(documentId: string, dto: ReceiveDto): Promise<ReceivedLineView[]> {
    const companyId = RequestContext.companyId()!;
    if (!dto.lines?.length) throw new BadRequestException('No receipt lines provided');

    return inTransaction(this.em, async (tem) => {
      const out: ReceivedLineView[] = [];
      for (const input of dto.lines) {
        if (Money.compare(input.qty, '0') <= 0) {
          throw new BadRequestException(`Received qty must be positive for line ${input.lineId}`);
        }
        const line = await tem.findOne(
          DocumentLine,
          { id: input.lineId },
          { ...FILTER_OFF, lockMode: LockMode.PESSIMISTIC_WRITE, populate: ['document'] },
        );
        if (!line || line.document.id !== documentId || line.document.company.id !== companyId) {
          throw new NotFoundException(`Line ${input.lineId} not found on document ${documentId}`);
        }
        const newReceived = Money.add(line.receivedQty, input.qty);
        if (Money.compare(newReceived, line.qty) > 0) {
          throw new BadRequestException(
            `Over-receipt on line ${line.lineNo}: ${newReceived} would exceed ordered ${line.qty}`,
          );
        }
        line.receivedQty = newReceived;
        line.lineStatus = this.statusOf(newReceived, line.qty);
        out.push({
          lineId: line.id,
          lineNo: line.lineNo,
          qty: line.qty,
          receivedQty: line.receivedQty,
          lineStatus: line.lineStatus,
        });
      }
      await tem.flush();
      return out;
    });
  }
}
