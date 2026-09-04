import { InternalServerErrorException } from '@nestjs/common';
import { renderContent } from './document-sheet.renderer';

/**
 * Assembles the exported PDF: the rendered document sheets, followed by the evidence attached to
 * each document, in one file.
 *
 * Everything appended here comes from a user upload, so this module treats its input as hostile:
 * it copies pages rather than whole documents, strips the page-level constructs that can carry
 * behaviour, refuses what it cannot parse, and holds hard ceilings on how many pages one export
 * may grow to. A file it cannot print becomes a page that says so — an export that throws because
 * one attachment is malformed would deny people the document set over a file nobody needed.
 *
 * Evidence is packed rather than given a sheet each, and it carries no index page: a printed set
 * that spends a page naming files and another page per photo is mostly white paper. Each image is
 * captioned in place with the document number, the kind of evidence it is, and its file name.
 *
 * pdf-lib does the structural work here — copying pages, embedding images, overlaying a stamp —
 * and draws no text at all. It places Lao vowels and tone marks by codepoint order instead of
 * shaping them, so `ເອກະສານຄັດຕິດ` comes out visibly wrong. Every page and every strip of text
 * this file produces is rendered by pdfmake (on the pdfkit engine, which shapes the script
 * properly) and then placed as a page or as an overlay.
 */

/** Beyond this, one attachment is truncated: a 5,000-page PDF is not evidence, it is an accident. */
export const MAX_PAGES_PER_ATTACHMENT = 50;
/** Beyond this, the export stops appending. Everything is buffered, so this bounds the memory. */
export const MAX_PAGES_PER_EXPORT = 200;

/** A4 at 72dpi, the page every generated (non-merged) page is drawn on. */
const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 40;
/** The footer band a stamp is overlaid into, at the bottom-left of an appended page. */
const STAMP = { height: 12, size: 7, inset: 8 };
/**
 * How an evidence image is laid out on its page.
 *
 * A slip photographed on a phone is the thing the reader came for, so it gets the page: a narrow
 * margin, no caption band, and permission to be scaled UP to fill the sheet. What the file is and
 * which document it belongs to is already in the stamp at the foot — printing it twice, once at
 * 11pt across the top, spent a third of the page saying what the small print says.
 *
 * `maxUpscale` keeps a thumbnail from being blown up into a blur: past twice its own size an image
 * stops gaining anything by being bigger.
 */
const EVIDENCE = { margin: 18, maxUpscale: 2, perPage: 2, captionHeight: 12, captionSize: 7 };

/**
 * What a file is evidence OF. The two kinds are filed for different reasons and read by different
 * people — an attachment supports the request (a quotation, a specification), a slip proves the
 * money actually moved — so a printed set that pools them tells an auditor less than the screen
 * does. The kind decides which section of the separator names the file, and what its page stamp
 * says.
 */
export type EvidenceKind = 'ATTACHMENT' | 'SLIP';

/** One file to append behind a document's sheet. */
export interface EvidenceFile {
  kind: EvidenceKind;
  fileName: string;
  mimeType: string | null;
  fileSizeKb: number | null;
  uploadedBy: string | null;
  uploadedAt: Date | null;
  /** The bytes, or null when object storage could not hand them over. */
  bytes: Buffer | null;
}

type PdfLib = typeof import('pdf-lib');

function formatDate(d: Date | null): string {
  if (!d) return '-';
  const [y, m, day] = d.toISOString().slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}

/** How each kind is captioned, under every printed image and in every page stamp. */
const KIND_LABEL: Record<EvidenceKind, string> = {
  ATTACHMENT: 'ເອກະສານຄັດຕິດ / ATTACHMENT',
  SLIP: 'ຫຼັກຖານການໂອນເງິນ / PAYMENT EVIDENCE',
};

/** The one-line provenance shown under a file name: how big, from whom, and when. */
function provenance(file: EvidenceFile): string {
  const size = file.fileSizeKb != null ? `${file.fileSizeKb} KB` : '-';
  return `${size} · ${file.uploadedBy ?? '-'} · ${formatDate(file.uploadedAt)}`;
}

/** PNG or JPEG, by the file's own leading bytes — never by its recorded mime type. */
function imageKind(bytes: Buffer): 'png' | 'jpeg' | null {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  return null;
}

/** A PDF, by its own leading bytes. */
function isPdf(bytes: Buffer): boolean {
  return bytes.subarray(0, 5).toString('latin1') === '%PDF-';
}

export class DocumentExportAssembler {
  /** Stamp overlays already embedded, keyed by their text — a repeated stamp renders once. */
  private readonly stamps = new Map<string, unknown>();

  private constructor(
    private readonly lib: PdfLib,
    private readonly out: any,
    /** The bundled Lao face, handed to pdfmake for every generated page and stamp. */
    private readonly fontPath: string,
  ) {}

  static async open(fontPath: string): Promise<DocumentExportAssembler> {
    const lib = await loadPdfLib();
    const out = await lib.PDFDocument.create();
    return new DocumentExportAssembler(lib, out, fontPath);
  }

  /** Pages appended so far — the export ceiling is checked against this. */
  get pageCount(): number {
    return this.out.getPageCount();
  }

  private get remaining(): number {
    return MAX_PAGES_PER_EXPORT - this.pageCount;
  }

  /** Append every page of a PDF we produced ourselves (a sheet, a letter, a generated page). */
  async appendOwnPdf(bytes: Buffer): Promise<void> {
    const src = await this.lib.PDFDocument.load(bytes);
    const pages = await this.out.copyPages(src, src.getPageIndices().slice(0, this.remaining));
    pages.forEach((p: any) => this.out.addPage(p));
  }

  /**
   * Append one document's evidence, in the order given.
   *
   * Images are packed several to a page; a PDF keeps its own pages, because its own author chose
   * how they were laid out. Nothing here throws: a file that cannot be printed becomes a page
   * saying why, which is the only outcome that keeps the rest of the set printable.
   */
  async appendEvidence(docNo: string, files: EvidenceFile[]): Promise<void> {
    let pending: Array<{ file: EvidenceFile; kind: 'png' | 'jpeg' }> = [];
    const flush = async () => {
      while (pending.length) await this.drawImagePage(docNo, pending.splice(0, EVIDENCE.perPage));
    };

    for (const file of files) {
      if (!this.remaining) return;
      const kind = file.bytes?.length ? imageKind(file.bytes) : null;
      if (kind) {
        pending.push({ file, kind });
        if (pending.length === EVIDENCE.perPage) await flush();
        continue;
      }
      // Anything that is not an image interrupts the packing, so the printed order matches the
      // order the files were filed in.
      await flush();
      if (!file.bytes || !file.bytes.length) {
        await this.drawPlaceholder(docNo, file, 'ບໍ່ສາມາດອ່ານໄຟລ໌ໄດ້ / file could not be read from storage');
      } else if (isPdf(file.bytes)) {
        await this.appendAttachedPdf(docNo, file);
      } else {
        // Only reachable for a file stored before the allow-list narrowed to PDF/JPEG/PNG.
        await this.drawPlaceholder(docNo, file, 'ຊະນິດໄຟລ໌ພິມບໍ່ໄດ້ / this file type cannot be printed');
      }
    }
    await flush();
  }

  /** The assembled bytes. */
  async finish(): Promise<Buffer> {
    return Buffer.from(await this.out.save());
  }

  private async appendAttachedPdf(docNo: string, file: EvidenceFile): Promise<void> {
    let src: any;
    let total = 0;
    let copied: any[] = [];
    let take = 0;
    try {
      // Encrypted attachments are refused rather than force-opened: a file whose author locked it
      // is not evidence this export may quietly re-publish.
      //
      // Loading, counting and copying are all inside the same guard on purpose: a file can parse
      // far enough to load and still fail on its page tree — `%PDF-` followed by rubbish is a
      // real upload, not a hypothetical one — and a failure at any of those points means the same
      // thing to the reader, which is that this file could not be printed.
      src = await this.lib.PDFDocument.load(file.bytes!, { ignoreEncryption: false });
      total = src.getPageCount();
      take = Math.min(total, MAX_PAGES_PER_ATTACHMENT, this.remaining);
      if (take <= 0) return;
      copied = await this.out.copyPages(src, src.getPageIndices().slice(0, take));
    } catch {
      await this.drawPlaceholder(docNo, file, 'ໄຟລ໌ PDF ເສຍ ຫຼື ຖືກລັອກ / unreadable or password-protected PDF');
      return;
    }
    for (const [i, page] of copied.entries()) {
      this.stripActiveContent(page);
      this.out.addPage(page);
      await this.stamp(page, docNo, file, i + 1, total);
    }
    if (take < total && this.remaining > 0) {
      await this.drawPlaceholder(
        docNo,
        file,
        `ພິມພຽງ ${take}/${total} ໜ້າ / truncated at ${MAX_PAGES_PER_ATTACHMENT} pages`,
      );
    }
  }

  /**
   * One page holding up to `EVIDENCE.perPage` images, stacked and each captioned.
   *
   * Packed rather than one-per-sheet because most evidence is a phone photo of a slip: printed
   * alone on A4 it leaves half the paper white, and a set of six files became six sheets nobody
   * wanted. Each slot carries its own caption — the document number, the kind, and the file name —
   * so a page holding two files is still traceable file by file.
   *
   * The page turns to match a single wide picture: a landscape image on a portrait sheet spends a
   * third of the paper on margins. With two images the page stays portrait, because that is the
   * shape that stacks.
   */
  private async drawImagePage(
    docNo: string,
    slots: Array<{ file: EvidenceFile; kind: 'png' | 'jpeg' }>,
  ): Promise<void> {
    if (!this.remaining || !slots.length) return;

    const embedded: Array<{ file: EvidenceFile; image: any }> = [];
    for (const { file, kind } of slots) {
      try {
        embedded.push({
          file,
          image: kind === 'png' ? await this.out.embedPng(file.bytes!) : await this.out.embedJpg(file.bytes!),
        });
      } catch {
        await this.drawPlaceholder(docNo, file, 'ຮູບພາບເສຍ / the image could not be read');
      }
    }
    if (!embedded.length) return;

    const single = embedded.length === 1;
    const landscape = single && embedded[0].image.width > embedded[0].image.height;
    const pageW = landscape ? PAGE.height : PAGE.width;
    const pageH = landscape ? PAGE.width : PAGE.height;
    const page = this.out.addPage([pageW, pageH]);

    const usableH = pageH - EVIDENCE.margin * 2;
    const slotH = usableH / embedded.length;
    const maxW = pageW - EVIDENCE.margin * 2;
    const maxH = slotH - EVIDENCE.captionHeight;

    for (const [i, { file, image }] of embedded.entries()) {
      // Slots fill from the top of the page down, which is the order the files were filed in.
      // Each slot is a caption band along its bottom with the picture centred in what is left, so
      // the label never lies across the image it names.
      const slotBottom = pageH - EVIDENCE.margin - (i + 1) * slotH;
      const scale = Math.min(maxW / image.width, maxH / image.height, EVIDENCE.maxUpscale);
      const w = image.width * scale;
      const h = image.height * scale;
      page.drawImage(image, {
        x: (pageW - w) / 2,
        y: slotBottom + EVIDENCE.captionHeight + (maxH - h) / 2,
        width: w,
        height: h,
      });
      await this.captionSlot(page, docNo, file, slotBottom, pageW);
    }
  }

  /** The line under one image: which document it belongs to, what kind it is, and its file name. */
  private async captionSlot(
    page: any,
    docNo: string,
    file: EvidenceFile,
    y: number,
    pageW: number,
  ): Promise<void> {
    const text = `${docNo} · ${KIND_LABEL[file.kind]} · ${file.fileName}`;
    try {
      const strip: any = await this.stampStrip(
        [{ text, fontSize: EVIDENCE.captionSize, color: '#595959' }],
        `slot|${text}`,
      );
      const width = Math.min(strip.width, pageW - EVIDENCE.margin * 2);
      const height = (strip.height * width) / strip.width;
      page.drawPage(strip, { x: EVIDENCE.margin, y, width, height });
    } catch {
      /* a caption that will not render must not cost us the picture it was labelling */
    }
  }

  /** A page standing in for a file that could not be printed, naming it and the reason. */
  private async drawPlaceholder(docNo: string, file: EvidenceFile, reason: string): Promise<void> {
    if (!this.remaining) return;
    const page = await this.appendGenerated([
      // At the top of the page, not floated to the middle: this page carries three short lines,
      // and pushing them down the sheet does not make them easier to read.
      { text: file.fileName, fontSize: 12, bold: true, margin: [0, 0, 0, 6] },
      { text: reason, fontSize: 10 },
      { text: provenance(file), fontSize: 9, color: '#555555', margin: [0, 6, 0, 0] },
    ]);
    if (page) await this.stamp(page, docNo, file, 1, 1);
  }

  /** Render one A4 page of our own content with pdfmake and append it; returns the added page. */
  private async appendGenerated(content: unknown[]): Promise<any | null> {
    const before = this.pageCount;
    const bytes = await renderContent(content, this.fontPath, {
      width: PAGE.width,
      height: PAGE.height,
      margins: [MARGIN, MARGIN, MARGIN, MARGIN],
    });
    await this.appendOwnPdf(bytes);
    return this.pageCount > before ? this.out.getPage(before) : null;
  }

  /**
   * The footer every appended page carries. A printed set gets separated — pages are pulled out,
   * re-stapled, photocopied — and a stamp naming the document and the file is what lets a loose
   * page be put back where it belongs.
   */
  private async stamp(
    page: any,
    docNo: string,
    file: EvidenceFile,
    index: number,
    total: number,
  ): Promise<void> {
    try {
      const text = `${docNo} · ${KIND_LABEL[file.kind]} · ${file.fileName} (${index}/${total})`;
      const strip: any = await this.stampStrip(
        [{ text, fontSize: STAMP.size, color: '#595959' }],
        `stamp|${text}`,
      );
      // Attachment pages come in whatever size their author used, so the strip is scaled to fit
      // rather than assumed to be narrower than the page.
      const width = Math.min(strip.width, page.getWidth() - STAMP.inset * 2);
      const height = (strip.height * width) / strip.width;
      page.drawPage(strip, { x: STAMP.inset, y: STAMP.inset, width, height });
    } catch {
      /* a stamp that will not render must not cost us the page it was stamping */
    }
  }

  /** The embedded overlay for one stamp text, rendered once and reused. */
  private async stampStrip(content: unknown[], key: string, height = STAMP.height): Promise<unknown> {
    const cached = this.stamps.get(key);
    if (cached) return cached;
    const bytes = await renderContent(content, this.fontPath, {
      width: PAGE.width - MARGIN,
      height,
      margins: [0, 0, 0, 0],
    });
    const [embedded] = await this.out.embedPdf(bytes, [0]);
    this.stamps.set(key, embedded);
    return embedded;
  }

  /**
   * Remove what a copied page can carry besides its content: annotations (link and widget
   * annotations are where a PDF hides JavaScript and submit actions) and additional-actions
   * dictionaries. Document-level JavaScript, open actions and embedded files never travel here at
   * all — `copyPages` takes the page tree, not the source catalog.
   */
  private stripActiveContent(page: any): void {
    const { PDFName } = this.lib;
    for (const key of ['Annots', 'AA']) {
      try {
        page.node.delete(PDFName.of(key));
      } catch {
        /* a page that never had one is the normal case */
      }
    }
  }
}

async function loadPdfLib(): Promise<PdfLib> {
  try {
    const pkg = 'pdf-lib';
    return (await import(pkg)) as PdfLib;
  } catch {
    throw new InternalServerErrorException('PDF export is not configured (install pdf-lib)');
  }
}
