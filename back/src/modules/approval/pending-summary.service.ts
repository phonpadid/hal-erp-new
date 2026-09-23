import { EntityManager } from '@mikro-orm/postgresql';
import type { FilterQuery } from '@mikro-orm/core';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { DocStatus } from '../../common/enums';
import { Money } from '../../common/money/money';
import { localDateIn, localMidnightInstant } from '../../common/time/company-clock';
import { Document } from '../document/document.entities';
import { DocumentService } from '../document/document.service';
import { Company } from '../multi-company/multi-company.entities';
import { Currency } from '../currency/currency.entities';
import { requesterIdentities, type RequesterIdentity } from '../document/requester-identity';
import { ApproverResolverService } from './approver-resolver.service';
import { DocumentRouteService } from './document-route.service';
import { SlaService } from './sla.service';
import { pendingRowsFor, type PendingRow } from './pending-rows';
import type { PendingSummaryQueryDto } from './dto/workflow.dto';

const FILTER_OFF = { filters: { company: false } } as const;
const DAY_MS = 86_400_000;

export interface PendingSummaryRow {
  documentId: string;
  docNo: string;
  documentType: { id: string; code: string; name: string };
  department: { id: string; deptCode: string; name: string };
  /** `employee.full_name` when the creator is linked to an employee, else `app_user.username`. */
  requesterName: string;
  submittedAt: Date | null;
  /** Whole days since submit — the head's unit. */
  waitingDays: number | null;
  currentStepNo: number;
  stepName: string | null;
  waitingOn: Array<{ userId: string; name: string }>;
  /** The document's currency, else the company base — the currency `grandTotal` is in. */
  currencyCode: string;
  /** `document.grand_total` as a decimal string, never converted. */
  grandTotal: string;
  slaDueAt: Date | null;
  overdue: boolean;
}

/** Per-currency sums as decimal strings; the key is the currency code. */
export type AmountsByCurrency = Record<string, string>;

export interface PendingSummary {
  rows: PendingSummaryRow[];
  /** The departments and types present in the reader's UNFILTERED pending set, for filter options. */
  facets: {
    departments: Array<{ id: string; deptCode: string; name: string; count: number }>;
    documentTypes: Array<{ id: string; code: string; name: string; count: number }>;
  };
  byDepartment: Array<{
    id: string;
    deptCode: string;
    name: string;
    pendingCount: number;
    oldestWaitingDays: number | null;
    totals: AmountsByCurrency;
  }>;
  byStep: Array<{ stepNo: number; stepName: string | null; pendingCount: number; oldestWaitingDays: number | null }>;
  byApprover: Array<{ userId: string; name: string; pendingCount: number; oldestWaitingDays: number | null }>;
  totals: { pendingCount: number; overdueCount: number; amounts: AmountsByCurrency };
  /** For the workbook header and file name. */
  meta: {
    companyCode: string;
    companyName: string;
    baseCurrency: string;
    /** Today, as a `YYYY-MM-DD` day in the company's timezone. */
    today: string;
    departmentName: string | null;
    submittedFrom: string | null;
    submittedTo: string | null;
    decimalPlaces: Record<string, number>;
  };
}

/**
 * The department's weekly question: what did we submit that is still waiting, where, and on whom.
 *
 * Not the inbox. The inbox is what the CALLER must sign; this is every `IN_APPROVAL` document the
 * caller may SEE — the same `DOC_VIEW` predicate the documents list applies — whether or not they
 * are an approver of its current step. A head at DEPARTMENT scope gets their department's
 * documents wherever those wait; a COMPANY-scope reader gets the company; nobody gets more than
 * the list would show them (invariant 1).
 *
 * Filters narrow AFTER the scope and BEFORE the roll-ups; the facets are taken BEFORE the filters,
 * so the client can offer "which departments could I look at" without a permission-gated master
 * list. Read-only throughout.
 */
@Injectable()
export class PendingSummaryService {
  constructor(
    private readonly em: EntityManager,
    private readonly scope: CompanyScopeService,
    private readonly documents: DocumentService,
    private readonly route: DocumentRouteService,
    private readonly resolver: ApproverResolverService,
    private readonly sla: SlaService,
  ) {}

  async summary(q: PendingSummaryQueryDto = {}, now = new Date()): Promise<PendingSummary> {
    const companyId = RequestContext.companyId()!;
    const scoped = this.scope.forActiveCompany();
    const em = this.em.fork();

    const company = await em.findOne(Company, { id: companyId }, { ...FILTER_OFF, populate: ['baseCurrency'] });
    const timezone = company?.timezone ?? 'Asia/Bangkok';
    const baseCode = company?.baseCurrency?.code ?? '';
    const currencies = await em.find(Currency, {}, FILTER_OFF);
    const decimalPlaces = Object.fromEntries(currencies.map((c) => [c.code, c.decimalPlaces]));

    // Visibility first (the list's own predicate), the status second — never the other way round.
    const where = {
      $and: [await this.documents.visibleDocumentsWhere(scoped), { status: DocStatus.IN_APPROVAL }],
    } as FilterQuery<Document>;
    const docs = await scoped.find(Document, where, {
      populate: ['documentType', 'department', 'currency', 'company', 'createdBy', 'workflow'],
    });

    const pending = await pendingRowsFor(docs, { em, route: this.route, resolver: this.resolver, sla: this.sla }, now);
    // Shared with the documents list, so the two screens cannot name the same person differently
    // — and so both get the company scoping this file used to be missing.
    const raisedBy = await requesterIdentities(em, pending.map((p) => p.document));
    const all = pending.map((p) => this.toRow(p, raisedBy, baseCode, now));

    const facets = {
      departments: countBy(all, (r) => r.department.id, (r) => ({ ...r.department })),
      documentTypes: countBy(all, (r) => r.documentType.id, (r) => ({ ...r.documentType })),
    };

    const rows = this.filter(all, q, timezone).sort(
      (a, b) => (b.waitingDays ?? -1) - (a.waitingDays ?? -1) || a.docNo.localeCompare(b.docNo),
    );

    const departmentName = q.departmentId
      ? (facets.departments.find((d) => d.id === q.departmentId)?.name ?? null)
      : null;

    return {
      rows,
      facets,
      ...rollUp(rows),
      meta: {
        companyCode: company?.code ?? 'company',
        companyName: company?.nameEn ?? company?.nameTh ?? company?.code ?? '',
        baseCurrency: baseCode,
        today: localDateIn(now, timezone),
        departmentName,
        submittedFrom: q.submittedFrom?.slice(0, 10) ?? null,
        submittedTo: q.submittedTo?.slice(0, 10) ?? null,
        decimalPlaces,
      },
    };
  }

  /** `employee.full_name` for each creator that has one; the username stands in otherwise. */
  private toRow(p: PendingRow, raisedBy: Map<string, RequesterIdentity>, baseCode: string, now: Date): PendingSummaryRow {
    const d = p.document;
    return {
      documentId: d.id,
      docNo: d.docNo,
      documentType: { id: d.documentType.id, code: d.documentType.code, name: d.documentType.name },
      department: { id: d.department.id, deptCode: d.department.deptCode, name: d.department.name },
      requesterName: raisedBy.get(d.id)?.name || d.createdBy.username,
      submittedAt: d.submittedAt ?? null,
      waitingDays: d.submittedAt ? Math.max(0, Math.floor((now.getTime() - d.submittedAt.getTime()) / DAY_MS)) : null,
      currentStepNo: p.currentStepNo,
      stepName: p.stepName,
      waitingOn: p.approvers.map((a) => ({ userId: a.userId, name: a.username })),
      currencyCode: d.currency?.code ?? baseCode,
      grandTotal: d.grandTotal ?? '0',
      slaDueAt: p.slaDueAt,
      overdue: p.overdue,
    };
  }

  /** Conjunctive, narrowing only. A day range is the company's calendar, `submittedTo` inclusive. */
  private filter(rows: PendingSummaryRow[], q: PendingSummaryQueryDto, timezone: string): PendingSummaryRow[] {
    const from = q.submittedFrom ? localMidnightInstant(q.submittedFrom, timezone) : null;
    const to = q.submittedTo ? new Date(localMidnightInstant(nextDay(q.submittedTo), timezone).getTime() - 1) : null;
    return rows.filter((r) => {
      if (q.departmentId && r.department.id !== q.departmentId) return false;
      if (q.documentTypeId && r.documentType.id !== q.documentTypeId) return false;
      if (q.overdueOnly && !r.overdue) return false;
      if (from && (!r.submittedAt || r.submittedAt < from)) return false;
      if (to && (!r.submittedAt || r.submittedAt > to)) return false;
      return true;
    });
  }
}

/**
 * The head's numbers over the FILTERED rows. Pure, so the two-approver rule and the per-currency
 * sums are testable without a database.
 */
export function rollUp(rows: PendingSummaryRow[]): Pick<PendingSummary, 'byDepartment' | 'byStep' | 'byApprover' | 'totals'> {
  const byDepartment = new Map<string, PendingSummary['byDepartment'][number]>();
  const byStep = new Map<number, PendingSummary['byStep'][number]>();
  const byApprover = new Map<string, PendingSummary['byApprover'][number]>();
  const totals: PendingSummary['totals'] = { pendingCount: 0, overdueCount: 0, amounts: {} };

  for (const r of rows) {
    totals.pendingCount += 1;
    if (r.overdue) totals.overdueCount += 1;
    addAmount(totals.amounts, r.currencyCode, r.grandTotal);

    const dept = byDepartment.get(r.department.id) ?? {
      ...r.department, pendingCount: 0, oldestWaitingDays: null, totals: {},
    };
    dept.pendingCount += 1;
    dept.oldestWaitingDays = maxDays(dept.oldestWaitingDays, r.waitingDays);
    addAmount(dept.totals, r.currencyCode, r.grandTotal);
    byDepartment.set(r.department.id, dept);

    const step = byStep.get(r.currentStepNo) ?? {
      stepNo: r.currentStepNo, stepName: r.stepName, pendingCount: 0, oldestWaitingDays: null,
    };
    step.pendingCount += 1;
    step.oldestWaitingDays = maxDays(step.oldestWaitingDays, r.waitingDays);
    byStep.set(r.currentStepNo, step);

    // Counted once under EACH approver it waits on — the head wants to know whose desk it is
    // on, and a step with two eligible approvers is on both.
    for (const a of r.waitingOn) {
      const e = byApprover.get(a.userId) ?? { userId: a.userId, name: a.name, pendingCount: 0, oldestWaitingDays: null };
      e.pendingCount += 1;
      e.oldestWaitingDays = maxDays(e.oldestWaitingDays, r.waitingDays);
      byApprover.set(a.userId, e);
    }
  }

  return {
    byDepartment: [...byDepartment.values()].sort((a, b) => a.deptCode.localeCompare(b.deptCode)),
    byStep: [...byStep.values()].sort((a, b) => a.stepNo - b.stepNo),
    byApprover: [...byApprover.values()].sort((a, b) => b.pendingCount - a.pendingCount || a.name.localeCompare(b.name)),
    totals,
  };
}

function addAmount(into: AmountsByCurrency, code: string, amount: string): void {
  into[code] = Money.add(into[code] ?? '0', amount);
}

function maxDays(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

/** The `YYYY-MM-DD` after `day`, computed in UTC so no timezone shifts it. */
export function nextDay(day: string): string {
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Distinct values of `key` with how many rows carry each, in first-seen order. */
function countBy<T, K>(rows: T[], key: (r: T) => string, shape: (r: T) => K): Array<K & { count: number }> {
  const out = new Map<string, K & { count: number }>();
  for (const r of rows) {
    const k = key(r);
    const e = out.get(k) ?? { ...shape(r), count: 0 };
    e.count += 1;
    out.set(k, e);
  }
  return [...out.values()];
}
