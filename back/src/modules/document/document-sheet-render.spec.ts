import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DocStatus } from '../../common/enums';
import type { DocumentPdfModel } from './document-pdf.service';
import {
  buildSheetDefinition,
  formatMoney,
  formatQty,
  renderSheet,
} from './document-sheet.renderer';

const FONT = join(__dirname, '..', '..', 'assets', 'fonts', 'NotoSansLao-Regular.ttf');

/** A model carrying nothing optional — the shape a sparsely-filled document produces. */
function bareModel(overrides: Partial<DocumentPdfModel> = {}): DocumentPdfModel {
  return {
    docNo: '1199/HR',
    status: DocStatus.COMPLETED,
    watermark: false,
    companyName: 'Hal Logistic',
    companyLogo: null,
    companyContact: { address: null, phone: null, email: null, website: null },
    departmentName: 'ບຸກຄະລາກອນ',
    documentTypeName: 'ໃບສະເໜີຈັດຊື້',
    subject: null,
    createdAt: new Date('2026-09-03T00:00:00.000Z'),
    proposer: { name: null, position: null, department: null },
    currency: 'LAK',
    grandTotal: null,
    fieldValues: [],
    lines: [],
    trail: [],
    proposerBlock: null,
    signatureBlocks: [],
    sheet: {
      printTemplates: ['PR'],
      expectedDate: null,
      purpose: null,
      vendorName: null,
      vendorContact: null,
      payee: null,
      budgetName: null,
      budgetCode: null,
      glAccount: null,
      refDocNo: null,
      subTotal: null,
      taxTotal: null,
      decimalPlaces: 0,
    },
    ...overrides,
  };
}

/** Every string anywhere in a pdfmake definition, so a test can ask what the sheet says. */
function textOf(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join('\n');
  if (typeof node === 'object') return Object.values(node as Record<string, unknown>).map(textOf).join('\n');
  return '';
}

describe('sheet renderer — amounts', () => {
  it('prints an amount to the currency’s own precision', () => {
    expect(formatMoney('11086000.00', 0)).toBe('11,086,000');
    expect(formatMoney('1234.5', 2)).toBe('1,234.50');
  });

  it('rounds rather than truncating, without going through a float', () => {
    expect(formatMoney('0.125', 2)).toBe('0.13');
    // The classic float case: 1.005 * 100 is 100.49999... in binary floating point.
    expect(formatMoney('1.005', 2)).toBe('1.01');
    expect(formatMoney('99999999999999.99', 2)).toBe('99,999,999,999,999.99');
  });

  it('leaves an absent amount blank rather than printing zero', () => {
    expect(formatMoney(null, 2)).toBe('');
    expect(formatMoney('', 2)).toBe('');
    // A cell nobody filled in and a cell holding zero say different things on a signed form.
    expect(formatMoney('0', 2)).toBe('0.00');
  });

  it('does not fail the export on an unparseable amount', () => {
    expect(formatMoney('not-a-number', 2)).toBe('');
    expect(formatQty('not-a-number')).toBe('');
  });

  it('drops the trailing zeros a quantity column does not need', () => {
    expect(formatQty('1.0000')).toBe('1');
    expect(formatQty('2.5000')).toBe('2.5');
  });
});

describe('sheet renderer — what each sheet says', () => {
  it('heads the PR sheet with its bilingual title and number', () => {
    const text = textOf(buildSheetDefinition(bareModel()));
    expect(text).toContain('ໃບສະເໜີຈັດຊື້ - PURCHASE REQUEST');
    expect(text).toContain('1199/HR');
    expect(text).toContain('PR No./ເລກທີ:');
  });

  it('gives the PR sheet one total, and the PO sheet a subtotal and tax', () => {
    const pr = textOf(buildSheetDefinition(bareModel({ grandTotal: '250' })));
    expect(pr).toContain('TOTAL/ລວມທັງໝົດ:');
    expect(pr).not.toContain('SUB TOTAL');

    const po = textOf(
      buildSheetDefinition(
        bareModel({
          grandTotal: '250',
          sheet: { ...bareModel().sheet, printTemplates: ['PO'], subTotal: '250', taxTotal: '0' },
        }),
      ),
    );
    expect(po).toContain('SUB TOTAL/ລວມຍ່ອຍ:');
    expect(po).toContain('VAT/ອາກອນ:');
  });

  it('shows the supplier and budget blocks on a PO, and neither on a PR', () => {
    const po = textOf(
      buildSheetDefinition(
        bareModel({
          sheet: {
            ...bareModel().sheet,
            printTemplates: ['PO'],
            vendorName: 'V_Rich',
            vendorContact: '02098685856',
            budgetName: 'ງົບການຕະຫຼາດ',
            budgetCode: 'BA-FB04C5',
            payee: { bank: 'LDB', accountNo: '0363100410002337', accountName: 'VANHVISA' },
          },
        }),
      ),
    );
    expect(po).toContain('Supplier Information/ຂໍ້ມູນຜູ້ສະໜອງ');
    expect(po).toContain('V_Rich');
    expect(po).toContain('BA-FB04C5');
    expect(po).toContain('LDB - 0363100410002337 (VANHVISA)');

    const pr = textOf(buildSheetDefinition(bareModel()));
    expect(pr).not.toContain('Supplier Information/ຂໍ້ມູນຜູ້ສະໜອງ');
    expect(pr).not.toContain('Budget Code/ລະຫັດເບີກງົບປະມານ:');
  });

  it('names the purchase order a receipt settles, and its account numbers', () => {
    const receipt = textOf(
      buildSheetDefinition(
        bareModel({
          sheet: {
            ...bareModel().sheet,
            printTemplates: ['RECEIPT'],
            refDocNo: '0009/DIT/DIT',
            glAccount: '612.06',
            payee: { bank: 'LDB', accountNo: '1651218657309', accountName: 'XONE SENGPHOSY' },
          },
        }),
      ),
    );
    expect(receipt).toContain('ໃບເບີກຈ່າຍ - RECEIPT');
    expect(receipt).toContain('0009/DIT/DIT');
    expect(receipt).toContain('612.06');
    expect(receipt).toContain('XONE SENGPHOSY - 1651218657309');
    // The receipt form's last column is a remark, not an amount.
    expect(receipt).toContain('Remark/\nໝາຍເຫດ');
  });

  it('prints a sparsely-filled document without inventing values', () => {
    const text = textOf(buildSheetDefinition(bareModel()));
    // No placeholder dashes, no zeros standing in for facts the document does not carry.
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('null');
  });

  it('marks a document that is not fully approved', () => {
    const draft = buildSheetDefinition(bareModel({ status: DocStatus.DRAFT, watermark: true }));
    expect((draft as any).watermark.text).toBe('DRAFT');
    expect(buildSheetDefinition(bareModel())).not.toHaveProperty('watermark');
  });

  it('refuses to draw a letter — that layout is the letter renderer’s', () => {
    expect(() =>
      buildSheetDefinition(bareModel({ sheet: { ...bareModel().sheet, printTemplates: ['LETTER'] } })),
    ).toThrow(/LETTER/);
  });

  it('lays out one signature column per flagged step, approved or not', () => {
    const def = buildSheetDefinition(
      bareModel({
        signatureBlocks: [
          {
            stepNo: 1,
            stepName: 'ສະເໜີໂດຍ',
            heading: 'ບັນຊີ · ຫົວໜ້າພະແນກ',
            approverName: 'ນາງ ໄຂ່ຟ້າ ວິຈິດ',
            actedAt: new Date('2026-09-03T00:00:00.000Z'),
            signatureImage: Buffer.from('fake-png'),
          },
          { stepNo: 2, stepName: 'ບຸກຄະລາກອນ', heading: 'ບຸກຄະລາກອນ', approverName: null, actedAt: null, signatureImage: null },
        ],
      }),
    );
    const row: any = (def.content as unknown[]).at(-1);
    expect(row.columns).toHaveLength(2);
    // The heading is what the model computed — who signed, as what — not the step's name.
    expect(textOf(row)).toContain('ບັນຊີ · ຫົວໜ້າພະແນກ');
    expect(textOf(row)).not.toContain('ສະເໜີໂດຍ');
    expect(textOf(row)).toContain('ບຸກຄະລາກອນ');
    // The unapproved column still exists — an unsigned form is a form with an empty signature.
    expect(textOf(row)).toContain('ນາງ ໄຂ່ຟ້າ ວິຈິດ');
  });

  it('lays a long route out as rows of five, every column the same width, kept together', () => {
    const block = (stepNo: number) => ({
      stepNo, stepName: null, heading: `ຂັ້ນທີ ${stepNo}`, approverName: null, actedAt: null, signatureImage: null,
    });
    const def = buildSheetDefinition(
      bareModel({
        proposerBlock: { ...block(0), heading: 'ຜູ້ສະເໜີ', approverName: 'ນາງ ໄຂ່ຟ້າ ວິຈິດ' },
        signatureBlocks: Array.from({ length: 9 }, (_, i) => block(i + 1)),
      }),
    );
    const grid: any = (def.content as unknown[]).at(-1);
    expect(grid.unbreakable).toBe(true);
    expect(grid.stack).toHaveLength(2);
    expect(grid.stack[0].columns).toHaveLength(5);
    expect(grid.stack[1].columns).toHaveLength(5);
    expect(textOf(grid.stack[0].columns[0])).toContain('ຜູ້ສະເໜີ');
    expect(textOf(grid.stack[1].columns[4])).toContain('ຂັ້ນທີ 9');
    // Fixed, equal widths: pdfmake would otherwise grow a column to its image or an unbreakable
    // Lao title and push the row off the page.
    const widths = [...grid.stack[0].columns, ...grid.stack[1].columns].map((c: any) => c.width);
    expect(new Set(widths).size).toBe(1);
    expect(typeof widths[0]).toBe('number');

    // Six blocks: a full row and a row of one, the lone column as wide as the others.
    const six: any = (def.content as unknown[]).length && (buildSheetDefinition(
      bareModel({ signatureBlocks: Array.from({ length: 6 }, (_, i) => block(i + 1)) }),
    ).content as unknown[]).at(-1);
    expect(six.stack[1].columns).toHaveLength(1);
    expect(six.stack[1].columns[0].width).toBe(six.stack[0].columns[0].width);
  });

  it('puts the proposer first in the signature row, and leaves a line when nothing was stamped', () => {
    const approver = {
      stepNo: 1,
      stepName: null,
      heading: 'ບັນຊີ · ຫົວໜ້າພະແນກ',
      approverName: 'ທ້າວ ບຸນມີ',
      actedAt: new Date('2026-09-04T00:00:00.000Z'),
      signatureImage: null,
    };
    const stamped = buildSheetDefinition(
      bareModel({
        proposerBlock: {
          stepNo: 0,
          stepName: 'ຜູ້ສະເໜີ',
          heading: 'ຜູ້ສະເໜີ',
          approverName: 'ນາງ ໄຂ່ຟ້າ ວິຈິດ',
          actedAt: new Date('2026-09-03T00:00:00.000Z'),
          // A PNG header: the renderer sniffs the bytes before it will draw them.
          signatureImage: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        },
        signatureBlocks: [approver],
      }),
    );
    const row: any = (stamped.content as unknown[]).at(-1);
    expect(row.columns).toHaveLength(2);
    expect(textOf(row.columns[0])).toContain('ຜູ້ສະເໜີ');
    expect(textOf(row.columns[0])).toContain('ນາງ ໄຂ່ຟ້າ ວິຈິດ');
    expect(JSON.stringify(row.columns[0])).toContain('data:image/png;base64');
    expect(textOf(row.columns[1])).toContain('ບັນຊີ · ຫົວໜ້າພະແນກ');

    // No stamp (API-key submit, or submitted before the stamp existed): name over a ruled line.
    const unstamped = buildSheetDefinition(
      bareModel({
        proposerBlock: {
          stepNo: 0,
          stepName: 'ຜູ້ສະເໜີ',
          heading: 'ຜູ້ສະເໜີ',
          approverName: 'ນາງ ໄຂ່ຟ້າ ວິຈິດ',
          actedAt: new Date('2026-09-03T00:00:00.000Z'),
          signatureImage: null,
        },
        signatureBlocks: [approver],
      }),
    );
    const col0: any = ((unstamped.content as unknown[]).at(-1) as any).columns[0];
    expect(JSON.stringify(col0)).not.toContain('data:image');
    expect(JSON.stringify(col0)).toContain('"type":"line"');
    expect(textOf(col0)).toContain('ນາງ ໄຂ່ຟ້າ ວິຈິດ');
  });
});

describe('sheet renderer — bytes', () => {
  it('renders a sheet whose stamped signature is not a readable image', async () => {
    // Storage can hand back something that is no longer the image it stored. One unreadable
    // signature must not be the reason a whole approved document cannot be printed.
    const bytes = await renderSheet(
      bareModel({
        signatureBlocks: [
          {
            stepNo: 1,
            stepName: 'ສະເໜີໂດຍ',
            heading: 'ສະເໜີໂດຍ',
            approverName: 'ນາງ ໄຂ່ຟ້າ ວິຈິດ',
            actedAt: new Date('2026-09-03T00:00:00.000Z'),
            signatureImage: Buffer.from('not-an-image'),
          },
        ],
      }),
      FONT,
    );
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('renders a PR sheet carrying Lao script to a PDF', async () => {
    const bytes = await renderSheet(
      bareModel({
        grandTotal: '11086000',
        proposer: { name: 'ນາງ ໄຂ່ຟ້າ ວິຈິດ', position: 'ຫົວໜ້າໜ່ວຍງານ', department: 'ບຸກຄະລາກອນ' },
        lines: [
          { lineNo: 1, description: 'ປະກັນສັງຄົມ', qty: '1', unit: 'ຄົນ', unitPrice: '11086000', lineAmount: '11086000' },
        ],
        sheet: { ...bareModel().sheet, purpose: 'ສະເໜີຂໍເບີກເງິນສົມທົບປະກັນສັງຄົມ' },
      }),
      FONT,
    );
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it('renders each of the three sheets', async () => {
    for (const printTemplate of ['PR', 'PO', 'RECEIPT'] as const) {
      const bytes = await renderSheet(
        bareModel({ sheet: { ...bareModel().sheet, printTemplates: [printTemplate] } }),
        FONT,
      );
      expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    }
  });
});
