import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ApproveAction, DocStatus } from '../../common/enums';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { StorageService } from '../../common/storage/storage.service';
import { ApprovalLog, WorkflowStep } from '../approval/approval.entities';
import { Department } from '../multi-company/multi-company.entities';
import { AppUser, Employee, UserSignature } from '../rbac/rbac.entities';
import { DocFieldValue, Document, DocumentLine, FormField } from './document.entities';

const FILTER_OFF = { filters: { company: false } } as const;

// Bundled Lao Unicode face (SIL OFL), copied into dist by nest-cli assets. Resolved relative
// to this compiled module so both dev (src) and prod (dist) runs find it (see design D4).
const LAO_FONT_FILE = 'NotoSansLao-Regular.ttf';

// Fixed Lao national header block — constant, independent of document content (spec: Lao
// National Header Block). Regular hyphens keep the separator inside the font's Latin coverage.
const LAO_STATE_NAME = 'ສາທາລະນະລັດ ປະຊາທິປະໄຕ ປະຊາຊົນລາວ';
const LAO_MOTTO = 'ສັນຕິພາບ ເອກະລາດ ປະຊາທິປະໄຕ ເອກະພາບ ວັດທະນະຖາວອນ';
const LAO_SEPARATOR = '---000---';

/** Format a date as DD/MM/YYYY from its ISO date part (tz-stable, no locale dependency). */
function formatDate(d: Date): string {
  const [y, m, day] = d.toISOString().slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}

/** One signature slot on the PDF — always tied to a step flagged `show_signature_on_pdf`. */
export interface SignatureBlock {
  stepNo: number;
  stepName: string | null;
  /** Null until the step has an APPROVE entry (export of an in-progress document). */
  approverName: string | null;
  actedAt: Date | null;
  /** The stamped signature image bytes, or null (no signature on file / not yet approved). */
  signatureImage: Buffer | null;
}

/** Structured, renderer-agnostic model of a document PDF (see design D4). */
export interface DocumentPdfModel {
  docNo: string;
  status: DocStatus;
  /** True when the document is not COMPLETED — the renderer stamps a "DRAFT" watermark. */
  watermark: boolean;
  companyName: string;
  /** The issuing company's logo bytes (from company.profile_image_path), or null on miss. */
  companyLogo: Buffer | null;
  departmentName: string;
  documentTypeName: string;
  /** The document's created_at, shown as ວັນທີ; null when unset. */
  createdAt: Date | null;
  /** Proposer identity for the ຂ້າພະເຈົ້າ line — blank fields when unresolved. */
  proposer: { name: string | null; position: string | null; department: string | null };
  currency: string;
  grandTotal: string | null;
  fieldValues: Array<{ label: string; value: string | null }>;
  lines: Array<{ lineNo: number; description: string; qty: string; unitPrice: string; lineAmount: string }>;
  /** Every recorded action (approve/reject/return/delegate), for the audit trail section. */
  trail: Array<{ action: ApproveAction; actorName: string; actedAt: Date | null }>;
  /** One block per flagged step, in step_no order — count is always <= the workflow's steps. */
  signatureBlocks: SignatureBlock[];
}

/**
 * Builds and renders a document PDF with its approval trail and per-step signatures
 * (document-pdf-export). The signature shown for a step is the one stamped on its APPROVE
 * `approval_log` row (locked at approval time), fetched server-side from object storage —
 * never the approver's later current signature. Only steps flagged `show_signature_on_pdf`
 * get a block. The model builder is separated from the renderer so the pdfkit dependency
 * stays optional and swappable, and the rules are unit-testable without rendering bytes.
 */
@Injectable()
export class DocumentPdfService {
  constructor(
    private readonly em: EntityManager,
    private readonly scope: CompanyScopeService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Assemble the PDF model for a document. Resolved within the active-company scope, so a
   * cross-company id is a not-found (company isolation) — a caller can only export a document
   * they may read.
   */
  async buildModel(id: string): Promise<DocumentPdfModel> {
    const scoped = this.scope.forActiveCompany();
    const document = await scoped.findOne(
      Document,
      { id },
      { populate: ['documentType', 'company', 'department', 'currency'] },
    );
    if (!document) throw new NotFoundException(`Document ${id} not found`);

    const em = this.em.fork();
    // Field values in template order.
    const values = await em.find(DocFieldValue, { document: id }, FILTER_OFF);
    const fields = await em.find(FormField, { formTemplate: document.formTemplate.id }, FILTER_OFF);
    // Sort in JS, not via the query's orderBy: a preceding find on DocFieldValue (which
    // references FormField) causes MikroORM to drop the FormField orderBy in the same fork, so
    // relying on it silently returns insertion order. An explicit sort is order-independent.
    fields.sort((a, b) => a.sortOrder - b.sortOrder);
    const valueByFieldId = new Map(values.map((v) => [v.formField.id, v.fieldValue]));
    // Letter body in form_field.sort_order; only fields with a recorded, non-empty value.
    const fieldValues = fields
      .map((f) => ({ label: f.fieldLabel, value: valueByFieldId.get(f.id) ?? null }))
      .filter((fv) => fv.value != null && fv.value !== '');

    const lines = await em.find(DocumentLine, { document: id }, { orderBy: { lineNo: 'ASC' }, ...FILTER_OFF });

    // Approval trail + the steps that opt into a PDF signature block. Resolve the approver
    // and signature relations by id (not populate) — a populated ManyToOne here can come back
    // as an unloaded stub with undefined fields (see the batch-by-id pattern used elsewhere).
    const logs = await em.find(
      ApprovalLog,
      { document: id },
      { orderBy: { stepNo: 'ASC', actedAt: 'ASC' }, ...FILTER_OFF },
    );
    const steps = await em.find(
      WorkflowStep,
      { workflow: document.workflow.id },
      { orderBy: { stepNo: 'ASC' }, ...FILTER_OFF },
    );

    const approverIds = [...new Set(logs.map((l) => l.approver.id))];
    const signatureIds = [...new Set(logs.map((l) => l.signature?.id).filter((v): v is string => !!v))];
    const approvers = approverIds.length ? await em.find(AppUser, { id: { $in: approverIds } }) : [];
    const signatures = signatureIds.length
      ? await em.find(UserSignature, { id: { $in: signatureIds } }, FILTER_OFF)
      : [];
    const employees = approverIds.length
      ? await em.find(Employee, { user: { $in: approverIds }, company: document.company.id }, FILTER_OFF)
      : [];
    const userById = new Map(approvers.map((u) => [u.id, u] as const));
    const sigById = new Map(signatures.map((s) => [s.id, s] as const));
    const nameByUserId = new Map(employees.filter((e) => e.user).map((e) => [e.user!.id, e.fullName] as const));
    // Employee full name in this company, else the account username.
    const nameOf = (userId: string) => nameByUserId.get(userId) ?? userById.get(userId)?.username ?? userId;

    // The first APPROVE per step drives its signature block.
    const approveByStep = new Map<number, ApprovalLog>();
    for (const log of logs) {
      if (log.action === ApproveAction.APPROVE && !approveByStep.has(log.stepNo)) {
        approveByStep.set(log.stepNo, log);
      }
    }

    const signatureBlocks: SignatureBlock[] = [];
    for (const step of steps) {
      if (!step.showSignatureOnPdf) continue; // flagged off → no block (count stays <= steps)
      const approve = approveByStep.get(step.stepNo);
      const sig = approve?.signature?.id ? sigById.get(approve.signature.id) : undefined;
      signatureBlocks.push({
        stepNo: step.stepNo,
        stepName: step.stepName ?? null,
        approverName: approve ? nameOf(approve.approver.id) : null,
        actedAt: approve?.actedAt ?? null,
        signatureImage: sig ? await this.loadImage(sig.filePath) : null,
      });
    }

    // Issuing company's logo — bytes from its own profile image, degrading to null on miss so
    // the export still succeeds. Sourced only from the document's own company (no cross-company).
    const companyLogo = document.company.profileImagePath
      ? await this.loadImage(document.company.profileImagePath)
      : null;

    // Proposer — prefer the document's related employee, else the creator's employee in this
    // company. Resolved by explicit findOne, not lazy populate (populate can hand back an
    // unloaded stub — see documenttype-populate-unloaded-ref); scoped to the document's company.
    const relatedEmployeeId = document.relatedEmployee?.id ?? null;
    const proposerEmp = relatedEmployeeId
      ? await em.findOne(Employee, { id: relatedEmployeeId, company: document.company.id }, FILTER_OFF)
      : await em.findOne(Employee, { user: document.createdBy.id, company: document.company.id }, FILTER_OFF);
    const proposerDept = proposerEmp?.department?.id
      ? await em.findOne(Department, { id: proposerEmp.department.id }, FILTER_OFF)
      : null;
    const proposer = {
      name: proposerEmp?.fullName ?? null,
      position: proposerEmp?.position ?? null,
      department: proposerDept?.name ?? null,
    };

    return {
      docNo: document.docNo,
      status: document.status,
      watermark: document.status !== DocStatus.COMPLETED,
      companyName: document.company.nameTh,
      companyLogo,
      departmentName: document.department.name,
      documentTypeName: document.documentType.name,
      createdAt: document.createdAt ?? null,
      proposer,
      currency: document.currency?.code ?? 'THB',
      grandTotal: document.grandTotal ?? document.totalAmount ?? null,
      fieldValues,
      lines: lines.map((l) => ({
        lineNo: l.lineNo,
        description: l.description,
        qty: l.qty,
        unitPrice: l.unitPrice,
        lineAmount: l.lineAmount,
      })),
      trail: logs.map((l) => ({
        action: l.action,
        actorName: nameOf(l.approver.id),
        actedAt: l.actedAt ?? null,
      })),
      signatureBlocks,
    };
  }

  /** Render the document to PDF bytes. Throws a clear error if the pdfkit dep is absent. */
  async render(id: string): Promise<Buffer> {
    const model = await this.buildModel(id);
    return this.toPdf(model);
  }

  /** Fetch a stamped signature image; a storage miss degrades to a placeholder, not a failure. */
  private async loadImage(filePath: string): Promise<Buffer | null> {
    try {
      return await this.storage.getObject(filePath);
    } catch {
      return null;
    }
  }

  /**
   * Render the Lao official-letter layout (ໃບສະເໜີ): national header, company logo + name with
   * ເລກທີ/ວັນທີ, centred title, proposer line, the configured form body, and a columnar
   * signature footer, with the DRAFT overlay for non-COMPLETED documents (design D5). pdfkit is
   * loaded lazily (optional dependency) and the bundled Lao font is registered as the default face.
   */
  private async toPdf(model: DocumentPdfModel): Promise<Buffer> {
    const PDFDocument = await this.loadPdfKit();
    const fontPath = this.laoFontPath();
    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 56 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Embed the Lao Unicode face and set it as default so Lao/Thai render as real glyphs.
      doc.registerFont('lao', fontPath);
      doc.font('lao').fillColor('black');

      const left = doc.page.margins.left;
      const right = doc.page.width - doc.page.margins.right;
      const contentWidth = right - left;

      // (1) Lao national header block — constant, centred.
      doc.fontSize(13).text(LAO_STATE_NAME, left, doc.y, { width: contentWidth, align: 'center' });
      doc.fontSize(11).text(LAO_MOTTO, left, doc.y, { width: contentWidth, align: 'center' });
      doc.text(LAO_SEPARATOR, left, doc.y, { width: contentWidth, align: 'center' });
      doc.moveDown(1);

      // (2) Company logo top-left + name; ເລກທີ / ວັນທີ right-aligned on the same band.
      const bandTop = doc.y;
      let bandBottom = bandTop;
      if (model.companyLogo) {
        try {
          doc.image(model.companyLogo, left, bandTop, { fit: [72, 72] });
          bandBottom = bandTop + 72;
        } catch {
          /* unreadable image → skip, letter still renders */
        }
      }
      const nameX = left + (model.companyLogo ? 84 : 0);
      doc.fontSize(12).text(model.companyName, nameX, bandTop, { width: right - nameX - 170 });
      bandBottom = Math.max(bandBottom, doc.y);
      doc.fontSize(10);
      doc.text(`ເລກທີ ${model.docNo}`, right - 170, bandTop, { width: 170, align: 'right' });
      doc.text(`ວັນທີ ${model.createdAt ? formatDate(model.createdAt) : '-'}`, right - 170, doc.y, {
        width: 170,
        align: 'right',
      });
      bandBottom = Math.max(bandBottom, doc.y);
      doc.x = left;
      doc.y = bandBottom;
      doc.moveDown(1.5);

      // (3) Centred title from the document type name (e.g. ໃບສະເໜີ).
      doc.fontSize(15).text(model.documentTypeName, left, doc.y, { width: contentWidth, align: 'center' });
      doc.moveDown(1);

      // (4) Salutation + proposer identity line. Missing fields render blank.
      const p = model.proposer;
      doc.fontSize(11).text('ຮຽນ:', left, doc.y, { width: contentWidth });
      const proposerLine =
        `ຂ້າພະເຈົ້າ ທ້າວ/ນາງ ${p.name ?? ''}  ` +
        `ຕຳແໜ່ງ ${p.position ?? ''}  ` +
        `ສັງກັດ ພະແນກ ${p.department ?? ''}`;
      doc.text(proposerLine, left, doc.y, { width: contentWidth });
      doc.moveDown(1);

      // (5) Letter body — each configured field label + value, in order, valueless omitted.
      if (model.fieldValues.length) {
        doc.fontSize(11);
        for (const f of model.fieldValues) {
          if (f.value == null || f.value === '') continue;
          doc.text(`${f.label}: ${f.value}`, left, doc.y, { width: contentWidth });
        }
        doc.moveDown(1);
      }

      // (6) Closing line.
      doc.fontSize(11).text('ຈຶ່ງຮຽນມາເພື່ອຂໍພິຈາລະນາອະນຸມັດ', left, doc.y, { width: contentWidth });
      doc.moveDown(2);

      // (7) Signature footer — one column per flagged step, at fixed offsets so columns don't
      // interleave. Embed the stamped signature when present, else name+date, else a placeholder.
      const blocks = model.signatureBlocks;
      if (blocks.length) {
        const colW = contentWidth / blocks.length;
        const headerY = doc.y;
        const sigY = headerY + 18;
        const nameY = sigY + 56;
        const dateY = nameY + 14;
        doc.fontSize(10);
        blocks.forEach((b, i) => {
          const x = left + i * colW;
          doc.text(b.stepName ?? `ຂັ້ນຕອນ ${b.stepNo}`, x, headerY, { width: colW, align: 'center' });
          if (b.signatureImage) {
            try {
              doc.image(b.signatureImage, x + (colW - 110) / 2, sigY, { fit: [110, 50] });
            } catch {
              doc.text('[signature]', x, sigY + 20, { width: colW, align: 'center' });
            }
          } else if (!b.approverName) {
            doc.text('(ລໍຖ້າ)', x, sigY + 20, { width: colW, align: 'center' }); // pending
          }
          doc.text(b.approverName ?? '—', x, nameY, { width: colW, align: 'center' });
          doc.text(b.actedAt ? formatDate(b.actedAt) : '', x, dateY, { width: colW, align: 'center' });
        });
        doc.x = left;
        doc.y = dateY + 20;
      }

      // DRAFT watermark overlay for non-COMPLETED documents (drawn last so it sits on top).
      if (model.watermark) {
        doc.save();
        doc.rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
        doc
          .fillColor('red')
          .opacity(0.25)
          .fontSize(48)
          .text('DRAFT — NOT FULLY APPROVED', 0, doc.page.height / 2 - 24, {
            width: doc.page.width,
            align: 'center',
          });
        doc.restore();
        doc.opacity(1).fillColor('black');
      }

      doc.end();
    });
  }

  /** Resolve the bundled Lao font, mirroring the lazy pdfkit load: a missing asset is a clear
   *  configuration error, not a silent tofu render. */
  private laoFontPath(): string {
    // Compiled module lives at dist/modules/document; the font at dist/assets/fonts (and the
    // same relative shape under src for dev/test).
    const fontPath = join(__dirname, '..', '..', 'assets', 'fonts', LAO_FONT_FILE);
    if (!existsSync(fontPath)) {
      throw new InternalServerErrorException(
        `PDF rendering is not configured (Lao font asset missing at ${fontPath})`,
      );
    }
    return fontPath;
  }

  private async loadPdfKit(): Promise<new (opts: unknown) => any> {
    try {
      const pkg = 'pdfkit';
      const mod = (await import(pkg)) as any;
      return mod.default ?? mod;
    } catch {
      throw new InternalServerErrorException('PDF rendering is not configured (install pdfkit)');
    }
  }
}
