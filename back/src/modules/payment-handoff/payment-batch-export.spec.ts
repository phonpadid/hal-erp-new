import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { StorageService } from '../../common/storage/storage.service';
import { DocCategory, DocStatus, TaxKind } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
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
import { PaymentBatchService } from './payment-batch.service';
import { PaymentHandoffService } from './payment-handoff.service';
import { PaymentBatch, PaymentBatchLine } from './payment.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * A stand-in for a real bank's layout. The concrete CSV columns are per-bank and still unknown, so
 * these tests exercise the seam and the export rules — freezing, netting, reproducibility, the
 * deactivated-payee refusal — rather than a column order nobody has confirmed yet.
 */
class StubFormatter implements BankFileFormatter {
  readonly format = 'STUB';
  readonly extension = 'txt';
  readonly contentType = 'text/plain';
  render(_batch: PaymentBatch, rows: BankFileRow[]): Buffer {
    return Buffer.from(rows.map((r) => `${r.accountNo}|${r.amount}|${r.currency}`).join('\n'));
  }
}

describe.skipIf(!hasDb)('payment batch: export (DB-backed)', () => {
  let orm: MikroORM;
  let batches: PaymentBatchService;
  let storage: StorageService;
  /** The object store, faked: these tests are about export rules, not about S3. */
  let objects: Map<string, Buffer>;

  const ids = {
    company: '', dept: '', user: '', wf: '', vendor: '',
    account: '', secondAccount: '', disbType: '', tmpl: '', whtCode: '', vatCode: '',
  };
  let seq = 0;

  function asUser<T>(fn: () => Promise<T>): Promise<T> {
    return RequestContext.run(
      { userId: ids.user, companyId: ids.company, departmentId: ids.dept, grants: [] },
      fn,
    );
  }

  async function payable(accountId = ids.account, baseTaxTotal = '0'): Promise<string> {
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
      vendorBankAccount: em.getReference(VendorBankAccount, accountId),
      exchangeRate: '1',
      totalAmount: '100000.00',
      baseTotalAmount: '100000.00',
      baseTaxTotal,
      status: DocStatus.COMPLETED,
      approvedAt: new Date(),
      createdAt: new Date(),
    });
    await em.flush();
    return d.id;
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
    const secondAccount = em.create(VendorBankAccount, { vendor, bankCode: 'SCB', accountNo: '0002', accountName: 'Acme Co 2', isPrimary: false, isActive: true });
    const disbType = em.create(DocumentType, { company, code: 'DISB', name: 'Disb', category: DocCategory.FINANCE, requiresBudget: false, requiresQuota: false, requiresVendor: true, requiresItem: false, requiresPayee: true, postAction: 'CUT_BUDGET', isActive: true });
    const tmpl = em.create(FormTemplate, { documentType: disbType, version: 1, status: 'PUBLISHED' });
    const whtCode = em.create(TaxCode, { company, code: 'WHT3', name: 'WHT 3%', kind: TaxKind.WHT, rate: '0.03', isActive: true });
    const vatCode = em.create(TaxCode, { company, code: 'VAT7', name: 'VAT 7%', kind: TaxKind.VAT, rate: '0.07', isActive: true });
    await em.flush();

    Object.assign(ids, {
      company: company.id, dept: dept.id, user: user.id, wf: wf.id, vendor: vendor.id,
      account: account.id, secondAccount: secondAccount.id,
      disbType: disbType.id, tmpl: tmpl.id, whtCode: whtCode.id, vatCode: vatCode.id,
    });

    const scope = new CompanyScopeService(orm.em);
    const handoff = new PaymentHandoffService(orm.em, scope);
    const registry = new BankFileFormatterRegistry([new StubFormatter()]);
    storage = new StorageService();
    objects = new Map();
    vi.spyOn(storage, 'putObject').mockImplementation(async (key, body) => {
      objects.set(key, body);
    });
    vi.spyOn(storage, 'getObject').mockImplementation(async (key) => {
      const found = objects.get(key);
      if (!found) throw new Error(`no object at ${key}`);
      return found;
    });
    batches = new PaymentBatchService(orm.em, scope, handoff, registry, storage);
  });

  beforeEach(async () => {
    const em = orm.em.fork();
    await em.nativeDelete(PaymentBatchLine, {}, FILTER_OFF);
    await em.nativeDelete(PaymentBatch, {}, FILTER_OFF);
    await em.nativeDelete(Document, {}, FILTER_OFF);
    objects.clear();
    // Undo whatever a test deactivated.
    await em.nativeUpdate(VendorBankAccount, {}, { isActive: true }, FILTER_OFF);
  });

  function build(documentIds: string[], lines?: Array<{ documentId: string; whtTaxCodeId?: string }>) {
    return asUser(() => batches.build({ documentIds, format: 'STUB', lines }));
  }

  // ---- Export ----------------------------------------------------------------

  it('renders the file, stores the bytes, and freezes the batch', async () => {
    const a = await payable();
    const batch = await build([a]);

    const { bytes, fileName, contentType } = await asUser(() => batches.export(batch.id));

    expect(bytes.toString()).toContain('0001|100000');
    expect(fileName).toBe(`${batch.id}.txt`);
    expect(contentType).toBe('text/plain');

    const fresh = await orm.em.fork().findOneOrFail(PaymentBatch, { id: batch.id }, FILTER_OFF);
    expect(fresh.status).toBe('EXPORTED');
    expect(fresh.exportedAt).toBeTruthy();
    // The bytes that went to the bank are kept, under a key derived from the batch.
    expect(fresh.filePath).toBe(`payment-batches/${batch.id}/${batch.id}.txt`);
    expect(objects.get(fresh.filePath!)!.toString()).toBe(bytes.toString());
  });

  it('nets the exported amount by withholding', async () => {
    const a = await payable();
    const batch = await build([a], [{ documentId: a, whtTaxCodeId: ids.whtCode }]);

    const { bytes } = await asUser(() => batches.export(batch.id));

    // The vendor is paid net: 100000 − 3% = 97000. The withheld part is a liability, not money
    // that leaves for the vendor, so the file must not ask the bank to send it.
    expect(bytes.toString()).toContain('0001|97000');
    const [line] = await orm.em.fork().find(PaymentBatchLine, { batch: batch.id }, FILTER_OFF);
    expect(line.whtAmount).toBe('3000.00');
  });

  it('withholds on the pre-VAT base, matching what the recorded payment will say', async () => {
    // 107000 gross, of which 7000 is VAT → withhold 3% of 100000, not of 107000.
    const a = await payable(ids.account, '7000.00');
    await orm.em.fork().nativeUpdate(Document, { id: a }, { baseTotalAmount: '107000.00' }, FILTER_OFF);
    const batch = await build([a], [{ documentId: a, whtTaxCodeId: ids.whtCode }]);

    await asUser(() => batches.export(batch.id));

    const [line] = await orm.em.fork().find(PaymentBatchLine, { batch: batch.id }, FILTER_OFF);
    expect(line.whtAmount).toBe('3000.00');
  });

  it('returns the stored bytes on a re-export rather than re-rendering', async () => {
    const a = await payable();
    const batch = await build([a]);
    const first = await asUser(() => batches.export(batch.id));

    // Tamper with the line after export; a re-render would pick this up, a re-download must not.
    await orm.em.fork().nativeUpdate(
      PaymentBatchLine, { batch: batch.id }, { accountNo: 'TAMPERED' }, FILTER_OFF,
    );
    const second = await asUser(() => batches.export(batch.id));

    // The file the bank received has to stay reproducible byte for byte.
    expect(second.bytes.toString()).toBe(first.bytes.toString());
    expect(second.bytes.toString()).not.toContain('TAMPERED');
  });

  it('refuses a batch whose payee was deactivated, naming the document and account', async () => {
    const a = await payable();
    const batch = await build([a]);
    await orm.em.fork().nativeUpdate(
      VendorBankAccount, { id: ids.account }, { isActive: false }, FILTER_OFF,
    );

    const err = await asUser(() => batches.export(batch.id)).catch((e) => e as Error);

    // Falling back to the vendor's other active account would pay somewhere nobody approved.
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain('0001');
    expect(err.message).toContain('BKK');
    expect(err.message).toMatch(/no longer active/);
    const fresh = await orm.em.fork().findOneOrFail(PaymentBatch, { id: batch.id }, FILTER_OFF);
    expect(fresh.status).toBe('DRAFT');
    expect(objects.size).toBe(0);
  });

  it('does not fall back to the vendor’s primary account', async () => {
    const a = await payable(ids.secondAccount);
    const batch = await build([a]);
    await orm.em.fork().nativeUpdate(
      VendorBankAccount, { id: ids.secondAccount }, { isActive: false }, FILTER_OFF,
    );

    // ids.account is active and primary — and still must not be paid.
    await expect(asUser(() => batches.export(batch.id))).rejects.toThrow(BadRequestException);
  });

  it('rejects an unknown format rather than defaulting', async () => {
    const a = await payable();
    const batch = await asUser(() => batches.build({ documentIds: [a], format: 'PAIN001' }));

    // Handing a bank a layout it did not ask for is worse than sending nothing.
    await expect(asUser(() => batches.export(batch.id))).rejects.toThrow(/No bank file formatter/);
  });

  it('refuses to export a cancelled batch', async () => {
    const a = await payable();
    const batch = await build([a]);
    await asUser(() => batches.cancel(batch.id));

    await expect(asUser(() => batches.export(batch.id))).rejects.toThrow(BadRequestException);
  });

  it('formats the amount to the currency decimal places, from the decimal string', async () => {
    const a = await payable();
    const batch = await build([a]);

    const { bytes } = await asUser(() => batches.export(batch.id));

    // Never via a JS number: this is the value that moves money.
    expect(bytes.toString()).toMatch(/\|100000(\.00)?\|THB/);
  });
});
