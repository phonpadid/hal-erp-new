import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { inTransaction, lockForUpdate } from '../../common/uow/unit-of-work';
import { MasterSequence, type MasterSequenceKind } from './master-data.entities';

const PREFIX: Record<MasterSequenceKind, string> = { VENDOR: 'V', ITEM: 'I' };

/**
 * Hands out the next `vendor_code` / `item_code`.
 *
 * The same discipline as document numbering: lock the counter row, increment, format. Called
 * INSIDE the create's own transaction (pass its `em`) so a create that fails after numbering
 * rolls the increment back with it — a number is only spent by a row that exists. A gap left by
 * a rolled-back transaction is accepted, exactly as it is for document numbers.
 */
@Injectable()
export class MasterSequenceService {
  constructor(private readonly em: EntityManager) {}

  async next(kind: MasterSequenceKind, em?: EntityManager): Promise<string> {
    const run = async (tem: EntityManager) => {
      const row = await lockForUpdate(tem, MasterSequence, { kind });
      // Seeded by the migration; a missing row is a deployment fault, not a case to paper over
      // with an insert that would restart the sequence at 1 under a legacy code.
      if (!row) throw new InternalServerErrorException(`master_sequence has no ${kind} row`);
      row.currentNo += 1;
      await tem.flush();
      return `${PREFIX[kind]}-${String(row.currentNo).padStart(5, '0')}`;
    };
    return em ? run(em) : inTransaction(this.em, run);
  }
}
