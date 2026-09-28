import { join } from 'node:path';
import { LAO_FONT_FILE } from './document-pdf.service';
import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { DocStatus } from '../../common/enums';
import type { DocumentPdfModel } from './document-pdf.service';
import {
  DocumentExportAssembler,
  MAX_PAGES_PER_ATTACHMENT,
  type EvidenceFile,
} from './document-export.assembler';
import { renderSheet } from './document-sheet.renderer';

const FONT = join(__dirname, '..', '..', 'assets', 'fonts', LAO_FONT_FILE);

function model(): DocumentPdfModel {
  return {
    docNo: '0002/DIT/DIT',
    status: DocStatus.COMPLETED,
    companyName: 'Hal Logistic',
    companyLogo: null,
    companyContact: { address: null, phone: null, email: null, website: null },
    departmentName: 'ພະແນກພັດທະນາເທັກໂນໂລຊີ',
    documentTypeName: 'ໃບເບີກຈ່າຍ',
    subject: null,
    references: [],
    createdAt: new Date('2026-04-20T00:00:00.000Z'),
    proposer: { name: 'ນາງ ລັດຕະນາ ດາວງາມ', position: null, department: null },
    currency: 'LAK',
    grandTotal: '2664000',
    fieldValues: [],
    lines: [],
    trail: [],
    proposerBlock: null,
    signatureBlocks: [],
    sheet: {
      printTemplates: ['RECEIPT'],
      expectedDate: null, purpose: null, vendorName: null, vendorContact: null, payee: null,
      budgetName: null, budgetCode: null, glAccount: null, refDocNo: null,
      subTotal: null, taxTotal: null, decimalPlaces: 0,
    },
  };
}

function evidence(over: Partial<EvidenceFile> = {}): EvidenceFile {
  return {
    kind: 'ATTACHMENT',
    fileName: 'ສະລິບໂອນ.jpg',
    mimeType: 'image/jpeg',
    fileSizeKb: 12,
    uploadedBy: 'finance',
    uploadedAt: new Date('2026-04-21T00:00:00.000Z'),
    bytes: null,
    ...over,
  };
}

/** A real PNG (1x1) — the smallest thing pdf-lib will actually embed. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** An n-page PDF, standing in for an attached quotation or a scanned invoice. */
async function pdfOf(pages: number, decorate?: (doc: PDFDocument) => void): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]);
  decorate?.(doc);
  return Buffer.from(await doc.save());
}

async function pageCount(bytes: Buffer): Promise<number> {
  return (await PDFDocument.load(bytes)).getPageCount();
}

describe('export assembler', () => {
  it('puts the sheet first and the evidence behind it', async () => {
    const a = await DocumentExportAssembler.open(FONT);
    await a.appendOwnPdf(await renderSheet(model(), FONT));
    await a.appendEvidence('0002/DIT/DIT', [evidence({ bytes: PNG_1X1 })]);

    // Sheet + the image page — and no index page: each image is captioned where it is printed.
    expect(await pageCount(await a.finish())).toBe(2);
  });

  it('packs several images onto one page instead of a sheet each', async () => {
    // A phone photo printed alone on A4 leaves half the paper white; a set of six files became six
    // sheets nobody wanted.
    const a = await DocumentExportAssembler.open(FONT);
    await a.appendEvidence('D-1', [
      evidence({ kind: 'ATTACHMENT', fileName: 'quote.png', bytes: PNG_1X1 }),
      evidence({ kind: 'SLIP', fileName: 'slip.png', bytes: PNG_1X1 }),
    ]);
    expect(await pageCount(await a.finish())).toBe(1);
  });

  it('keeps the filed order when a PDF sits between two images', async () => {
    // A PDF keeps its own pages — its author chose that layout — so it interrupts the packing
    // rather than letting the images either side share a page across it.
    const a = await DocumentExportAssembler.open(FONT);
    await a.appendEvidence('D-1', [
      evidence({ fileName: 'a.png', bytes: PNG_1X1 }),
      evidence({ fileName: 'mid.pdf', bytes: await pdfOf(1) }),
      evidence({ fileName: 'b.png', bytes: PNG_1X1 }),
    ]);
    expect(await pageCount(await a.finish())).toBe(3);
  });

  it('merges an attached PDF page for page', async () => {
    const a = await DocumentExportAssembler.open(FONT);
    await a.appendEvidence('D-1', [evidence({ fileName: 'quote.pdf', bytes: await pdfOf(3) })]);
    expect(await pageCount(await a.finish())).toBe(3);
  });

  it('turns an unreadable attachment into one page that says so', async () => {
    const a = await DocumentExportAssembler.open(FONT);
    await a.appendEvidence('D-1', [evidence({ fileName: 'broken.pdf', bytes: Buffer.from('%PDF-1.7 truncated') })]);
    const out = await a.finish();
    // The export still succeeds, with a page standing in for the file.
    expect(await pageCount(out)).toBe(1);
  });

  it('stands in for a file object storage could not hand over', async () => {
    const a = await DocumentExportAssembler.open(FONT);
    await a.appendEvidence('D-1', [evidence({ bytes: null })]);
    expect(await pageCount(await a.finish())).toBe(1);
  });

  it('stands in for a file type it cannot print', async () => {
    // Only reachable for files stored before the upload allow-list narrowed.
    const a = await DocumentExportAssembler.open(FONT);
    await a.appendEvidence('D-1', [evidence({ fileName: 'notes.md', mimeType: 'text/markdown', bytes: Buffer.from('# hi') })]);
    expect(await pageCount(await a.finish())).toBe(1);
  });

  it('decides by the bytes, not by the recorded mime type', async () => {
    const a = await DocumentExportAssembler.open(FONT);
    // A PDF recorded as a JPEG still merges as the three-page PDF it actually is.
    await a.appendEvidence('D-1', [evidence({ fileName: 'slip.jpg', mimeType: 'image/jpeg', bytes: await pdfOf(3) })]);
    expect(await pageCount(await a.finish())).toBe(3);
  });

  it('does not carry an attachment’s active content into the export', async () => {
    const withJs = await pdfOf(1, (doc) => {
      const page = doc.getPage(0);
      // A link annotation carrying a JavaScript action — the shape a hostile PDF uses.
      const action = doc.context.obj({ S: PDFName.of('JavaScript'), JS: 'app.alert(1)' });
      const annot = doc.context.obj({
        Type: PDFName.of('Annot'), Subtype: PDFName.of('Link'),
        Rect: [0, 0, 10, 10], A: action,
      });
      page.node.set(PDFName.of('Annots'), doc.context.obj([annot]));
      page.node.set(PDFName.of('AA'), doc.context.obj({}));
    });
    expect(await pageCount(withJs)).toBe(1); // sanity: the fixture is readable

    const a = await DocumentExportAssembler.open(FONT);
    await a.appendEvidence('D-1', [evidence({ fileName: 'hostile.pdf', bytes: withJs })]);
    const out = await PDFDocument.load(await a.finish());
    const page = out.getPage(0);
    // pdf-lib re-creates an (empty) Annots array on a copied page; what matters is that no
    // annotation — and so no action attached to one — came along with it.
    const annots: any = page.node.get(PDFName.of('Annots'));
    expect(annots?.size?.() ?? 0).toBe(0);
    expect(page.node.get(PDFName.of('AA'))).toBeUndefined();
    // Nor did the JavaScript itself survive anywhere in the output.
    expect((await a.finish()).toString('latin1')).not.toContain('app.alert');
  });

  it('captions each image where it is printed, rather than indexing them on their own page', async () => {
    // The two kinds are filed for different reasons: one supports the request, the other proves
    // the money moved. Each caption says which, next to the picture it names.
    const a = await DocumentExportAssembler.open(FONT);
    await a.appendEvidence('D-1', [
      evidence({ kind: 'ATTACHMENT', fileName: 'quote.png', bytes: PNG_1X1 }),
      evidence({ kind: 'SLIP', fileName: 'bank-slip.png', bytes: PNG_1X1 }),
    ]);
    // One page for both, and no index page ahead of them.
    expect(await pageCount(await a.finish())).toBe(1);
  });

  it('truncates an attachment that is longer than a printed set can carry', async () => {
    const a = await DocumentExportAssembler.open(FONT);
    await a.appendEvidence('D-1', [
      evidence({ fileName: 'huge.pdf', bytes: await pdfOf(MAX_PAGES_PER_ATTACHMENT + 5) }),
    ]);
    // Capped pages, plus one page saying it was truncated.
    expect(await pageCount(await a.finish())).toBe(MAX_PAGES_PER_ATTACHMENT + 1);
  });
});
