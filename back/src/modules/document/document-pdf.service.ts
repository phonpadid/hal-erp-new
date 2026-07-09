import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ApproveAction, DocStatus } from '../../common/enums';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { StorageService } from '../../common/storage/storage.service';
import { ApprovalLog, WorkflowStep } from '../approval/approval.entities';
import { AppUser, Employee, UserSignature } from '../rbac/rbac.entities';
import { DocFieldValue, Document, DocumentLine, FormField } from './document.entities';

const FILTER_OFF = { filters: { company: false } } as const;

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
  departmentName: string;
  documentTypeName: string;
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
    const fields = await em.find(
      FormField,
      { formTemplate: document.formTemplate.id },
      { orderBy: { sortOrder: 'ASC' }, ...FILTER_OFF },
    );
    const valueByFieldId = new Map(values.map((v) => [v.formField.id, v.fieldValue]));
    const fieldValues = fields
      .filter((f) => valueByFieldId.has(f.id))
      .map((f) => ({ label: f.fieldLabel, value: valueByFieldId.get(f.id) ?? null }));

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

    return {
      docNo: document.docNo,
      status: document.status,
      watermark: document.status !== DocStatus.COMPLETED,
      companyName: document.company.nameTh,
      departmentName: document.department.name,
      documentTypeName: document.documentType.name,
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

  /** pdfkit is loaded lazily (optional dependency); the layout is intentionally minimal. */
  private async toPdf(model: DocumentPdfModel): Promise<Buffer> {
    const PDFDocument = await this.loadPdfKit();
    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 48 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(16).text(`${model.documentTypeName}  ${model.docNo}`, { align: 'left' });
      doc.fontSize(10).text(`${model.companyName} — ${model.departmentName}`);
      doc.text(`Status: ${model.status}`);
      if (model.watermark) {
        doc.fillColor('red').fontSize(28).opacity(0.3).text('DRAFT — NOT FULLY APPROVED', 100, 250, { angle: 30 });
        doc.opacity(1).fillColor('black').fontSize(10);
      }

      if (model.fieldValues.length) {
        doc.moveDown().fontSize(12).text('Details');
        doc.fontSize(10);
        for (const f of model.fieldValues) doc.text(`${f.label}: ${f.value ?? ''}`);
      }

      if (model.lines.length) {
        doc.moveDown().fontSize(12).text('Lines');
        doc.fontSize(10);
        for (const l of model.lines) {
          doc.text(`${l.lineNo}. ${l.description}  qty ${l.qty} × ${l.unitPrice} = ${l.lineAmount}`);
        }
      }
      if (model.grandTotal) doc.moveDown().text(`Grand total: ${model.grandTotal} ${model.currency}`);

      doc.moveDown().fontSize(12).text('Approvals');
      doc.fontSize(10);
      for (const block of model.signatureBlocks) {
        doc.moveDown();
        doc.text(`${block.stepName ?? `Step ${block.stepNo}`}`);
        if (block.signatureImage) {
          try {
            doc.image(block.signatureImage, { fit: [140, 48] });
          } catch {
            doc.text('[signature could not be rendered]');
          }
        } else if (block.approverName) {
          doc.text('(signature not on file)');
        } else {
          doc.text('(pending)');
        }
        doc.text(`${block.approverName ?? '—'}   ${block.actedAt ? block.actedAt.toISOString().slice(0, 10) : ''}`);
      }

      doc.end();
    });
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
