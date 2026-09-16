import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import type { ExportParts, PrintTemplate } from '@erp/shared';
import { ApproveAction, DocStatus } from '../../common/enums';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { StorageService } from '../../common/storage/storage.service';
import { ApprovalLog, DocumentApprovalStep } from '../approval/approval.entities';
import { PaymentAttachment } from '../payment-handoff/payment.entities';
import { PaymentPermissions } from '../payment-handoff/permissions';
import { Budget, BudgetNode } from '../budget/budget.entities';
import { Currency } from '../currency/currency.entities';
import { Vendor, VendorBankAccount } from '../master-data/master-data.entities';
import { Department } from '../multi-company/multi-company.entities';
import { AppUser, Employee, UserSignature } from '../rbac/rbac.entities';
import {
  DocumentExportAssembler,
  type EvidenceFile,
  type EvidenceKind,
} from './document-export.assembler';
import { renderSheet } from './document-sheet.renderer';
import { SIGNATURES_PER_ROW, signatureRows } from './signature-rows';
import { DocFieldValue, Document, DocumentAttachment, DocumentLine, FormField } from './document.entities';

const FILTER_OFF = { filters: { company: false } } as const;

/**
 * How far the chain walk follows `ref_document`. A real chain is three documents; this exists so a
 * mis-seeded cycle or a pathological chain ends the walk rather than the request.
 */
const CHAIN_DEPTH_LIMIT = 20;

/**
 * Whether this caller may read a document, asked per hop of the chain walk.
 *
 * Passed in rather than injected: the predicate lives on `DocumentService`, whose constructor this
 * service does not take, and passing it at the call site keeps the dependency visible where it is
 * used instead of hidden in the wiring.
 */
export type VisibilityCheck = (documentId: string) => Promise<boolean>;

// Bundled Lao Unicode face (SIL OFL), copied into dist by nest-cli assets. Resolved relative
// to this compiled module so both dev (src) and prod (dist) runs find it (see design D4).
const LAO_FONT_FILE = 'NotoSansLao-Regular.ttf';

// Fixed Lao national header block — constant, independent of document content (spec: Lao
// National Header Block). Regular hyphens keep the separator inside the font's Latin coverage.
const LAO_STATE_NAME = 'ສາທາລະນະລັດ ປະຊາທິປະໄຕ ປະຊາຊົນລາວ';
const LAO_MOTTO = 'ສັນຕິພາບ ເອກະລາດ ປະຊາທິປະໄຕ ເອກະພາບ ວັດທະນະຖາວອນ';
const LAO_SEPARATOR = '---000---';

// Fixed proposal-letter (ໃບສະເໜີ) boilerplate — standard Lao official phrasing, independent of
// document content. The company name is interpolated where the ${company} placeholder appears.
const RECIPIENT_LINE = (company: string) => `ຮຽນ: ຜູ້ອຳນວຍການ${company}.`;
const RECIPIENT_VIA = '(ໂດຍຜ່ານ: ຜະແນກການທີ່ກ່ຽວຂ້ອງ)';
const PURPOSE_LEAD = 'ມີຈຸດປະສົງ: ຂໍສະເໜີມາຍັງທ່ານ ເພື່ອຂໍ';
const CLOSING_PARAGRAPH = (company: string) =>
  `ດັ່ງນັ້ນ, ຈຶ່ງສະເໜີມາຍັງ ຜູ້ອຳນວຍການ${company} ແລະ ຜະແນກການທີ່ກ່ຽວຂ້ອງ ` +
  `ພິຈາລະນາຕາມຄວາມ ເໝາະສົມດ້ວຍ.`;
const CLOSING_SALUTE = 'ຂອບໃຈມາດ້ວຍຄວາມເຄົາລົບນັບຖືຢ່າງສູງ.';

/** Format a date as DD/MM/YYYY from its ISO date part (tz-stable, no locale dependency). */
function formatDate(d: Date): string {
  const [y, m, day] = d.toISOString().slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}

/**
 * Reformat a `date` field value to DD/MM/YYYY so it matches the ວັນທີ shown elsewhere. Only a
 * leading ISO `YYYY-MM-DD` is rewritten; any other shape passes through untouched.
 */
function formatDateString(v: string): string {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
}

/**
 * Reduce a rich-text field value to plain text for the PDF body. Field values captured by a
 * WYSIWYG editor arrive as HTML (e.g. `<p>123456</p>`); pdfkit has no HTML engine, so the raw
 * markup would print verbatim. Block tags become line breaks, list items a bullet, every other
 * tag is dropped, and the common entities are decoded (`&amp;` last, so `&amp;lt;` → `&lt;`).
 * Plain-text values pass through unchanged.
 */
function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)\s*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * Form-field names the sheets read two of their cells from. A form is configuration, so these are
 * conventions rather than a schema: a form that uses one of these names fills the cell, and a form
 * that uses none leaves it blank. Matched case-insensitively on `field_name`, never on the label —
 * labels are translated per company, names are not.
 */
const PURPOSE_FIELD_NAMES = ['purpose', 'purposes', 'reason', 'objective'];
const EXPECTED_DATE_FIELD_NAMES = ['expected_date', 'required_date', 'need_date', 'due_date'];

/**
 * One signature slot on the PDF. An approver block is always tied to a step flagged
 * `show_signature_on_pdf`; the proposer block (`stepNo` 0) stands for the person who submitted.
 */
export interface SignatureBlock {
  /** 0 for the proposer; the recorded step number for an approver. */
  stepNo: number;
  stepName: string | null;
  /**
   * What the column is headed by — the capacity in which it was signed. Approved: the approver's
   * department and position in the document's company; pending: the recorded step name, else the
   * step number. Computed here, once, so the letter and the sheets cannot disagree.
   */
  heading: string;
  /** Null until the step has an APPROVE entry (export of an in-progress document). */
  approverName: string | null;
  actedAt: Date | null;
  /** The stamped signature image bytes, or null (no signature on file / not yet approved). */
  signatureImage: Buffer | null;
}

/** Heading of the proposer block — the person who raised and signed the request. */
export const PROPOSER_HEADING = 'ຜູ້ສະເໜີ';

/** A pending block is headed by what the route calls the step, else by its number. */
export function stepHeading(stepNo: number, stepName: string | null | undefined): string {
  return stepName?.trim() ? stepName : `ຂັ້ນທີ ${stepNo}`;
}

/**
 * An approved block is headed by the capacity in which it was signed: the `position` of the
 * approver's employee row in the document's company. The department is deliberately NOT printed —
 * with it the heading ran to two long Lao lines per column and the row could not hold them; the
 * position alone says what the reader needs ("ຫົວໜ້າພະແນກ"). No position → the step heading.
 */
export function approverHeading(
  employee: { position?: string | null } | null | undefined,
  stepNo: number,
  stepName: string | null | undefined,
): string {
  const position = employee?.position?.trim();
  return position ? position : stepHeading(stepNo, stepName);
}


/**
 * What the pre-printed business sheets (PR / PO / RECEIPT) need on top of what the letter needs.
 *
 * Every member is nullable and every one is resolved independently: a document that names no
 * vendor, no budget and no payee still prints, with those cells blank. That is the rule the sheets
 * are specified with — a form is a shape to fill in, and a half-filled form is still the form,
 * whereas an export that throws because a cell has no source is a document nobody can file.
 */
export interface SheetFacts {
  /**
   * The sheets this document's type prints, in print order — the selector the renderer dispatches
   * on. Never empty: a type that configures nothing prints the official letter.
   */
  printTemplates: PrintTemplate[];
  /** ວັນທີ່ຕ້ອງການ, from a date form field named by convention; blank when the form has none. */
  expectedDate: string | null;
  /** ຈຸດປະສົງ, from the form's purpose/reason field; blank when the form has none. */
  purpose: string | null;
  vendorName: string | null;
  vendorContact: string | null;
  /** The account approval actually approved paying, never a vendor's other account. */
  payee: { bank: string; accountNo: string; accountName: string } | null;
  /** ຫົວຂໍ້ງົບປະມານ / ລະຫັດງົບປະມານ, from the budget the document's lines charge. */
  budgetName: string | null;
  budgetCode: string | null;
  /** ເລກທີບັນຊີ — the GL the lines post to, or the budget's own when a line names none. */
  glAccount: string | null;
  /** The predecessor's number (a receipt names its PO), or null at the head of a chain. */
  refDocNo: string | null;
  subTotal: string | null;
  taxTotal: string | null;
  /** The currency's `decimal_places` — how many digits every amount on the sheet is printed to. */
  decimalPlaces: number;
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
  /** Letterhead contact block for the bottom footer band; each line is null when unset. */
  companyContact: { address: string | null; phone: string | null; email: string | null; website: string | null };
  departmentName: string;
  documentTypeName: string;
  /** Subject of the letter (ເລື່ອງ), driving the topic line under the salutation. */
  subject: string | null;
  /** The document's created_at, shown as ວັນທີ; null when unset. */
  createdAt: Date | null;
  /** Proposer identity for the ຂ້າພະເຈົ້າ line — blank fields when unresolved. */
  proposer: { name: string | null; position: string | null; department: string | null };
  currency: string;
  grandTotal: string | null;
  fieldValues: Array<{ label: string; value: string | null }>;
  lines: Array<{
    lineNo: number;
    description: string;
    qty: string;
    /** ຫົວໜ່ວຍ on the sheets; null when the line names none. */
    unit: string | null;
    unitPrice: string;
    lineAmount: string;
  }>;
  /** Everything only the PR/PO/RECEIPT sheets read. The letter ignores it. */
  sheet: SheetFacts;
  /** Every recorded action (approve/reject/return/delegate), for the audit trail section. */
  trail: Array<{ action: ApproveAction; actorName: string; actedAt: Date | null }>;
  /**
   * The proposer's block, first in the signature row: the signature stamped on
   * `document.submitted_signature_id` at submit (never the current one), the proposer's name and
   * the submit date. A null image prints a line to sign by hand. Null only while never submitted.
   */
  proposerBlock: SignatureBlock | null;
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
    // By `field_name`, for the two sheet cells that come from the form rather than the document.
    const valueByFieldName = new Map(
      fields
        .map((f) => [f.fieldName.toLowerCase(), valueByFieldId.get(f.id) ?? null] as const)
        .filter(([, v]) => v != null && v !== ''),
    );
    const fromForm = (names: string[]): string | null => {
      for (const n of names) {
        const raw = valueByFieldName.get(n);
        if (raw) {
          const text = stripHtml(raw);
          if (text) return text;
        }
      }
      return null;
    };
    // Letter body in form_field.sort_order; only fields with a recorded, non-empty value.
    // HTML from rich-text fields is reduced to plain text first, so a value that is only markup
    // (e.g. `<p></p>`) collapses to '' and is then omitted.
    const fieldValues = fields
      .map((f) => {
        const raw = valueByFieldId.get(f.id) ?? null;
        let value = raw == null ? null : stripHtml(raw);
        // A `date` field is stored ISO; show it DD/MM/YYYY like the rest of the letter.
        if (value && f.fieldType === 'date') value = formatDateString(value);
        return { label: f.fieldLabel, value };
      })
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
    // The route this document actually ran, not the workflow as it stands today. A sheet that was
    // printed and signed by hand is evidence, and evidence that changes when someone edits a
    // workflow is not evidence — the same argument payment-batch makes for storing the exact bytes
    // sent to a bank.
    const steps = await em.find(
      DocumentApprovalStep,
      { document: document.id, supersededAt: null },
      { orderBy: { stepNo: 'ASC' }, ...FILTER_OFF },
    );
    // Sort in JS as well, for the reason the form fields above are: with earlier finds in this same
    // fork, MikroORM has handed these rows back in identity-map order rather than the query's — a
    // real document printed its columns as steps 1, 6, 7, 2, 3, 4. The signature row IS the order
    // people signed in; it must not depend on which rows happened to be loaded first.
    steps.sort((a, b) => a.stepNo - b.stepNo);
    logs.sort((a, b) => a.stepNo - b.stepNo || (a.actedAt?.getTime() ?? 0) - (b.actedAt?.getTime() ?? 0));

    const approverIds = [...new Set(logs.map((l) => l.approver.id))];
    const signatureIds = [...new Set(logs.map((l) => l.signature?.id).filter((v): v is string => !!v))];
    const signatures = signatureIds.length
      ? await em.find(UserSignature, { id: { $in: signatureIds } }, FILTER_OFF)
      : [];
    // The proposer's account joins the approvers here so one query names everyone on the row.
    const rowUserIds = [...new Set([...approverIds, document.createdBy.id])];
    const employees = rowUserIds.length
      ? await em.find(Employee, { user: { $in: rowUserIds }, company: document.company.id }, FILTER_OFF)
      : [];
    const rowUsers = await em.find(AppUser, { id: { $in: rowUserIds } });
    const userById = new Map(rowUsers.map((u) => [u.id, u] as const));
    const sigById = new Map(signatures.map((s) => [s.id, s] as const));
    const employeeByUserId = new Map(employees.filter((e) => e.user).map((e) => [e.user!.id, e] as const));
    // Employee full name in this company, else the account username.
    const nameOf = (userId: string) =>
      employeeByUserId.get(userId)?.fullName ?? userById.get(userId)?.username ?? userId;
    // Position of an approver in this company — the heading of a signed block.
    const headingOf = (userId: string, stepNo: number, stepName: string | null | undefined) =>
      approverHeading(employeeByUserId.get(userId), stepNo, stepName);

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
        heading: approve
          ? headingOf(approve.approver.id, step.stepNo, step.stepName)
          : stepHeading(step.stepNo, step.stepName),
        approverName: approve ? nameOf(approve.approver.id) : null,
        actedAt: approve?.actedAt ?? null,
        signatureImage: sig ? await this.loadObject(sig.filePath) : null,
      });
    }

    // A document approved before routes were recorded has no `document_approval_step` rows at all,
    // so the loop above produces nothing and its sheet prints with no signature line — for a
    // document that WAS approved, by people whose names are in the ledger. The fallback reads
    // `approval_log` instead, which is append-only and therefore evidence of the same standing.
    //
    // Only when NO route was recorded. A recorded route whose steps are all flagged off is a
    // configuration decision — "this type prints no signatures" — and must keep printing none.
    if (!steps.length) {
      for (const [stepNo, approve] of [...approveByStep.entries()].sort((a, b) => a[0] - b[0])) {
        const sig = approve.signature?.id ? sigById.get(approve.signature.id) : undefined;
        signatureBlocks.push({
          stepNo,
          stepName: null,
          heading: headingOf(approve.approver.id, stepNo, null),
          approverName: nameOf(approve.approver.id),
          actedAt: approve.actedAt ?? null,
          signatureImage: sig ? await this.loadObject(sig.filePath) : null,
        });
      }
    }

    // The proposer's block — the signature stamped at submit, read from the stamp and never from
    // the account's current signature (invariant 6). A null stamp (API-key submit, or a document
    // submitted before the stamp existed) prints the name over a line to sign by hand.
    let proposerBlock: SignatureBlock | null = null;
    if (document.submittedAt) {
      const stamped = document.submittedSignatureId
        ? await em.findOne(UserSignature, { id: document.submittedSignatureId }, FILTER_OFF)
        : null;
      proposerBlock = {
        stepNo: 0,
        stepName: PROPOSER_HEADING,
        heading: PROPOSER_HEADING,
        approverName: nameOf(document.createdBy.id),
        actedAt: document.submittedAt,
        signatureImage: stamped ? await this.loadObject(stamped.filePath) : null,
      };
    }

    // Issuing company's logo — bytes from its own profile image, degrading to null on miss so
    // the export still succeeds. Sourced only from the document's own company (no cross-company).
    const companyLogo = document.company.profileImagePath
      ? await this.loadObject(document.company.profileImagePath)
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

    // Sheet facts. Each relation is resolved by an explicit find rather than a populate: a
    // ManyToOne read off `document` here can be an unloaded stub whose fields all read undefined,
    // which would print an empty cell that looks exactly like a document that names nothing.
    const vendorId = document.vendor?.id ?? null;
    const vendor = vendorId ? await em.findOne(Vendor, { id: vendorId }, FILTER_OFF) : null;
    const payeeId = document.vendorBankAccount?.id ?? null;
    const payeeAccount = payeeId
      ? await em.findOne(VendorBankAccount, { id: payeeId }, FILTER_OFF)
      : null;
    // The budget the lines charge. Sheets show one budget because a document charges one in
    // practice; when several are charged the first line's is shown rather than a joined string,
    // which would not fit the printed cell and would read as a budget code that does not exist.
    const budgetId = lines.find((l) => l.budget?.id)?.budget?.id ?? null;
    const budget = budgetId ? await em.findOne(Budget, { id: budgetId }, FILTER_OFF) : null;
    // ລະຫັດງົບປະມານ lives on the plan node, not on the appropriation: `budget` has no code of its
    // own, and the code people write on a request is the node's (`5001`, `HAL9900`).
    const budgetNode = budget?.node?.id
      ? await em.findOne(BudgetNode, { id: budget.node.id }, FILTER_OFF)
      : null;
    // The predecessor read through the SCOPED em, not the fork: a ref pointing at another
    // company's document must come back null rather than print its number (invariant 1).
    const refDocId = document.refDocument?.id ?? null;
    const refDoc = refDocId ? await scoped.findOne(Document, { id: refDocId }) : null;
    // Amounts are printed to the document's own currency precision. A document that stamped no
    // currency falls back to the issuing company's base currency rather than to a constant: a Lao
    // company's sheet printing two decimal places (or the letters THB) is wrong on its face.
    // `currency`'s primary key IS its ISO code, so the company's base currency is read by code.
    const baseCurrencyCode = document.company.baseCurrency?.code ?? null;
    const baseCurrency =
      !document.currency && baseCurrencyCode
        ? await em.findOne(Currency, { code: baseCurrencyCode }, FILTER_OFF)
        : null;
    const sheet: SheetFacts = {
      printTemplates: document.documentType.sheets(),
      expectedDate: (() => {
        const raw = fromForm(EXPECTED_DATE_FIELD_NAMES);
        return raw ? formatDateString(raw) : null;
      })(),
      purpose: fromForm(PURPOSE_FIELD_NAMES),
      vendorName: vendor?.name ?? null,
      // The person to ring about this order, falling back to the company's own contact name.
      vendorContact: vendor?.contactPhone ?? vendor?.contactName ?? null,
      payee: payeeAccount
        ? {
            bank: payeeAccount.bankCode,
            accountNo: payeeAccount.accountNo,
            accountName: payeeAccount.accountName,
          }
        : null,
      budgetName: budget?.budgetName ?? budgetNode?.name ?? null,
      budgetCode: budgetNode?.code ?? null,
      glAccount: lines.find((l) => l.glAccount)?.glAccount ?? budget?.glAccount ?? null,
      refDocNo: refDoc?.docNo ?? null,
      subTotal: document.subTotal ?? null,
      taxTotal: document.taxTotal ?? null,
      decimalPlaces: document.currency?.decimalPlaces ?? baseCurrency?.decimalPlaces ?? 2,
    };

    return {
      docNo: document.docNo,
      status: document.status,
      watermark: document.status !== DocStatus.COMPLETED,
      companyName: document.company.nameTh,
      companyLogo,
      companyContact: {
        address: document.company.address ?? null,
        phone: document.company.phone ?? null,
        email: document.company.email ?? null,
        website: document.company.website ?? null,
      },
      departmentName: document.department.name,
      documentTypeName: document.documentType.name,
      // No dedicated subject column yet — the ເລື່ອງ line renders as a blank fill (the template's
      // dotted line). Wire this to a form field or a document.subject column when one exists.
      subject: null,
      createdAt: document.createdAt ?? null,
      proposer,
      currency: document.currency?.code ?? baseCurrency?.code ?? 'THB',
      grandTotal: document.grandTotal ?? document.totalAmount ?? null,
      fieldValues,
      lines: lines.map((l) => ({
        lineNo: l.lineNo,
        description: l.description,
        qty: l.qty,
        unit: l.unit ?? null,
        unitPrice: l.unitPrice,
        lineAmount: l.lineAmount,
      })),
      trail: logs.map((l) => ({
        action: l.action,
        actorName: nameOf(l.approver.id),
        actedAt: l.actedAt ?? null,
      })),
      proposerBlock,
      signatureBlocks,
      sheet,
    };
  }

  /**
   * Render the document to PDF bytes, on the layout its type configures.
   *
   * The dispatch is on `print_template` alone — never on the type's `code`, `category` or
   * `post_action` (invariant 7). `LETTER` keeps the pdfkit letter layout it has always had; the
   * three business sheets are drawn by the pdfmake renderer, which is what can express their
   * nested tables.
   */
  async render(id: string): Promise<Buffer> {
    const model = await this.buildModel(id);
    const sheets = await this.renderModel(model);
    if (sheets.length === 1) return sheets[0];
    // Several sheets for one document still leave as one file, assembled the same way the chain is.
    const assembler = await DocumentExportAssembler.open(this.laoFontPath());
    for (const sheet of sheets) await assembler.appendOwnPdf(sheet);
    return assembler.finish();
  }

  /**
   * Render an already-built model — the entry point the chain export reuses per document.
   *
   * One document can be several sheets: HAL's purchase request is filed as the official letter and
   * as the purchase-request form, so the type declares both and this returns one PDF per sheet, in
   * print order. The caller appends them in the order returned.
   */
  async renderModel(model: DocumentPdfModel): Promise<Buffer[]> {
    const fontPath = this.laoFontPath();
    const sheets: Buffer[] = [];
    for (const template of model.sheet.printTemplates) {
      sheets.push(
        template === 'LETTER'
          ? await this.toPdf(model)
          : await renderSheet({ ...model, sheet: { ...model.sheet, printTemplates: [template] } }, fontPath),
      );
    }
    return sheets;
  }

  /**
   * The documents to print, predecessor-first, for the requested scope.
   *
   * `SELF` is the document alone. `CHAIN` walks `ref_document` upward — a receipt names its order,
   * an order names its request — through the SCOPED entity manager, so a predecessor in another
   * company or outside this caller's read scope simply is not found and drops out of the set
   * (invariant 1) rather than being fetched and hidden afterwards.
   *
   * The walk is bounded twice over: by `CHAIN_DEPTH_LIMIT`, and by refusing to visit an id twice,
   * so a chain that loops back on itself ends the walk instead of the process.
   */
  async chainFor(id: string, parts: ExportParts, canRead?: VisibilityCheck): Promise<string[]> {
    if (parts === 'SELF') return [id];
    const scoped = this.scope.forActiveCompany();
    const ordered: string[] = [];
    const seen = new Set<string>();
    let current: string | null = id;
    while (current && ordered.length < CHAIN_DEPTH_LIMIT && !seen.has(current)) {
      seen.add(current);
      // The reader's own predicate, not merely the company scope: a document the list would hide
      // must not become printable by being some other document's predecessor. The walk stops
      // there rather than skipping past it — reading what lies beyond would mean reading the
      // hidden document's own reference.
      if (canRead && !(await canRead(current))) break;
      const doc: Document | null = await scoped.findOne(Document, { id: current });
      if (!doc) break;
      ordered.unshift(doc.id); // predecessor-first: PR, then PO, then the receipt
      current = doc.refDocument?.id ?? null;
    }
    return ordered;
  }

  /**
   * Render the export: each document's sheet followed by the evidence attached to it, as one PDF.
   *
   * Evidence is appended automatically — the point of printing a finished purchase is to hold the
   * paper trail in one file, and a slip that has to be downloaded separately is not in the file.
   * Payment slips are the exception, and only for a caller who may not read them (see
   * `evidenceFor`).
   */
  async renderExport(
    id: string,
    parts: ExportParts = 'SELF',
    canRead?: VisibilityCheck,
  ): Promise<{ bytes: Buffer; docNo: string }> {
    const ids = await this.chainFor(id, parts, canRead);
    if (!ids.length) throw new NotFoundException(`Document ${id} not found`);
    const assembler = await DocumentExportAssembler.open(this.laoFontPath());
    let requestedDocNo = id;
    for (const docId of ids) {
      const model = await this.buildModel(docId);
      if (docId === id) requestedDocNo = model.docNo;
      for (const sheet of await this.renderModel(model)) await assembler.appendOwnPdf(sheet);
      const evidence = await this.evidenceFor(docId);
      if (evidence.length) await assembler.appendEvidence(model.docNo, evidence);
    }
    return { bytes: await assembler.finish(), docNo: requestedDocNo };
  }

  /**
   * The files to print behind one document: its own attachments, plus its payment slips when the
   * caller holds `PAYMENT_VIEW`.
   *
   * Without that permission the slips are not listed, not named and not fetched. Reading payment
   * evidence is `PAYMENT_VIEW`'s business everywhere else in the system, and an export that
   * appended them for anyone holding `DOC_VIEW` would be a way around that gate rather than a
   * printing convenience.
   */
  private async evidenceFor(documentId: string): Promise<EvidenceFile[]> {
    const em = this.em.fork();
    const attachments = await em.find(
      DocumentAttachment,
      { document: documentId },
      { orderBy: { uploadedAt: 'ASC' }, ...FILTER_OFF },
    );
    const maySeeSlips = RequestContext.permissions().includes(PaymentPermissions.PAYMENT_VIEW);
    const slips = maySeeSlips
      ? await em.find(
          PaymentAttachment,
          { document: documentId },
          { orderBy: { uploadedAt: 'ASC' }, ...FILTER_OFF },
        )
      : [];

    // Attachments first, slips after: the request's own paper comes before the proof that the
    // money moved, which is the order the two are read in.
    const rows: Array<{ row: (typeof attachments)[number] | (typeof slips)[number]; kind: EvidenceKind }> = [
      ...attachments.map((row) => ({ row, kind: 'ATTACHMENT' as const })),
      ...slips.map((row) => ({ row, kind: 'SLIP' as const })),
    ];
    const uploaderIds = [...new Set(rows.map(({ row }) => row.uploadedBy?.id).filter((v): v is string => !!v))];
    const uploaders = uploaderIds.length ? await em.find(AppUser, { id: { $in: uploaderIds } }) : [];
    const nameById = new Map(uploaders.map((u) => [u.id, u.username] as const));

    return Promise.all(
      rows.map(async ({ row: r, kind }) => ({
        kind,
        fileName: r.fileName,
        mimeType: r.mimeType ?? null,
        fileSizeKb: r.fileSizeKb ?? null,
        uploadedBy: r.uploadedBy?.id ? (nameById.get(r.uploadedBy.id) ?? null) : null,
        uploadedAt: r.uploadedAt ?? null,
        // A storage miss is a placeholder page naming the file, not a failed export — the same
        // degradation the stamped signatures already take.
        bytes: await this.loadObject(r.filePath),
      })),
    );
  }

  /**
   * Fetch stored bytes — a stamped signature, a company logo, an attachment. A storage miss
   * degrades to null, which every caller renders as a placeholder rather than a failed export.
   */
  private async loadObject(filePath: string): Promise<Buffer | null> {
    try {
      return await this.storage.getObject(filePath);
    } catch {
      return null;
    }
  }

  /**
   * Render the Lao official-letter layout (ໃບສະເໜີ): national header, company logo + name with
   * ເລກທີ/ວັນທີ, centred title, salutation (ຮຽນ) + "via" + subject (ເລື່ອງ), the proposer/purpose
   * line, the configured form body, the closing paragraph + salutation, a columnar signature
   * footer, and the company letterhead contact band pinned at the page bottom — with the DRAFT
   * overlay for non-COMPLETED documents (design D5). pdfkit is loaded lazily (optional dependency)
   * and the bundled Lao font is registered as the default face.
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

      // (4) Salutation (ຮຽນ) + the "via" line, then the subject (ເລື່ອງ).
      doc.fontSize(11).text(RECIPIENT_LINE(model.companyName), left, doc.y, { width: contentWidth });
      doc.text(RECIPIENT_VIA, left + 24, doc.y, { width: contentWidth - 24 });
      doc.moveDown(0.5);
      doc.text(`ເລື່ອງ: ${model.subject ?? '..............................................................'}`, left, doc.y, { width: contentWidth });
      doc.moveDown(1);

      // (5) Proposer identity + purpose lead. The whole body block is indented to `bodyX` so every
      // line — including wrapped ones — starts on the same column (no ragged first-line indent).
      // Missing proposer fields render as a dotted blank, matching the template's fill lines.
      const bodyX = left + 24;
      const bodyW = right - bodyX;
      const p = model.proposer;
      const proposerLine =
        `ຂ້າພະເຈົ້າ ທ້າວ/ນາງ ${p.name ?? '................'}  ` +
        `ຕຳແໜ່ງ ${p.position ?? '................'}`;
      doc.text(proposerLine, bodyX, doc.y, { width: bodyW });
      doc.text(
        `ສັງກັດຢູ່ ພະແນກ ${p.department ?? '................'};  ${PURPOSE_LEAD}`,
        bodyX,
        doc.y,
        { width: bodyW },
      );
      doc.moveDown(0.5);

      // (6) Letter body — each configured field as an aligned two-column row: labels in a fixed
      // column, values starting at a shared `valueX` so they line up vertically down the page.
      const rows = model.fieldValues.filter((f) => f.value != null && f.value !== '');
      if (rows.length) {
        const labelW = Math.max(...rows.map((f) => doc.widthOfString(`${f.label}:`)));
        const valueX = bodyX + labelW + 8;
        const valueW = right - valueX;
        for (const f of rows) {
          const rowY = doc.y;
          doc.text(`${f.label}:`, bodyX, rowY, { width: labelW });
          doc.text(f.value as string, valueX, rowY, { width: valueW });
        }
      }
      doc.moveDown(1);

      // (7) Closing paragraph + right-aligned salutation (same body indent as above).
      doc.text(CLOSING_PARAGRAPH(model.companyName), bodyX, doc.y, { width: bodyW });
      doc.moveDown(0.5);
      doc.text(CLOSING_SALUTE, left, doc.y, { width: contentWidth, align: 'right' });
      doc.moveDown(2);

      // (8) Signature footer — the proposer first, then one column per flagged workflow step, at
      // fixed offsets so columns don't interleave. The heading is the capacity in which the column
      // was signed (department · position once approved; the step name while pending) and comes
      // from the model, so the letter and the sheets agree. Headings may wrap to a second line.
      // Draw a signature baseline, then the stamped image when present, else a pending marker.
      const blocks = [...(model.proposerBlock ? [model.proposerBlock] : []), ...model.signatureBlocks];
      if (blocks.length) {
        // Every column the same width, sized for a full row, so a second row lines up under the
        // first; a route of ten prints as two rows of five rather than ten slivers.
        const colW = contentWidth / Math.min(blocks.length, SIGNATURES_PER_ROW);
        const imgW = Math.min(110, colW - 12);
        doc.fontSize(10);
        for (const row of signatureRows(blocks)) {
          const headerY = doc.y;
          const headingH = Math.max(...row.map((b) => doc.heightOfString(b.heading, { width: colW })));
          const sigY = headerY + headingH + 4;
          const lineY = sigY + 52;
          const nameY = lineY + 4;
          const dateY = nameY + 14;
          row.forEach((b, i) => {
            const x = left + i * colW;
            doc.text(b.heading, x, headerY, { width: colW, align: 'center' });
            if (b.signatureImage) {
              try {
                doc.image(b.signatureImage, x + (colW - imgW) / 2, sigY, { fit: [imgW, 48] });
              } catch {
                doc.text('[signature]', x, sigY + 18, { width: colW, align: 'center' });
              }
            } else if (!b.approverName) {
              doc.text('(ລໍຖ້າ)', x, sigY + 18, { width: colW, align: 'center' }); // pending
            }
            // Dotted signature baseline centred in the column.
            doc.save();
            doc.dash(1, { space: 2 });
            doc
              .moveTo(x + colW * 0.15, lineY)
              .lineTo(x + colW * 0.85, lineY)
              .stroke();
            doc.restore();
            doc.text(b.approverName ?? '', x, nameY, { width: colW, align: 'center' });
            doc.text(b.actedAt ? formatDate(b.actedAt) : '', x, dateY, { width: colW, align: 'center' });
          });
          doc.x = left;
          doc.y = dateY + 20;
        }
      }

      // (9) Contact footer band — pinned near the page bottom, above the margin. A horizontal
      // rule then the company's letterhead lines; each line is emitted only when present.
      const contact = model.companyContact;
      const contactLines: string[] = [];
      if (contact.address) contactLines.push(contact.address);
      const line2 = [
        contact.phone ? `ໂທ: ${contact.phone}` : null,
        contact.email ? `ອີເມວ: ${contact.email}` : null,
        contact.website ? `Website: ${contact.website}` : null,
      ].filter(Boolean);
      if (line2.length) contactLines.push(line2.join('   '));
      if (contactLines.length) {
        const footerH = 14 * contactLines.length + 10;
        const footerTop = doc.page.height - doc.page.margins.bottom - footerH;
        doc.save();
        doc.lineWidth(0.75).moveTo(left, footerTop).lineTo(right, footerTop).stroke();
        doc.restore();
        doc.fontSize(8).fillColor('black');
        let fy = footerTop + 6;
        for (const line of contactLines) {
          doc.text(line, left, fy, { width: contentWidth, align: 'center' });
          fy += 14;
        }
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
