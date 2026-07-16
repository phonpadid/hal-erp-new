import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { StorageService } from '../../common/storage/storage.service';
import { DocCategory, DocStatus, TaxKind } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { BudgetTxn } from '../budget/budget.entities';
import { Currency } from '../currency/currency.entities';
import { Document, DocumentType, FormTemplate } from '../document/document.entities';
import { Vendor, VendorBankAccount } from '../master-data/master-data.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { TaxCode } from '../tax/tax.entities';
import { Workflow } from '../approval/approval.entities';
import {
  BankFileFormatterRegistry,
  type BankFileFormatter,
  type BankFileRow,
} from './bank-file-formatter';
import { CsvBankFileFormatter } from './csv-bank-file.formatter';
import { PaymentBatchService } from './payment-batch.service';
import { PaymentHandoffService } from './payment-handoff.service';
import { PaymentService } from './payment.service';
import { Payment, PaymentBatch, PaymentBatchLine } from './payment.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

class StubFormatter implements BankFileFormatter {
  readonly format = 'STUB';
  readonly extension = 'txt';
  readonly contentType = 'text/plain';
  render(_batch: PaymentBatch, rows: BankFileRow[]): Buffer {
    return Buffer.from(rows.map((r) => `${r.accountNo}|${r.amount}`).join('\n'));
  }
}

/**
 * Importing the bank's result.
 *
 * The bank has already moved the money by the time this runs, so the job is to record what it did —
 * a rejected line is data, not a failure — and above all never to pay anything twice.
 */
describe.skipIf(!hasDb)('payment batch: result import (DB-backed)', () => {
  let orm: MikroORM;
  let batches: PaymentBatchService;

  const ids = {
    company: '', dept: '', user: '', wf: '', vendor: '', account: '',
    disbType: '', tmpl: '', whtCode: '',
  };
  let seq = 0;

  function asUser<T>(fn: () => Promise<T>): Promise<T> {
    return RequestContext.run(
      { userId: ids.user, companyId: ids.company, departmentId: ids.dept, grants: [] },
      fn,
    );
  }

  /** A settled disbursement of 100000 base, locked at rate 1. */
  async function payable(): Promise<string> {
    const em = orm.em.fork();
    const d = em.create(Document, {
      docNo: `P-${seq++}`,
      company: em.getReference(Company, ids.company),
      department: em.getReference(Department, ids.dept),
      documentType: em.getReference(DocumentType, ids.disbType),
      formTemplate: em.getReference(FormTemplate, ids.tmpl),
      workflow: em.getReference(Workflow, ids.wf),
      currentStepNo: 1,
      createdBy: em.getReference(AppUser, ids.user),
      vendor: em.getReference(Vendor, ids.vendor),
      vendorBankAccount: em.getReference(VendorBankAccount, ids.account),
      exchangeRate: '1',
      totalAmount: '100000.00',
      baseTotalAmount: '100000.00',
      baseTaxTotal: '0',
      status: DocStatus.COMPLETED,
      approvedAt: new Date(),
      createdAt: new Date(),
    });
    await em.flush();
    return d.id;
  }

  /** Build + export, so the batch is in the only state a result can land on. */
  async function exported(documentIds: string[], lines?: Array<{ documentId: string; whtTaxCodeId?: string }>) {
    const batch = await asUser(() => batches.build({ documentIds, format: 'STUB', lines }));
    await asUser(() => batches.export(batch.id));
    return batch;
  }

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();

    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const company = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true });
    const dept = em.create(Department, { company, deptCode: 'D', name: 'D', isActive: true });
    const user = em.create(AppUser, { username: 'fin', email: 'fin@x', status: 'ACTIVE' });
    const wf = em.create(Workflow, { company, name: 'WF', isActive: true });
    const vendor = em.create(Vendor, { vendorCode: 'V1', name: 'Acme', paymentTermDays: 30, isActive: true });
    const account = em.create(VendorBankAccount, { vendor, bankCode: 'BKK', accountNo: '0001', accountName: 'Acme Co', isPrimary: true, isActive: true });
    const disbType = em.create(DocumentType, { company, code: 'DISB', name: 'Disb', category: DocCategory.FINANCE, requiresBudget: false, requiresQuota: false, requiresVendor: true, requiresItem: false, requiresPayee: true, postAction: 'CUT_BUDGET', isActive: true });
    const tmpl = em.create(FormTemplate, { documentType: disbType, version: 1, status: 'PUBLISHED' });
    const whtCode = em.create(TaxCode, { company, code: 'WHT3', name: 'WHT 3%', kind: TaxKind.WHT, rate: '0.03', isActive: true });
    await em.flush();

    Object.assign(ids, {
      company: company.id, dept: dept.id, user: user.id, wf: wf.id,
      vendor: vendor.id, account: account.id,
      disbType: disbType.id, tmpl: tmpl.id, whtCode: whtCode.id,
    });

    const scope = new CompanyScopeService(orm.em);
    const handoff = new PaymentHandoffService(orm.em, scope);
    const storage = new StorageService();
    const objects = new Map<string, Buffer>();
    vi.spyOn(storage, 'putObject').mockImplementation(async (k, b) => void objects.set(k, b));
    vi.spyOn(storage, 'getObject').mockImplementation(async (k) => objects.get(k)!);
    batches = new PaymentBatchService(
      orm.em, scope, handoff,
      new BankFileFormatterRegistry([new StubFormatter(), new CsvBankFileFormatter()]),
      storage,
      new PaymentService(orm.em),
    );
  });

  beforeEach(async () => {
    const em = orm.em.fork();
    await em.nativeDelete(Payment, {}, FILTER_OFF);
    await em.nativeDelete(PaymentBatchLine, {}, FILTER_OFF);
    await em.nativeDelete(PaymentBatch, {}, FILTER_OFF);
    await em.nativeDelete(BudgetTxn, {}, FILTER_OFF);
    await em.nativeDelete(Document, {}, FILTER_OFF);
  });

  // ---- Outcomes --------------------------------------------------------------

  it('records a payment per paid line and completes the batch', async () => {
    const a = await payable();
    const b = await payable();
    const batch = await exported([a, b]);

    const { batch: after, lines } = await asUser(() =>
      batches.importResult(batch.id, {
        lines: [
          { documentId: a, result: 'SUCCESS', actualRate: '1' },
          { documentId: b, result: 'SUCCESS', actualRate: '1' },
        ],
      }),
    );

    expect(after.status).toBe('COMPLETED');
    expect(lines.every((l) => l.result === 'SUCCESS')).toBe(true);
    const payments = await orm.em.fork().find(Payment, {}, { ...FILTER_OFF, populate: ['batch'] });
    expect(payments).toHaveLength(2);
    // Every paid document traces back to the exact file it went out on.
    expect(payments.every((p) => p.batch?.id === batch.id)).toBe(true);
  });

  it('leaves a rejected line unpaid, records why, and marks the batch PARTIAL', async () => {
    const a = await payable();
    const b = await payable();
    const batch = await exported([a, b]);

    const { batch: after, lines } = await asUser(() =>
      batches.importResult(batch.id, {
        lines: [
          { documentId: a, result: 'SUCCESS', actualRate: '1' },
          { documentId: b, result: 'FAILED', failReason: 'Account closed' },
        ],
      }),
    );

    expect(after.status).toBe('PARTIAL');
    expect(lines.find((l) => l.document.id === b)!.failReason).toBe('Account closed');
    expect(await orm.em.fork().count(Payment, {}, FILTER_OFF)).toBe(1);
  });

  it('returns a rejected line’s document to the queue with no requeue logic', async () => {
    const a = await payable();
    const b = await payable();
    const batch = await exported([a, b]);
    await asUser(() =>
      batches.importResult(batch.id, {
        lines: [
          { documentId: a, result: 'SUCCESS', actualRate: '1' },
          { documentId: b, result: 'FAILED', failReason: 'Account closed' },
        ],
      }),
    );

    const handoff = new PaymentHandoffService(orm.em, new CompanyScopeService(orm.em));
    const queue = await asUser(() => handoff.readyToPay());

    // The batch is no longer open and b still has no payment — so it is payable again, for free.
    expect(queue.map((p) => p.documentId)).toEqual([b]);
  });

  // ---- Never pay twice -------------------------------------------------------

  it('treats a re-uploaded result as already paid rather than paying again', async () => {
    const a = await payable();
    const batch = await exported([a]);
    const result = { lines: [{ documentId: a, result: 'SUCCESS' as const, actualRate: '1' }] };
    await asUser(() => batches.importResult(batch.id, result));

    // A second import must not crash and must not double-pay.
    await orm.em.fork().nativeUpdate(PaymentBatch, { id: batch.id }, { status: 'EXPORTED' }, FILTER_OFF);
    const { lines } = await asUser(() => batches.importResult(batch.id, result));

    expect(lines[0].result).toBe('ALREADY_PAID');
    expect(await orm.em.fork().count(Payment, {}, FILTER_OFF)).toBe(1);
  });

  it('creates exactly one payment when two uploads race the same batch', async () => {
    const a = await payable();
    const batch = await exported([a]);
    const result = { lines: [{ documentId: a, result: 'SUCCESS' as const, actualRate: '1' }] };

    // The batch row is taken FOR UPDATE, so the second upload waits and then sees the payment.
    const outcomes = await Promise.allSettled([
      asUser(() => batches.importResult(batch.id, result)),
      asUser(() => batches.importResult(batch.id, result)),
    ]);

    expect(outcomes.some((o) => o.status === 'fulfilled')).toBe(true);
    expect(await orm.em.fork().count(Payment, {}, FILTER_OFF)).toBe(1);
  });

  // ---- Guards ----------------------------------------------------------------

  it('refuses a result for a batch that was never exported', async () => {
    const a = await payable();
    const batch = await asUser(() => batches.build({ documentIds: [a], format: 'STUB' }));

    await expect(
      asUser(() => batches.importResult(batch.id, { lines: [{ documentId: a, result: 'SUCCESS', actualRate: '1' }] })),
    ).rejects.toThrow(BadRequestException);
  });

  it('aborts the whole import when the result names a document not on the batch', async () => {
    const a = await payable();
    const stranger = await payable();
    const batch = await exported([a]);

    await expect(
      asUser(() =>
        batches.importResult(batch.id, {
          lines: [
            { documentId: a, result: 'SUCCESS', actualRate: '1' },
            { documentId: stranger, result: 'SUCCESS', actualRate: '1' },
          ],
        }),
      ),
    ).rejects.toThrow(BadRequestException);

    // A file we cannot trust must change nothing at all.
    expect(await orm.em.fork().count(Payment, {}, FILTER_OFF)).toBe(0);
    const fresh = await orm.em.fork().findOneOrFail(PaymentBatch, { id: batch.id }, FILTER_OFF);
    expect(fresh.status).toBe('EXPORTED');
  });

  it('refuses a paid line with no rate', async () => {
    const a = await payable();
    const batch = await exported([a]);

    await expect(
      asUser(() => batches.importResult(batch.id, { lines: [{ documentId: a, result: 'SUCCESS' }] })),
    ).rejects.toThrow(/no actual rate/);
  });

  // ---- FX and the budget -----------------------------------------------------

  it('records the FX delta exactly as the single-document path would', async () => {
    const a = await payable();
    const batch = await exported([a]);

    await asUser(() => batches.importResult(batch.id, { lines: [{ documentId: a, result: 'SUCCESS', actualRate: '1.05' }] }));

    const payment = await orm.em.fork().findOneOrFail(Payment, { document: a }, FILTER_OFF);
    // 100000 locked → 105000 actual: a 5000 loss, computed by the one place that computes it.
    expect(payment.baseActual).toBe('105000.00');
    expect(payment.fxDelta).toBe('5000.00');
    expect(payment.fxKind).toBe('LOSS');
  });

  it('writes no budget row at any actual rate', async () => {
    const a = await payable();
    const batch = await exported([a]);

    await asUser(() => batches.importResult(batch.id, { lines: [{ documentId: a, result: 'SUCCESS', actualRate: '1.05' }] }));

    // The budget was settled at the locked basis when the document completed. The FX delta goes to
    // accounting via payment.settled — never to the budget (invariant 6), or it would be charged
    // twice (invariant 3).
    expect(await orm.em.fork().count(BudgetTxn, {}, FILTER_OFF)).toBe(0);
  });

  it('carries the line’s withholding into the recorded payment', async () => {
    const a = await payable();
    const batch = await exported([a], [{ documentId: a, whtTaxCodeId: ids.whtCode }]);

    await asUser(() => batches.importResult(batch.id, { lines: [{ documentId: a, result: 'SUCCESS', actualRate: '1' }] }));

    const payment = await orm.em.fork().findOneOrFail(Payment, { document: a }, FILTER_OFF);
    // The file asked the bank for 97000; the payment must agree about why.
    expect(payment.whtAmount).toBe('3000.00');
  });

  // ---- The bank's result FILE, end to end -------------------------------------
  //
  // The layout is provisional, so what matters is that the export and the parser agree: a reference
  // we emit must come back and match, or every import silently fails to find its line.

  
  it('applies a CSV result the export itself produced', async () => {
    const a = await payable();
    const batch = await asUser(() => batches.build({ documentIds: [a], format: 'CSV' }));
    const { bytes } = await asUser(() => batches.export(batch.id));

    // Take the reference straight out of the file we just handed the bank.
    const reference = bytes.toString().trim().split('\r\n')[1].split(',')[5];
    const { batch: after, lines } = await asUser(() =>
      batches.importResultFile(batch.id, `reference,status,reason\r\n${reference},SUCCESS,\r\n`),
    );

    expect(after.status).toBe('COMPLETED');
    expect(lines[0].result).toBe('SUCCESS');
    expect(await orm.em.fork().count(Payment, {}, FILTER_OFF)).toBe(1);
  });

  it('defaults the rate to the document’s locked rate, so a base-currency run needs no typing', async () => {
    const a = await payable();
    const batch = await asUser(() => batches.build({ documentIds: [a], format: 'CSV' }));
    const { bytes } = await asUser(() => batches.export(batch.id));
    const reference = bytes.toString().trim().split('\r\n')[1].split(',')[5];

    await asUser(() => batches.importResultFile(batch.id, `reference,status\r\n${reference},SUCCESS\r\n`));

    const payment = await orm.em.fork().findOneOrFail(Payment, { document: a }, FILTER_OFF);
    expect(payment.actualRate).toBe('1.00000000');
    expect(payment.fxKind).toBe('NONE');
  });

  it('records a rejected line from the file', async () => {
    const a = await payable();
    const batch = await asUser(() => batches.build({ documentIds: [a], format: 'CSV' }));
    const { bytes } = await asUser(() => batches.export(batch.id));
    const reference = bytes.toString().trim().split('\r\n')[1].split(',')[5];

    const { batch: after, lines } = await asUser(() =>
      batches.importResultFile(batch.id, `reference,status,reason\r\n${reference},FAILED,Account closed\r\n`),
    );

    expect(after.status).toBe('PARTIAL');
    expect(lines[0].failReason).toBe('Account closed');
    expect(await orm.em.fork().count(Payment, {}, FILTER_OFF)).toBe(0);
  });

  it('refuses a file referencing a line of some other batch, changing nothing', async () => {
    const a = await payable();
    const batch = await asUser(() => batches.build({ documentIds: [a], format: 'CSV' }));
    await asUser(() => batches.export(batch.id));

    await expect(
      asUser(() => batches.importResultFile(batch.id, 'reference,status\r\nnot-ours,SUCCESS\r\n')),
    ).rejects.toThrow(/not a line of this batch/);

    // A file we cannot trust must not be partly applied.
    expect(await orm.em.fork().count(Payment, {}, FILTER_OFF)).toBe(0);
  });

  it('refuses an unreadable file', async () => {
    const a = await payable();
    const batch = await asUser(() => batches.build({ documentIds: [a], format: 'CSV' }));
    await asUser(() => batches.export(batch.id));

    await expect(asUser(() => batches.importResultFile(batch.id, 'this is not a csv'))).rejects.toThrow();
    expect(await orm.em.fork().count(Payment, {}, FILTER_OFF)).toBe(0);
  });
});
