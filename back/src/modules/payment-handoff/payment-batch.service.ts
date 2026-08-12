import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { Money } from '../../common/money/money';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { StorageService } from '../../common/storage/storage.service';
import { BankAccount } from './bank-account.entities';
import { Company } from '../multi-company/multi-company.entities';
import { Document } from '../document/document.entities';
import { AppUser } from '../rbac/rbac.entities';
import { TaxKind } from '../../common/enums';
import { TaxCode } from '../tax/tax.entities';
import { TaxService } from '../tax/tax.service';
import { VendorBankAccount } from '../master-data/master-data.entities';
import { BankFileFormatterRegistry, toBankFileRows } from './bank-file-formatter';
import { CsvBankFileFormatter } from './csv-bank-file.formatter';
import { Payment, PaymentBatch, PaymentBatchLine } from './payment.entities';
import { PaymentHandoffService } from './payment-handoff.service';
import { PaymentService } from './payment.service';
import type { BuildBatchDto, ImportResultDto } from './dto/payment-batch.dto';

const FILTER_OFF = { filters: { company: false } } as const;

/** Batches that still hold their payables; a terminal one releases them back to the queue. */
export const OPEN_BATCH_STATUSES = ['DRAFT', 'EXPORTED'];
/** Batches that can still be cancelled. */
const CANCELLABLE = ['DRAFT', 'EXPORTED'];

/**
 * A payment run: pick payables off the ready-to-pay queue, export a file for the bank, upload the
 * bank's result, record the payments.
 *
 * Writes no `budget_txn` and no `quota_usage`, ever. The budget was settled to ACTUAL when the
 * CUT_BUDGET document completed; touching it here would charge the budget twice (invariant 3), and
 * the FX delta found at import belongs to accounting rather than to the budget's locked basis
 * (invariant 6).
 */
@Injectable()
export class PaymentBatchService {
  constructor(
    private readonly em: EntityManager,
    private readonly scope: CompanyScopeService,
    private readonly handoff: PaymentHandoffService,
    private readonly formatters: BankFileFormatterRegistry,
    private readonly storage: StorageService,
    private readonly payments: PaymentService,
  ) {}

  /** A batch of the active company, or reject — another company's batch is simply not found. */
  private async require(id: string): Promise<PaymentBatch> {
    const batch = await this.scope.forActiveCompany().findOne(PaymentBatch, { id });
    if (!batch) throw new NotFoundException(`Payment batch ${id} not found`);
    return batch;
  }

  async get(id: string): Promise<{ batch: PaymentBatch; lines: PaymentBatchLine[] }> {
    const batch = await this.require(id);
    const lines = await this.em.fork().find(
      PaymentBatchLine,
      { batch: batch.id },
      { ...FILTER_OFF, populate: ['document', 'whtTaxCode'] },
    );
    return { batch, lines };
  }

  async list(): Promise<PaymentBatch[]> {
    return this.scope
      .forActiveCompany()
      .find(PaymentBatch, {}, { populate: ['createdBy'], orderBy: { createdAt: 'DESC' } });
  }

  /**
   * Build a DRAFT run from documents currently on the ready-to-pay queue.
   *
   * Every line SNAPSHOTS the payee and amount rather than joining them live: a later edit to
   * `vendor_bank_account` must not rewrite what an exported batch says, or the stored file and the
   * database would disagree and the artifact would stop being evidence of what was sent.
   *
   * Payability is decided by the queue itself, not re-derived here — so "already paid", "not
   * COMPLETED", "another company's", and "already on an open batch" all fall out of one rule.
   */
  async build(dto: BuildBatchDto): Promise<PaymentBatch> {
    if (dto.documentIds.length === 0) {
      throw new BadRequestException('A batch needs at least one payable');
    }
    const companyId = RequestContext.companyId()!;
    const payable = new Map((await this.handoff.readyToPay()).map((p) => [p.documentId, p]));

    return this.em.transactional(async (tem) => {
      // Scoped read: a bank account of ANOTHER company would attribute this company's cash to
      // somebody else's ledger (invariant 1).
      const bankAccount = dto.bankAccountId
        ? await tem.findOne(BankAccount, { id: dto.bankAccountId, company: companyId }, FILTER_OFF)
        : null;
      if (dto.bankAccountId && !bankAccount) {
        throw new BadRequestException(`Bank account ${dto.bankAccountId} not found for this company`);
      }

      const batch = tem.create(PaymentBatch, {
        company: tem.getReference(Company, companyId),
        bankAccount: bankAccount ?? undefined,
        status: 'DRAFT',
        format: dto.format ?? 'CSV',
        payDate: dto.payDate,
        createdBy: tem.getReference(AppUser, RequestContext.userId()!),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const whtByDoc = new Map((dto.lines ?? []).map((l) => [l.documentId, l.whtTaxCodeId]));
      for (const documentId of dto.documentIds) {
        const p = payable.get(documentId);
        if (!p) {
          throw new BadRequestException(
            `Document ${documentId} is not payable — already paid, not settled, already on an open batch, or another company's`,
          );
        }
        if (!p.payee) {
          throw new BadRequestException(`Document ${p.docNo} has no payee bank account`);
        }
        const whtTaxCodeId = whtByDoc.get(documentId);
        tem.create(PaymentBatchLine, {
          company: tem.getReference(Company, companyId),
          batch,
          document: tem.getReference(Document, documentId),
          bankCode: p.payee.bankCode,
          accountNo: p.payee.accountNo,
          accountName: p.payee.accountName,
          amount: p.baseAmount,
          whtTaxCode: whtTaxCodeId ? tem.getReference(TaxCode, whtTaxCodeId) : undefined,
          whtAmount: '0',
        });
      }
      await tem.flush();
      return batch;
    });
  }

  /**
   * Cancel a run, releasing its unpaid payables back to the queue — which needs no requeue code:
   * the queue simply stops seeing a batch that is no longer open.
   *
   * Payments already recorded from a PARTIAL batch survive; only the unpaid lines come back. A
   * COMPLETED batch cannot be cancelled — its money is gone.
   */
  async cancel(id: string): Promise<PaymentBatch> {
    return this.em.transactional(async (tem) => {
      const scoped = await this.require(id);
      const batch = await tem.findOneOrFail(PaymentBatch, { id: scoped.id }, FILTER_OFF);
      if (!CANCELLABLE.includes(batch.status)) {
        throw new BadRequestException(`A ${batch.status} batch cannot be cancelled`);
      }
      batch.status = 'CANCELLED';
      batch.updatedAt = new Date();
      await tem.flush();
      return batch;
    });
  }

  /**
   * Render the run and hand back the bytes for the bank.
   *
   * Re-exporting an already EXPORTED batch returns the STORED bytes rather than re-rendering: the
   * file the bank received must stay reproducible, and re-rendering could quietly produce something
   * else. Lines are frozen from EXPORTED onward for the same reason.
   */
  async export(id: string): Promise<{ bytes: Buffer; fileName: string; contentType: string }> {
    const batch = await this.require(id);
    if (!['DRAFT', 'EXPORTED'].includes(batch.status)) {
      throw new BadRequestException(`A ${batch.status} batch cannot be exported`);
    }
    const formatter = this.formatters.resolve(batch.format);
    const fileName = `${batch.id}.${formatter.extension}`;

    // Already sent: give back exactly what went out.
    if (batch.status === 'EXPORTED' && batch.filePath) {
      return {
        bytes: await this.storage.getObject(batch.filePath),
        fileName,
        contentType: formatter.contentType,
      };
    }

    const companyId = RequestContext.companyId()!;
    const company = await this.em
      .fork()
      .findOne(Company, { id: companyId }, { ...FILTER_OFF, populate: ['baseCurrency'] });
    const dp = company?.baseCurrency?.decimalPlaces ?? 2;
    const currency = company?.baseCurrency?.code ?? '';

    const lines = await this.em.fork().find(
      PaymentBatchLine,
      { batch: batch.id },
      { ...FILTER_OFF, populate: ['document', 'whtTaxCode'] },
    );
    if (lines.length === 0) throw new BadRequestException('An empty batch cannot be exported');

    // Refuse rather than redirect: the approvers approved a specific account, so paying a
    // different one — even the vendor's current primary — would defeat the entire control.
    for (const line of lines) {
      const live = await this.resolveLiveAccount(line);
      if (!live || !live.isActive) {
        throw new BadRequestException(
          `Document ${line.document.docNo} names payee account ${line.accountNo} (${line.bankCode}), which is no longer active — return and resubmit the document with a valid payee`,
        );
      }
    }

    const bytes = await this.em.transactional(async (tem) => {
      const fresh = await tem.findOneOrFail(PaymentBatch, { id: batch.id }, FILTER_OFF);
      const freshLines = await tem.find(
        PaymentBatchLine,
        { batch: fresh.id },
        { ...FILTER_OFF, populate: ['document', 'whtTaxCode'] },
      );

      // Withholding is computed here, not at import: the file must carry the NET amount, and the
      // vendor is paid net of what we withhold on their behalf.
      for (const line of freshLines) {
        line.whtAmount = await this.computeWht(tem, line, dp);
      }

      const rendered = formatter.render(fresh, toBankFileRows(freshLines, currency));
      const key = this.storage.buildPaymentBatchKey(fresh.id, fileName);
      await this.storage.putObject(key, rendered, formatter.contentType);

      fresh.filePath = key;
      fresh.status = 'EXPORTED';
      fresh.exportedAt = new Date();
      fresh.updatedAt = new Date();
      await tem.flush();
      return rendered;
    });

    return { bytes, fileName, contentType: formatter.contentType };
  }

  /**
   * Apply the bank's result: record a payment for every line it paid, and the reason for every one
   * it rejected.
   *
   * Takes `LockMode.PESSIMISTIC_WRITE` on the batch row so two finance users uploading the same
   * result serialize rather than both recording; the whole thing then runs in one transaction with
   * the payments themselves, so the batch's status and its payment rows can never disagree.
   *
   * Writes NO `budget_txn`. The budget was settled at the locked BUDGET_RATE basis when the
   * document completed; the FX delta discovered here belongs to accounting and reaches it through
   * the existing `payment.settled` event. Writing it to the budget would recompute a locked rate
   * (invariant 6) and charge the budget twice (invariant 3).
   *
   * A rejected line is DATA, not an error: it is recorded and the run carries on, and the document
   * returns to the queue on its own because it still has no `payment`.
   */
  async importResult(id: string, dto: ImportResultDto): Promise<{ batch: PaymentBatch; lines: PaymentBatchLine[] }> {
    const scoped = await this.require(id);

    await this.em.transactional(async (tem) => {
      const batch = await tem.findOne(
        PaymentBatch,
        { id: scoped.id },
        { ...FILTER_OFF, lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!batch) throw new NotFoundException(`Payment batch ${id} not found`);
      // Only a batch that actually went to the bank can have a result.
      if (batch.status !== 'EXPORTED') {
        throw new BadRequestException(`A ${batch.status} batch has no result to import`);
      }

      const lines = await tem.find(
        PaymentBatchLine,
        { batch: batch.id },
        { ...FILTER_OFF, populate: ['document', 'whtTaxCode'] },
      );
      const byDocument = new Map(lines.map((l) => [l.document.id, l]));

      for (const reported of dto.lines) {
        const line = byDocument.get(reported.documentId);
        if (!line) {
          throw new BadRequestException(
            `The result names document ${reported.documentId}, which is not on this batch`,
          );
        }

        // Already paid — a re-uploaded file, most likely. The unique constraint on
        // payment.document_id is the authority; report it rather than crash or pay twice.
        if (await tem.findOne(Payment, { document: line.document.id }, FILTER_OFF)) {
          line.result = 'ALREADY_PAID';
          continue;
        }

        if (reported.result === 'FAILED') {
          line.result = 'FAILED';
          line.failReason = reported.failReason ?? 'Rejected by the bank';
          continue;
        }

        if (!reported.actualRate) {
          throw new BadRequestException(
            `Document ${line.document.docNo} was paid but carries no actual rate`,
          );
        }
        // One place computes FX and WHT — the single-document path — so a batched payment and a
        // manually recorded one can never disagree about the same rate.
        await this.payments.record(
          line.document.id,
          reported.actualRate,
          line.whtTaxCode?.id,
          tem,
        );
        const payment = await tem.findOneOrFail(Payment, { document: line.document.id }, FILTER_OFF);
        payment.batch = batch;
        // Which account the money left from, inherited from the run. Without it the payment lands
        // in the unattributed reconciliation read, which is where every batched payment used to go.
        payment.bankAccount = batch.bankAccount;
        line.actualRate = reported.actualRate;
        line.result = 'SUCCESS';
      }

      // PARTIAL is the honest state when the bank paid some and rejected others: the batch is done
      // being imported, but it did not deliver everything it promised.
      const settled = lines.every((l) => l.result === 'SUCCESS' || l.result === 'ALREADY_PAID');
      batch.status = settled ? 'COMPLETED' : 'PARTIAL';
      batch.importedAt = new Date();
      batch.updatedAt = new Date();
      await tem.flush();
    });

    return this.get(scoped.id);
  }

  /**
   * Turn the bank's result FILE into the same per-line outcomes `importResult` takes, then apply it.
   *
   * The file carries no exchange rate — banks report what they moved, not what we booked it at — so
   * finance supplies a rate per document; anything it omits falls back to the document's locked
   * rate, which is exactly right for a base-currency payment and makes the common case typing-free.
   *
   * Rows are matched on the reference WE emitted, not on account number and amount: those are
   * ambiguous the moment one vendor is paid twice for the same amount in a run, which is precisely
   * when a mismatch costs real money.
   */
  async importResultFile(
    id: string,
    content: string,
    ratesByDocument: Record<string, string> = {},
  ): Promise<{ batch: PaymentBatch; lines: PaymentBatchLine[] }> {
    const { batch, lines } = await this.get(id);
    const formatter = this.formatters.resolve(batch.format);
    if (!(formatter instanceof CsvBankFileFormatter)) {
      throw new BadRequestException(
        `Batch format '${batch.format}' cannot parse a result file`,
      );
    }
    const parsed = formatter.parseResult(content);
    const byReference = new Map(lines.map((l) => [l.id, l]));

    const importLines = parsed.map((row) => {
      const line = byReference.get(row.reference);
      // A reference we never issued means the file is not this batch's — refuse it whole rather
      // than apply the rows we happen to recognise.
      if (!line) {
        throw new BadRequestException(
          `The result file references '${row.reference}', which is not a line of this batch`,
        );
      }
      const documentId = line.document.id;
      return row.status === 'SUCCESS'
        ? {
            documentId,
            result: 'SUCCESS' as const,
            actualRate: ratesByDocument[documentId] ?? line.document.exchangeRate ?? '1',
          }
        : { documentId, result: 'FAILED' as const, failReason: row.reason };
    });

    return this.importResult(id, { lines: importLines });
  }

  /**
   * The line's withholding, on the same pre-VAT net base `PaymentService` uses — the two must agree
   * or the file and the recorded payment would disagree about what the vendor was paid.
   */
  private async computeWht(tem: EntityManager, line: PaymentBatchLine, dp: number): Promise<string> {
    if (!line.whtTaxCode) return '0';
    const code = await tem.findOne(TaxCode, { id: line.whtTaxCode.id }, FILTER_OFF);
    if (!code) throw new BadRequestException(`Tax code ${line.whtTaxCode.id} not found`);
    if (!code.isActive) throw new BadRequestException(`Tax code '${code.code}' is inactive`);
    if (code.kind !== TaxKind.WHT) {
      throw new BadRequestException(`Tax code '${code.code}' is not a WHT code`);
    }
    const doc = await tem.findOneOrFail(Document, { id: line.document.id }, FILTER_OFF);
    const netBase = Money.subtract(line.amount, doc.baseTaxTotal ?? '0');
    return TaxService.computeWht(netBase, code.rate, dp);
  }

  /**
   * The payee account a line was snapshot from, when it still exists and is active.
   *
   * Export uses this to refuse a run whose destination has since been closed: the approvers
   * approved a specific account, so silently paying a different one would defeat the whole control.
   */
  async resolveLiveAccount(line: PaymentBatchLine): Promise<VendorBankAccount | null> {
    const document = await this.em
      .fork()
      .findOne(Document, { id: line.document.id }, { ...FILTER_OFF, populate: ['vendorBankAccount'] });
    if (!document?.vendorBankAccount) return null;
    return this.em
      .fork()
      .findOne(VendorBankAccount, { id: document.vendorBankAccount.id }, FILTER_OFF);
  }
}
