import Decimal from 'decimal.js';
import { InternalServerErrorException } from '@nestjs/common';
import type { PrintTemplate } from '@erp/shared';
import type { DocumentPdfModel, SignatureBlock } from './document-pdf.service';
import { SIGNATURES_PER_ROW, signatureRows } from './signature-rows';

/**
 * The pre-printed business sheets — ໃບສະເໜີຈັດຊື້ (PR), ໃບສັ່ງຊື້ (PO) and ໃບເບີກຈ່າຍ (RECEIPT).
 *
 * These are the forms the business already files on paper: a header grid of label/value cells, a
 * purpose box, a line table, a totals block and a signature row — tables inside tables. pdfkit,
 * which renders the official letter, has no table primitive, so every rule and every cell would be
 * hand-placed arithmetic that has to be redone whenever a column moves. pdfmake takes the same
 * shapes as a declaration and runs on the same pdfkit engine and the same bundled Lao face, so the
 * two renderers agree about glyphs while only one of them has to think about geometry.
 *
 * The document definition is built separately from the bytes (`buildSheetDefinition` vs
 * `renderSheet`) for the same reason the model is built separately from the renderer: the rules
 * about what appears on a sheet are then testable without rendering a PDF.
 */

/** A cell the sheet leaves blank — a form is a shape to fill in, and an empty cell is a valid one. */
const BLANK = '';

/** Sizes and rules, in one place so a column moving does not mean hunting through the layout. */
const FONT_SIZE = 9;
const TITLE_SIZE = 18;
const BORDER = '#000000';
/** A4 at 72dpi and the page margin the sheets are laid out on — the canvas needs them in points. */
const PAGE_WIDTH = 595.28;
const PAGE_MARGIN = 40;
const COLUMN_GAP = 12;

/**
 * The rule every table on these sheets is drawn with: a single hairline in black, like the
 * pre-printed form. Declared once and spread onto each table so the sheets cannot drift into
 * looking like several unrelated grids.
 */
const GRID = {
  hLineWidth: () => 0.7,
  vLineWidth: () => 0.7,
  hLineColor: () => BORDER,
  vLineColor: () => BORDER,
  paddingTop: () => 4,
  paddingBottom: () => 4,
};

/**
 * Format a decimal string for printing at the currency's own precision.
 *
 * Takes and returns strings, and does its arithmetic with decimal.js: money never becomes a JS
 * number on the way to paper any more than it does on the way to the database. A null amount
 * prints blank rather than `0`, because a cell nobody filled in and a cell holding zero are
 * different statements on a form somebody signs.
 */
export function formatMoney(value: string | null | undefined, decimalPlaces: number): string {
  if (value == null || value === '') return BLANK;
  let fixed: string;
  try {
    fixed = new Decimal(value).toFixed(decimalPlaces);
  } catch {
    return BLANK; // unparseable amount → blank cell, never a crashed export
  }
  const negative = fixed.startsWith('-');
  const [whole, fraction] = (negative ? fixed.slice(1) : fixed).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = fraction ? `${grouped}.${fraction}` : grouped;
  return negative ? `-${body}` : body;
}

/** Quantities carry their own scale (15,4); trailing zeros are noise on a printed form. */
export function formatQty(value: string | null | undefined): string {
  if (value == null || value === '') return BLANK;
  try {
    return new Decimal(value).toDecimalPlaces(4).toString();
  } catch {
    return BLANK;
  }
}

/**
 * Whether these bytes are an image pdfkit can actually draw (PNG or JPEG, by magic bytes).
 *
 * A stamped signature is fetched from object storage, and storage can hand back something that is
 * not the image it was when it was stored — a truncated object, a file replaced by mistake. pdfkit
 * throws on those, which would turn one bad signature into a document that cannot be printed at
 * all. Checked here so the block renders empty instead, exactly as an unapproved step does.
 */
function isDrawableImage(bytes: Buffer): boolean {
  if (bytes.length < 4) return false;
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return isPng || isJpeg;
}

/** DD/MM/YYYY, the way every other date on these sheets is written. */
function formatDate(d: Date | null): string {
  if (!d) return BLANK;
  const [y, m, day] = d.toISOString().slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}

/** The bilingual heading each sheet carries, Lao first — the name people call the form by. */
const SHEET_TITLES: Record<Exclude<PrintTemplate, 'LETTER'>, string> = {
  PR: 'ໃບສະເໜີຈັດຊື້ - PURCHASE REQUEST',
  PO: 'ໃບສັ່ງຊື້ - PURCHASE ORDER',
  RECEIPT: 'ໃບເບີກຈ່າຍ - RECEIPT',
};

/** What the document-number cell of the header grid is labelled on each sheet. */
const DOC_NO_LABELS: Record<Exclude<PrintTemplate, 'LETTER'>, string> = {
  PR: 'PR No./ເລກທີ:',
  PO: 'PO No./ເລກທີ:',
  RECEIPT: 'No./ເລກທີ:',
};

/** A bold label cell of the header grid. */
const label = (text: string) => ({ text, bold: true, fontSize: FONT_SIZE });
/** A value cell — blank when the document does not carry the fact. */
const value = (text: string | null | undefined) => ({ text: text ?? BLANK, fontSize: FONT_SIZE });

/** A full-width box with a bold caption row and one free-text row beneath it (ຈຸດປະສົງ). */
function captionedBox(caption: string, body: string | null): unknown {
  return {
    table: {
      widths: ['*'],
      body: [[label(caption)], [value(body)]],
    },
    layout: GRID,
    margin: [0, 0, 0, 8],
  };
}

/** A two-column strip of label/value rows (budget topic + code, account numbers). */
function factRows(rows: Array<[string, string | null]>): unknown {
  return {
    table: {
      widths: [160, '*'],
      body: rows.map(([k, v]) => [label(k), value(v)]),
    },
    layout: GRID,
    margin: [0, 0, 0, 8],
  };
}

/**
 * The header grid: who is asking, from where, when, and under which number. Six columns of
 * alternating label/value, which is how the printed forms lay it out.
 */
function headerGrid(model: DocumentPdfModel, template: Exclude<PrintTemplate, 'LETTER'>): unknown {
  const p = model.proposer;
  return {
    table: {
      // The label columns are sized to their longest bilingual label, and the value columns share
      // what is left — a document number wrapping onto two lines is what a too-narrow value column
      // looks like.
      widths: [62, '*', 62, '*', 62, 118],
      body: [
        [
          label('Staff Name\nຊື່ພະນັກງານ:'),
          value(p.name),
          label('Position\nຕຳແໜ່ງ:'),
          value(p.position),
          label('Department\nພະແນກ:'),
          value(p.department ?? model.departmentName),
        ],
        [
          label('Request date\nວັນທີສະເໜີ:'),
          value(formatDate(model.createdAt)),
          label('Expected Date\nວັນທີ່ຕ້ອງການ:'),
          value(model.sheet.expectedDate),
          label(DOC_NO_LABELS[template]),
          value(model.docNo),
        ],
      ],
    },
    layout: GRID,
    margin: [0, 0, 0, 8],
  };
}

/** Supplier block — only the PO and receipt sheets carry it. */
function supplierBlock(model: DocumentPdfModel): unknown[] {
  const payee = model.sheet.payee;
  const bankInfo = payee
    ? `${payee.bank} - ${payee.accountNo} (${payee.accountName})`
    : null;
  return [
    {
      table: {
        widths: ['*'],
        body: [[label('Supplier Information/ຂໍ້ມູນຜູ້ສະໜອງ')]],
      },
      layout: GRID,
    },
    {
      table: {
        widths: [90, '*', 70, '*'],
        body: [
          [
            label('Shop Name\nຊື່ຮ້ານ:'),
            value(model.sheet.vendorName),
            label('Contact\nເບີໂທ:'),
            value(model.sheet.vendorContact),
          ],
          [label('Bank Info\nຂໍ້ມູນທະນາຄານ:'), { ...value(bankInfo), colSpan: 3 }, {}, {}],
        ],
      },
      layout: GRID,
      margin: [0, 0, 0, 8],
    },
  ];
}

/**
 * The line table. The receipt sheet trades the amount column for a remark column, matching the
 * printed form — `document_line` stores no remark today, so that column prints empty until it does.
 */
function lineTable(model: DocumentPdfModel, template: Exclude<PrintTemplate, 'LETTER'>): unknown {
  const dp = model.sheet.decimalPlaces;
  const lastHeader = template === 'RECEIPT' ? 'Remark/\nໝາຍເຫດ' : 'Total/ລວມ';
  const header = [
    label('No.'),
    label('Description/ລາຍລະອຽດ'),
    label('QTY/\nຈຳນວນ'),
    label('Unit/\nຫົວໜ່ວຍ'),
    label('Unit Price/\nລາຄາ'),
    label(lastHeader),
  ].map((c) => ({ ...c, alignment: 'center' }));

  const rows = model.lines.map((l) => [
    { ...value(String(l.lineNo)), alignment: 'center' },
    value(l.description),
    { ...value(formatQty(l.qty)), alignment: 'center' },
    { ...value(l.unit), alignment: 'center' },
    { ...value(formatMoney(l.unitPrice, dp)), alignment: 'right' },
    template === 'RECEIPT'
      ? value(BLANK)
      : { ...value(formatMoney(l.lineAmount, dp)), alignment: 'right' },
  ]);

  // A form with no lines still prints its table — an empty row keeps the grid a grid.
  if (!rows.length) rows.push([value(BLANK), value(BLANK), value(BLANK), value(BLANK), value(BLANK), value(BLANK)]);

  const totalRow = (caption: string, amount: string | null) => [
    { ...label(caption), colSpan: 5, alignment: 'right' },
    {},
    {},
    {},
    {},
    { ...label(formatMoney(amount, dp) + ` ${model.currency}`), alignment: 'right' },
  ];

  const totals =
    template === 'PR'
      ? [totalRow('TOTAL/ລວມທັງໝົດ:', model.grandTotal)]
      : [
          totalRow('SUB TOTAL/ລວມຍ່ອຍ:', model.sheet.subTotal ?? model.grandTotal),
          totalRow('VAT/ອາກອນ:', model.sheet.taxTotal ?? '0'),
          totalRow('TOTAL/ລວມທັງໝົດ:', model.grandTotal),
        ];

  return {
    table: {
      headerRows: 1,
      widths: [24, '*', 40, 44, 70, 80],
      body: [header, ...rows, ...totals],
    },
    layout: GRID,
    margin: [0, 0, 0, 16],
  };
}

/**
 * The signature row — the proposer first, then one column per step flagged
 * `show_signature_on_pdf` on the route the document actually ran, in step order, exactly as the
 * letter renders them. A block with no approval yet prints its heading over an empty space, which
 * is what an unsigned form looks like. The heading comes from the model (department · position
 * once signed; the step name while pending), so the sheets and the letter cannot disagree.
 */
function signatureRow(model: DocumentPdfModel): unknown {
  const blocks = [...(model.proposerBlock ? [model.proposerBlock] : []), ...model.signatureBlocks];
  if (!blocks.length) return { text: BLANK };
  // At most five columns to a row, every column the same FIXED width. Two things made the row run
  // off the page on a long route: pdfmake never shrinks a `*` column below its content's minimum —
  // a 120pt image, or a Lao title that has no space to wrap at — and a route of seven steps plus
  // the proposer is eight such columns. A fixed width holds the grid whatever the content wants,
  // and a second row lines up under the first.
  const perRow = Math.min(blocks.length, SIGNATURES_PER_ROW);
  const columnWidth = (PAGE_WIDTH - PAGE_MARGIN * 2 - COLUMN_GAP * (perRow - 1)) / perRow;
  const imageWidth = Math.min(120, columnWidth - 10);
  const column = (b: SignatureBlock) => {
    const stack: unknown[] = [
      { text: b.heading, alignment: 'center', bold: true, fontSize: FONT_SIZE },
    ];
    if (b.signatureImage && isDrawableImage(b.signatureImage)) {
      // pdfkit sniffs the image's own magic bytes, so the data URI's declared type does not have
      // to match — which matters, because the stamped signature may be PNG or JPEG.
      stack.push({
        image: `data:image/png;base64,${b.signatureImage.toString('base64')}`,
        fit: [imageWidth, 48],
        alignment: 'center',
        margin: [0, 6, 0, 6],
      });
    } else {
      // No signature on file: leave the space and rule people actually sign on. A printed form
      // with nothing where the signature belongs looks like a form that was never routed.
      stack.push({ text: ' ', fontSize: FONT_SIZE, margin: [0, 18, 0, 0] });
      stack.push({
        canvas: [
          {
            type: 'line',
            x1: columnWidth * 0.15,
            y1: 0,
            x2: columnWidth * 0.85,
            y2: 0,
            lineWidth: 0.7,
            lineColor: BORDER,
          },
        ],
        margin: [0, 0, 0, 4],
      });
    }
    stack.push({ text: b.approverName ?? BLANK, alignment: 'center', bold: true, fontSize: FONT_SIZE });
    stack.push({ text: formatDate(b.actedAt), alignment: 'center', fontSize: FONT_SIZE - 1, color: '#555555' });
    return { stack, width: columnWidth };
  };
  const rows = signatureRows(blocks).map((row) => ({
    columns: row.map(column),
    columnGap: COLUMN_GAP,
    margin: [0, 12, 0, 0],
  }));
  // One row is the row; several stack, and the stack must not split across a page break — half a
  // signature grid on each of two pages reads as two documents.
  return rows.length === 1 ? rows[0] : { stack: rows, unbreakable: true };
}

/**
 * The whole sheet, as a pdfmake document definition. Exported so tests can assert what a sheet
 * says without rendering bytes.
 *
 * A `LETTER` model must never reach here: the official letter is rendered by its own pdfkit
 * layout, which is evidence people have already signed and printed and which nothing here is
 * meant to change.
 */
export function buildSheetDefinition(model: DocumentPdfModel): Record<string, unknown> {
  // One definition draws one sheet: a model naming several is narrowed by the caller before it
  // gets here, so the first entry is always the sheet being drawn.
  const template = model.sheet.printTemplates[0];
  if (template === 'LETTER') {
    throw new InternalServerErrorException('The LETTER template is rendered by the letter layout');
  }

  const content: unknown[] = [
    { text: SHEET_TITLES[template], style: 'title' },
    { text: model.docNo, alignment: 'center', fontSize: 11, margin: [0, 0, 0, 14] },
    headerGrid(model, template),
    captionedBox('Purposes/ຈຸດປະສົງ:', model.sheet.purpose),
  ];

  if (template !== 'PR') content.push(...supplierBlock(model));

  // Budget identity: the PO and the receipt name the money they draw on; a PR does not yet.
  if (template !== 'PR') {
    const rows: Array<[string, string | null]> = [
      ['Budget Topic/ຫົວຂໍ້ງົບປະມານ:', model.sheet.budgetName],
      ['Budget Code/ລະຫັດເບີກງົບປະມານ:', model.sheet.budgetCode],
    ];
    if (template === 'RECEIPT') {
      rows.push(['Account Number/ເລກທີບັນຊີ:', model.sheet.glAccount]);
      rows.push([
        'Shop account/ບັນຊີຮ້ານຄ້າ:',
        model.sheet.payee ? `${model.sheet.payee.accountName} - ${model.sheet.payee.accountNo}` : null,
      ]);
      rows.push(['PO No./ເລກທີໃບສັ່ງຊື້:', model.sheet.refDocNo]);
    }
    content.push(factRows(rows));
  }

  content.push(lineTable(model, template));
  content.push(signatureRow(model));

  return {
    pageSize: 'A4',
    pageMargins: [PAGE_MARGIN, PAGE_MARGIN, PAGE_MARGIN, PAGE_MARGIN],
    defaultStyle: { font: 'lao', fontSize: FONT_SIZE },
    styles: { title: { fontSize: TITLE_SIZE, bold: true, alignment: 'center', margin: [0, 0, 0, 6] } },
    content,
  };
}

/**
 * Render an arbitrary pdfmake content block to PDF bytes on the bundled Lao face.
 *
 * Every page the export GENERATES — the attachment separator, a placeholder standing in for a file
 * that could not be printed, the footer stamp — comes through here rather than being drawn with
 * pdf-lib. pdf-lib places Lao vowels and tone marks by codepoint order, so `ເອກະສານຄັດຕິດ` comes
 * out visibly wrong; pdfmake runs on pdfkit, which shapes the script properly. The only text
 * pdf-lib is left to draw is none.
 */
export async function renderContent(
  content: unknown,
  fontPath: string,
  page: { width: number; height: number; margins: [number, number, number, number] },
): Promise<Buffer> {
  const PdfPrinter = await loadPdfMake();
  const printer = new PdfPrinter({
    lao: { normal: fontPath, bold: fontPath, italics: fontPath, bolditalics: fontPath },
  });
  const doc = printer.createPdfKitDocument({
    pageSize: { width: page.width, height: page.height },
    pageMargins: page.margins,
    defaultStyle: { font: 'lao', fontSize: FONT_SIZE },
    content,
  });
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/** Render a sheet to PDF bytes. `fontPath` is the bundled Lao face the letter also uses. */
export async function renderSheet(model: DocumentPdfModel, fontPath: string): Promise<Buffer> {
  const PdfPrinter = await loadPdfMake();
  // One face for all four weights: the bundled Noto Sans Lao ships Regular only, and pdfmake needs
  // every weight it might be asked for to resolve to something.
  const printer = new PdfPrinter({
    lao: { normal: fontPath, bold: fontPath, italics: fontPath, bolditalics: fontPath },
  });
  const doc = printer.createPdfKitDocument(buildSheetDefinition(model));
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/** pdfmake is loaded lazily, mirroring how the letter renderer treats pdfkit. */
async function loadPdfMake(): Promise<new (fonts: unknown) => any> {
  try {
    const pkg = 'pdfmake';
    const mod = (await import(pkg)) as any;
    return mod.default ?? mod;
  } catch {
    throw new InternalServerErrorException('PDF rendering is not configured (install pdfmake)');
  }
}
