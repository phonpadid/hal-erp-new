import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { DocStatus } from '../../common/enums';
import { Money } from '../../common/money/money';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ApprovalLog } from '../approval/approval.entities';
import { ApproverResolverService } from '../approval/approver-resolver.service';
import { DocumentRouteService } from '../approval/document-route.service';
import { SlaService } from '../approval/sla.service';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { Budget, BudgetTxn } from '../budget/budget.entities';
import { Document, DocumentType } from '../document/document.entities';
import { Vendor } from '../master-data/master-data.entities';
import { QuotaBalanceService } from '../quota/quota-balance.service';
import { periodForCycle, periodForYear } from '../quota/quota-period';
import { Quota } from '../quota/quota.entities';
import { AppUser } from '../rbac/rbac.entities';
import {
  BudgetAuditQueryDto,
  BudgetBalanceQueryDto,
  DocumentSummaryQueryDto,
  QuotaRemainingQueryDto,
  SpendByVendorQueryDto,
} from './dto/report-filters.dto';

const FILTER_OFF = { filters: { company: false } } as const;

/** Hours between two instants (calendar hours), rounded to one decimal. */
function hoursBetween(from: Date | null | undefined, to: Date): number | null {
  if (!from) return null;
  return Math.round(((to.getTime() - from.getTime()) / 3_600_000) * 10) / 10;
}

/** A MikroORM created_at predicate for an optional [from, to] date range (inclusive), or null. */
function dateRange(from?: string, to?: string): Record<string, Date> | null {
  if (!from && !to) return null;
  return {
    ...(from ? { $gte: new Date(from) } : {}),
    ...(to ? { $lte: new Date(`${to}T23:59:59.999Z`) } : {}),
  };
}

export interface BudgetBalanceRow {
  budgetId: string;
  departmentId: string;
  departmentName: string;
  /**
   * The budget's own code — what it is grouped by, and what the reader recognises it by.
   *
   * This used to be the GL account. It cannot be any more: one account is charged by several
   * budgets and one budget posts to several accounts, so an account names no group anyone can act
   * on. The money under `658.0007` belongs partly to fuel, partly to repairs and partly to
   * registration, split by a decision recorded per transaction — collapsing them into an
   * account row would state a total nobody owns.
   */
  category: string; // budget code
  amountTotal: string;
  adjustIncrease: string;
  adjustDecrease: string;
  transferIn: string;
  transferOut: string;
  reserved: string;
  actual: string;
  released: string;
  available: string;
}

export interface BudgetBalanceGroup {
  departmentId: string;
  departmentName: string;
  /** The budget code the group totals — see {@link BudgetBalanceRow.category}. */
  category: string;
  amountTotal: string;
  reserved: string;
  actual: string;
  released: string;
  available: string;
}

export interface ApprovalAgingRow {
  documentId: string;
  docNo: string;
  documentType: { code: string; name: string };
  requesterName: string;
  baseTotalAmount: string | null;
  currentStepNo: number;
  stepName: string | null;
  approvers: Array<{ userId: string; username: string }>;
  submittedAt: Date | null;
  ageHours: number | null;
  timeInStepHours: number | null;
  slaDueAt: Date | null;
  overdue: boolean;
}

export interface QuotaRemainingRow {
  quotaId: string;
  quotaType: string;
  unit: string;
  departmentName: string | null;
  employeeId: string;
  employeeName: string;
  year: number;
  entitled: string;
  used: string;
  remaining: string;
}

export interface BudgetAuditRow {
  id: string;
  txnType: string;
  amount: string;
  /** The day the movement happened, in the company's own timezone — what the filter uses. */
  txnDate: string;
  /** When the row was recorded. Shown beside `txnDate`, never instead of it. */
  createdAt: Date | null;
  budgetId: string;
  category: string;
  departmentName: string;
  documentId: string | null;
  documentNo: string | null;
  remark: string | null;
  actorName: string | null;
}

export interface DocumentSummaryRow {
  documentTypeId: string;
  typeCode: string;
  typeName: string;
  category: string;
  status: string;
  count: number;
  baseTotal: string;
}
export interface DocumentStatusTotal {
  status: string;
  count: number;
  baseTotal: string;
}

/**
 * Order document-summary rows by type code then status. Null-safe: a row whose `typeCode` or
 * `status` is missing (e.g. a document whose `documentType` could not be resolved to a full
 * record — the reference carries only its id) must not blow up the sort, so we coalesce to ''
 * before comparing. Missing keys sort first, deterministically.
 */
export function compareDocumentSummaryRows(a: DocumentSummaryRow, b: DocumentSummaryRow): number {
  return (a.typeCode ?? '').localeCompare(b.typeCode ?? '') || (a.status ?? '').localeCompare(b.status ?? '');
}

export interface SpendByVendorRow {
  vendorId: string;
  vendorName: string;
  count: number;
  baseTotal: string;
  cumulativePct: number; // running share of grand total, 0–100 (one decimal) for Pareto
}

export interface BudgetUtilizationRow {
  departmentId: string;
  departmentName: string;
  amountTotal: string;
  consumed: string; // reserved + actual
  available: string;
  /**
   * consumed / amountTotal * 100, one decimal — or NULL when there is no budget to measure
   * against.
   *
   * Not zero. A budget of nothing that has been spent against is the opposite of untouched, and
   * `0` is what every consumer of this figure reads as untouched: it drags the average down, it
   * escapes the over-100% count, it sorts to the bottom and it draws an empty bar. The customer's
   * own spreadsheet has the identical trap — 115 of its rows spend against a blank budget and show
   * `0` in the percentage column while the column beside it shows the overspend in full.
   */
  utilizationPct: number | null;
}

/**
 * Read-only operational reports. Every method is scoped to the active company and ONLY reads —
 * it never writes a ledger row. Numeric truth stays in the balance/quota services this
 * orchestrates, so a report and the matching detail screen can never disagree (invariants 1-3).
 */
@Injectable()
export class ReportingService {
  constructor(
    private readonly em: EntityManager,
    private readonly scope: CompanyScopeService,
    private readonly balance: BudgetBalanceService,
    private readonly quotaBalance: QuotaBalanceService,
    private readonly resolver: ApproverResolverService,
    private readonly sla: SlaService,
    private readonly route: DocumentRouteService,
  ) {}

  /**
   * Budget balance for the active company, derived per budget then grouped by
   * (department, category = the budget NODE's code). Budget isn't company-scoped, so we scope
   * through fiscalYear.company explicitly.
   *
   * The category used to be the GL account. It cannot be: one account is charged by fuel, repairs
   * and registration budgets inside a single department, and grouping by it merged three plan lines
   * into one row that matched nothing in the customer's own book.
   */
  async budgetBalanceByDeptCategory(
    f: BudgetBalanceQueryDto = {},
  ): Promise<{ rows: BudgetBalanceRow[]; groups: BudgetBalanceGroup[] }> {
    const companyId = RequestContext.companyId()!;
    const em = this.em.fork();
    const where: Record<string, unknown> = {
      fiscalYear: f.fiscalYearId ? { id: f.fiscalYearId, company: companyId } : { company: companyId },
    };
    if (f.departmentId) where.department = f.departmentId;

    const budgets = await em.find(Budget, where, {
      ...FILTER_OFF,
      populate: ['department', 'node'],
      orderBy: { node: { code: 'ASC' } },
    });

    const rows: BudgetBalanceRow[] = [];
    const groupMap = new Map<string, BudgetBalanceGroup>();
    for (const b of budgets) {
      const bd = await this.balance.breakdown(b.id);
      const row: BudgetBalanceRow = {
        budgetId: b.id,
        departmentId: b.department.id,
        departmentName: b.department.name,
        category: b.node.code,
        ...bd,
      };
      rows.push(row);

      const key = `${b.department.id}::${b.node.code}`;
      const g =
        groupMap.get(key) ??
        {
          departmentId: b.department.id,
          departmentName: b.department.name,
          category: b.node.code,
          amountTotal: '0',
          reserved: '0',
          actual: '0',
          released: '0',
          available: '0',
        };
      g.amountTotal = Money.add(g.amountTotal, bd.amountTotal);
      g.reserved = Money.add(g.reserved, bd.reserved);
      g.actual = Money.add(g.actual, bd.actual);
      g.released = Money.add(g.released, bd.released);
      g.available = Money.add(g.available, bd.available);
      groupMap.set(key, g);
    }
    return { rows, groups: [...groupMap.values()] };
  }

  /**
   * All documents IN_APPROVAL in the active company (NOT limited to the caller's actionable
   * set — this is a bottleneck report), with the step they wait on, the eligible approver(s),
   * document age, time-in-step (from approval_log), and SLA/overdue. Plus by-approver and
   * by-step roll-ups.
   */
  async approvalAging(): Promise<{
    rows: ApprovalAgingRow[];
    byApprover: Array<{ approverId: string; approverName: string; pendingCount: number; oldestAgeHours: number | null }>;
    byStep: Array<{ stepNo: number; stepName: string | null; pendingCount: number; oldestAgeHours: number | null }>;
  }> {
    const companyId = RequestContext.companyId()!;
    const now = new Date();

    const docs = await this.em.find(
      Document,
      { company: companyId, status: DocStatus.IN_APPROVAL },
      { populate: ['createdBy', 'company', 'workflow'], ...FILTER_OFF },
    );

    // Resolve DocumentType by id rather than `populate: ['documentType']`: the shared request EM
    // can hold it as an unloaded reference from a prior create/submit flow, which would surface
    // here as undefined code/name (see documentSummary / DocumentService.listCreatableTypes).
    const typeIds = [...new Set(docs.map((d) => d.documentType.id))];
    const types = typeIds.length
      ? await this.em.find(DocumentType, { id: { $in: typeIds } }, FILTER_OFF)
      : [];
    const typeById = new Map(types.map((t) => [t.id, t]));

    const rows: ApprovalAgingRow[] = [];
    for (const doc of docs) {
      if (!doc.workflow) continue;
      const step = await this.route.routeStep(doc.id, doc.currentStepNo);
      const actors = step ? await this.resolver.eligible(step, doc) : [];
      const approvers = await this.resolveUsernames(actors.map((a) => a.userId));

      // Both the due time and the time-in-step come from when this step OPENED. That figure used
      // to be inferred from the latest approval-log row at or below the current step — the closest
      // thing available before a step had a start time, and wrong for a step reached by escalation
      // (which logs against the step it left) and for the first step of a resubmission.
      const enteredStepAt = step?.startedAt ?? doc.submittedAt ?? null;

      let slaDueAt: Date | null = null;
      if (step?.slaHours && enteredStepAt) {
        slaDueAt = await this.sla.stepDueAt(enteredStepAt, step.slaHours, doc.company.id);
      }

      rows.push({
        documentId: doc.id,
        docNo: doc.docNo,
        documentType: {
          code: typeById.get(doc.documentType.id)?.code ?? doc.documentType.id,
          name: typeById.get(doc.documentType.id)?.name ?? doc.documentType.id,
        },
        requesterName: doc.createdBy.username,
        baseTotalAmount: doc.baseTotalAmount ?? null,
        currentStepNo: doc.currentStepNo,
        stepName: step?.stepName ?? null,
        approvers,
        submittedAt: doc.submittedAt ?? null,
        ageHours: hoursBetween(doc.submittedAt, now),
        timeInStepHours: hoursBetween(enteredStepAt, now),
        slaDueAt,
        overdue: slaDueAt != null && now > slaDueAt,
      });
    }

    // Roll-ups: count a document under each eligible approver, and under its current step.
    const byApproverMap = new Map<string, { approverId: string; approverName: string; pendingCount: number; oldestAgeHours: number | null }>();
    const byStepMap = new Map<number, { stepNo: number; stepName: string | null; pendingCount: number; oldestAgeHours: number | null }>();
    for (const r of rows) {
      for (const a of r.approvers) {
        const e = byApproverMap.get(a.userId) ?? { approverId: a.userId, approverName: a.username, pendingCount: 0, oldestAgeHours: null };
        e.pendingCount += 1;
        e.oldestAgeHours = maxAge(e.oldestAgeHours, r.ageHours);
        byApproverMap.set(a.userId, e);
      }
      const s = byStepMap.get(r.currentStepNo) ?? { stepNo: r.currentStepNo, stepName: r.stepName, pendingCount: 0, oldestAgeHours: null };
      s.pendingCount += 1;
      s.oldestAgeHours = maxAge(s.oldestAgeHours, r.ageHours);
      byStepMap.set(r.currentStepNo, s);
    }

    return {
      rows,
      byApprover: [...byApproverMap.values()].sort((a, b) => b.pendingCount - a.pendingCount),
      byStep: [...byStepMap.values()].sort((a, b) => a.stepNo - b.stepNo),
    };
  }

  /**
   * Per-employee quota remaining for the active company's quotas, for the chosen year (or the
   * current cycle). Folds QuotaBalanceService.breakdown over each quota.
   */
  async quotaRemaining(f: QuotaRemainingQueryDto = {}): Promise<QuotaRemainingRow[]> {
    const em = this.scope.forActiveCompany();
    const quotas = await em.find(Quota, { isActive: true });

    const rows: QuotaRemainingRow[] = [];
    for (const q of quotas) {
      const period = f.year ? periodForYear(q.resetCycle, f.year) : periodForCycle(q.resetCycle);
      const bd = await this.quotaBalance.breakdown(q.id, undefined, period);
      for (const e of bd.entitlements) {
        rows.push({
          quotaId: q.id,
          quotaType: bd.quota.quotaType,
          unit: bd.quota.unit,
          departmentName: bd.quota.departmentName,
          employeeId: e.employeeId,
          employeeName: e.employeeName,
          year: e.year,
          entitled: e.entitled,
          used: e.used,
          remaining: e.remaining,
        });
      }
    }
    return rows;
  }

  /**
   * Budget movement audit trail for the active company: the budget_txn stream joined to its
   * budget and source document, newest-first, filterable by budget/department and date range.
   * Append-only — corrections appear as their own rows, never merged.
   */
  async budgetAudit(f: BudgetAuditQueryDto = {}): Promise<BudgetAuditRow[]> {
    const companyId = RequestContext.companyId()!;
    const em = this.em.fork();

    const budgetWhere: Record<string, unknown> = { fiscalYear: { company: companyId } };
    if (f.budgetId) budgetWhere.id = f.budgetId;
    if (f.departmentId) budgetWhere.department = f.departmentId;

    // Filtered and ordered by the day the movement HAPPENED, not the instant the row was inserted.
    // A person asking for "the first half of May" means movements that took effect then: a transfer
    // effective on 1 May and approved on the 20th belongs in that range. The general ledger already
    // answers date questions this way, with `entry_date`.
    const where: Record<string, unknown> = { budget: budgetWhere };
    if (f.from || f.to) {
      where.txnDate = {
        ...(f.from ? { $gte: f.from } : {}),
        ...(f.to ? { $lte: f.to } : {}),
      };
    }

    const txns = await em.find(BudgetTxn, where, {
      ...FILTER_OFF,
      populate: ['budget', 'budget.department', 'budget.node', 'document', 'createdBy'],
      // `created_at` breaks ties within a day — including a TRANSFER_OUT and its TRANSFER_IN, which
      // share both a day and a transaction.
      orderBy: { txnDate: 'DESC', createdAt: 'DESC' },
    });

    return txns.map((t) => ({
      id: t.id,
      txnType: t.txnType,
      amount: t.amount,
      // Both: when it happened, and when the system learned of it. An audit report is exactly where
      // the gap between the two is worth seeing.
      txnDate: t.txnDate,
      createdAt: t.createdAt ?? null,
      budgetId: t.budget.id,
      // Grouped by the code of the node the budget's money sits at, for the same reason the
      // balance report is: an account does not identify a plan line.
      category: t.budget.node.code,
      departmentName: t.budget.department.name,
      documentId: t.document?.id ?? null,
      documentNo: t.document?.docNo ?? null,
      remark: t.remark ?? null,
      actorName: t.createdBy?.username ?? null,
    }));
  }

  /**
   * Document volume for the active company grouped by (document type, status): a count and the
   * summed locked base amount per cell, plus overall per-status totals for the status donut.
   * Optional date range narrows by created_at; money stays a decimal string via Money.
   */
  async documentSummary(
    f: DocumentSummaryQueryDto = {},
  ): Promise<{ rows: DocumentSummaryRow[]; byStatus: DocumentStatusTotal[] }> {
    const companyId = RequestContext.companyId()!;
    const em = this.em.fork();
    const where: Record<string, unknown> = { company: companyId };
    if (f.documentTypeId) where.documentType = f.documentTypeId;
    const createdAt = dateRange(f.from, f.to);
    if (createdAt) where.createdAt = createdAt;

    // Don't `populate: ['documentType']` here. The shared request EM can hold DocumentType as
    // an unloaded reference after a prior create/submit flow (which loads DeptDocType without
    // populating its documentType), and a populated relation would then come back with
    // code/name/category undefined — every row would render as its raw UUID / UNKNOWN. Read the
    // FK id off the reference (always present) and hydrate the type rows explicitly by id, the
    // same pattern DocumentService.listCreatableTypes uses. An id-scoped load always hydrates.
    const docs = await em.find(Document, where, FILTER_OFF);
    const typeIds = [...new Set(docs.map((d) => d.documentType.id))];
    const types = typeIds.length
      ? await em.find(DocumentType, { id: { $in: typeIds } }, FILTER_OFF)
      : [];
    const typeById = new Map(types.map((t) => [t.id, t]));

    const rowMap = new Map<string, DocumentSummaryRow>();
    const statusMap = new Map<string, DocumentStatusTotal>();
    for (const d of docs) {
      const amount = d.baseTotalAmount ?? '0';
      const typeId = d.documentType.id;
      const type = typeById.get(typeId);
      const key = `${typeId}::${d.status}`;
      // Rows are grouped by type id (always present). Display fields fall back to the id / a
      // sentinel for a genuinely orphaned type row, so a dirty document never yields an
      // undefined sort key (see compareDocumentSummaryRows).
      const row =
        rowMap.get(key) ??
        {
          documentTypeId: typeId,
          typeCode: type?.code ?? typeId,
          typeName: type?.name ?? typeId,
          category: type?.category ?? 'UNKNOWN',
          status: d.status,
          count: 0,
          baseTotal: '0',
        };
      row.count += 1;
      row.baseTotal = Money.add(row.baseTotal, amount);
      rowMap.set(key, row);

      const st = statusMap.get(d.status) ?? { status: d.status, count: 0, baseTotal: '0' };
      st.count += 1;
      st.baseTotal = Money.add(st.baseTotal, amount);
      statusMap.set(d.status, st);
    }

    const rows = [...rowMap.values()].sort(compareDocumentSummaryRows);
    const byStatus = [...statusMap.values()].sort((a, b) => b.count - a.count);
    return { rows, byStatus };
  }

  /**
   * Spend by vendor for the active company: summed locked base amount over documents that
   * represent committed spend (APPROVED or COMPLETED) and carry a vendor, sorted high→low with
   * a running cumulative share for a Pareto chart. Optional date range narrows by created_at.
   */
  async spendByVendor(f: SpendByVendorQueryDto = {}): Promise<SpendByVendorRow[]> {
    const companyId = RequestContext.companyId()!;
    const em = this.em.fork();
    const where: Record<string, unknown> = {
      company: companyId,
      status: { $in: [DocStatus.APPROVED, DocStatus.COMPLETED] },
      vendor: { $ne: null },
    };
    const createdAt = dateRange(f.from, f.to);
    if (createdAt) where.createdAt = createdAt;

    const docs = await em.find(Document, where, FILTER_OFF);

    // Filtering on `vendor` in the where above makes populate('vendor') return a bare FK reference
    // (name unhydrated), so resolve vendor names explicitly by id.
    const vendorIds = [...new Set(docs.map((d) => d.vendor?.id).filter((id): id is string => !!id))];
    const vendors = vendorIds.length ? await em.find(Vendor, { id: { $in: vendorIds } }) : [];
    const vendorName = new Map(vendors.map((v) => [v.id, v.name]));

    const byVendor = new Map<string, { vendorId: string; vendorName: string; count: number; baseTotal: string }>();
    let grand = '0';
    for (const d of docs) {
      if (!d.vendor) continue;
      const amount = d.baseTotalAmount ?? '0';
      const e =
        byVendor.get(d.vendor.id) ??
        { vendorId: d.vendor.id, vendorName: vendorName.get(d.vendor.id) ?? '', count: 0, baseTotal: '0' };
      e.count += 1;
      e.baseTotal = Money.add(e.baseTotal, amount);
      byVendor.set(d.vendor.id, e);
      grand = Money.add(grand, amount);
    }

    const sorted = [...byVendor.values()].sort((a, b) => Money.compare(b.baseTotal, a.baseTotal));
    let running = '0';
    return sorted.map((v) => {
      running = Money.add(running, v.baseTotal);
      const pct = Money.compare(grand, '0') === 0 ? 0 : (Number(running) / Number(grand)) * 100;
      return { ...v, cumulativePct: Math.round(pct * 10) / 10 };
    });
  }

  /**
   * Per-department budget utilization for the active company: consumed = Σ RESERVE − Σ RELEASE,
   * utilization% = consumed / amountTotal, aggregated across categories. Derived from the same
   * budget-balance groups (summed from budget_txn) so it can never disagree with them.
   *
   * ACTUAL is deliberately NOT added. It draws down a reservation already counted in Σ RESERVE
   * (invariant 3 — `settle` posts ACTUAL for the consumed amount and RELEASE only the unused
   * remainder), so `reserved + actual` counts every settled document twice and, by dropping
   * RELEASE, keeps the unused remainder of a partial receipt counted as consumed forever.
   *
   * `amountTotal − available` would also give the right number today and is the other trap: an
   * ADJUST_DECREASE or TRANSFER_OUT removes money from a budget that nobody consumed, so that form
   * goes wrong the moment a budget is adjusted or transferred. Σ RESERVE − Σ RELEASE is consumption
   * by definition — what documents took and did not give back — and needs to know about neither.
   */
  async budgetUtilization(f: BudgetBalanceQueryDto = {}): Promise<BudgetUtilizationRow[]> {
    const { groups } = await this.budgetBalanceByDeptCategory(f);
    const byDept = new Map<string, BudgetUtilizationRow & { reserved: string; released: string }>();
    for (const g of groups) {
      const e =
        byDept.get(g.departmentId) ??
        {
          departmentId: g.departmentId,
          departmentName: g.departmentName,
          amountTotal: '0',
          consumed: '0',
          available: '0',
          utilizationPct: null,
          reserved: '0',
          released: '0',
        };
      e.amountTotal = Money.add(e.amountTotal, g.amountTotal);
      e.available = Money.add(e.available, g.available);
      e.reserved = Money.add(e.reserved, g.reserved);
      e.released = Money.add(e.released, g.released);
      byDept.set(g.departmentId, e);
    }
    return [...byDept.values()]
      .map((e) => {
        const consumed = Money.subtract(e.reserved, e.released);
        const noBudget = Money.compare(e.amountTotal, '0') === 0;
        const pct = noBudget ? null : (Number(consumed) / Number(e.amountTotal)) * 100;
        return {
          departmentId: e.departmentId,
          departmentName: e.departmentName,
          amountTotal: e.amountTotal,
          consumed,
          available: e.available,
          utilizationPct: pct === null ? null : Math.round(pct * 10) / 10,
        };
      })
      // A department with no budget sorts to the TOP, not the bottom: it is the one most worth
      // looking at, and ordering it by a percentage it does not have would bury it.
      .sort((a, b) => {
        if (a.utilizationPct === null && b.utilizationPct === null) return 0;
        if (a.utilizationPct === null) return -1;
        if (b.utilizationPct === null) return 1;
        return b.utilizationPct - a.utilizationPct;
      });
  }

  /** Resolve user ids to {userId, username}, one query, preserving input order. */
  private async resolveUsernames(userIds: string[]): Promise<Array<{ userId: string; username: string }>> {
    const ids = [...new Set(userIds)];
    if (!ids.length) return [];
    const users = await this.em.find(AppUser, { id: { $in: ids } }, FILTER_OFF);
    const nameById = new Map(users.map((u) => [u.id, u.username]));
    return ids.map((id) => ({ userId: id, username: nameById.get(id) ?? id }));
  }
}

/** The larger of two (nullable) ages. */
function maxAge(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}
