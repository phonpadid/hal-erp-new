import {
  AccountRoleType,
  AccountType,
  AttendancePeriodStatus,
  ControlPolicy,
  DocCategory,
  Scope,
  TaxKind,
} from '../common/enums';
import { Account } from '../modules/accounting/accounting.entities';
import { AccountingPermissions } from '../modules/accounting/permissions';
import { Workflow, WorkflowStep } from '../modules/approval/approval.entities';
import { ApprovalPermissions } from '../modules/approval/permissions';
import { Budget, BudgetControlPoint } from '../modules/budget/budget.entities';
import { ToleranceLadder } from '../modules/budget/tolerance-ladder';
import { BudgetPermissions } from '../modules/budget/permissions';
import { AttendancePermissions } from '../modules/attendance/permissions';
import {
  WorkLocation,
  AttendancePeriod,
  WorkShift,
  WorkShiftDay,
} from '../modules/attendance/attendance.entities';
import { InventoryPermissions } from '../modules/inventory/permissions';
import { Warehouse } from '../modules/inventory/inventory.entities';
import { Currency, ExchangeRate } from '../modules/currency/currency.entities';
import { CurrencyPermissions } from '../modules/currency/permissions';
import { AccountRole } from '../modules/gl/gl.entities';
import { GlPermissions } from '../modules/gl/permissions';
import { TaxCode } from '../modules/tax/tax.entities';
import { JobLevel } from '../modules/job-level/job-level.entities';
import { TaxPermissions } from '../modules/tax/permissions';
import { JobLevelPermissions } from '../modules/job-level/permissions';
import {
  DeptDocType,
  DocumentCategory,
  DocumentType,
  DocumentTypeRef,
  FormField,
  FormTemplate,
} from '../modules/document/document.entities';
import { DocumentPermissions } from '../modules/document/permissions';
import { ExternalApiPermissions } from '../modules/external-api/permissions';
import {
  Item,
  ItemCompany,
  Vendor,
  VendorBankAccount,
  VendorCompany,
} from '../modules/master-data/master-data.entities';
import { MasterDataPermissions } from '../modules/master-data/permissions';
import {
  Company,
  Department,
  FiscalYear,
  HolidayCalendar,
} from '../modules/multi-company/multi-company.entities';
import { MultiCompanyPermissions } from '../modules/multi-company/permissions';
import { NotificationTemplate } from '../modules/notification/notification.entities';
import { NotificationPermissions } from '../modules/notification/permissions';
import { PaymentPermissions } from '../modules/payment-handoff/permissions';
import { Quota, QuotaEntitlement } from '../modules/quota/quota.entities';
import { LeaveType } from '../modules/attendance/attendance.entities';
import { QuotaPermissions } from '../modules/quota/permissions';
import { PasswordService } from '../modules/rbac/password.service';
import { RbacPermissions } from '../modules/rbac/permissions';
import { ReportingPermissions } from '../modules/reporting/permissions';
import {
  AppUser,
  Employee,
  Permission,
  Role,
  RolePermission,
  UserCompanyRole,
} from '../modules/rbac/rbac.entities';
import type { EntityManager } from '@mikro-orm/postgresql';

const FILTER_OFF = { filters: { company: false } } as const;

/** Demo password for all seeded accounts — DEMO ONLY, never for production. */
export const DEMO_PASSWORD = 'demo1234';

/**
 * The company code `seedDatabase` creates.
 *
 * Exported so DB-backed specs resolve the seeded company through this constant instead of
 * repeating a literal: the two drifted once already — the seed was renamed and fifteen specs kept
 * looking up a company that no longer existed, failing on every run until someone noticed.
 */
export const SEED_COMPANY_CODE = 'HAL';

/** Every permission code the guards actually check, sourced from the modules. */
function allPermissionCodes(): string[] {
  const sets = [
    MultiCompanyPermissions,
    RbacPermissions,
    MasterDataPermissions,
    AccountingPermissions,
    GlPermissions,
    TaxPermissions,
    JobLevelPermissions,
    AttendancePermissions,
    CurrencyPermissions,
    BudgetPermissions,
    InventoryPermissions,
    QuotaPermissions,
    DocumentPermissions,
    ApprovalPermissions,
    NotificationPermissions,
    PaymentPermissions,
    ReportingPermissions,
    ExternalApiPermissions,
  ];
  return [...new Set(sets.flatMap((s) => Object.values(s)))];
}

/** Find-or-create by natural key (idempotent). Reads ignore the company filter. */
async function upsert<T extends object>(
  em: EntityManager,
  entity: new (...args: any[]) => T,
  where: Record<string, unknown>,
  make: () => Partial<T>,
): Promise<T> {
  const found = await em.findOne(entity, where as any, FILTER_OFF);
  if (found) return found;
  const created = em.create(entity, make() as any);
  em.persist(created);
  return created;
}

/**
 * Idempotent demo baseline: permissions, a company + org, currencies, roles wired to
 * permissions, demo users, master data, document/workflow config, a budget + quota, and
 * notification templates — enough to log in and run a PR end to end. Never writes
 * append-only ledger rows. Re-running creates nothing new.
 */
/**
 * Reconcile the `permission` table to the codes the guards actually check.
 *
 * Lives apart from the rest of the seed because it is the one part of this file every environment
 * needs. A permission code is declared in TypeScript and named by a decorator, but it is only
 * grantable if a row exists: `listPermissions` reads the table, and `requirePermissions` rejects a
 * code it cannot resolve. Ship a slice without its rows and every endpoint behind them answers 403
 * to everyone, administrators included, with nothing in the product able to fix it.
 *
 * Additive on purpose. A row whose code no longer appears in the source is left alone — grants
 * referencing it stay valid, and an unattended command that runs on production should add what is
 * missing, not decide what should disappear.
 *
 * Writes nothing but `permission` rows. Everything else `seedDatabase` creates — a company, roles,
 * loginable demo users — must never reach an environment that did not ask for it.
 */
export async function syncPermissionCatalog(em: EntityManager): Promise<Map<string, Permission>> {
  const permByCode = new Map<string, Permission>();
  for (const code of allPermissionCodes()) {
    const perm = await upsert(em, Permission, { code }, () => ({
      code,
      name: code,
      module: code.split('_')[0],
      isActive: true,
    }));
    permByCode.set(code, perm);
  }
  await em.flush();
  return permByCode;
}

/** Codes declared in the source, for a caller comparing them against what an environment holds. */
export function declaredPermissionCodes(): string[] {
  return allPermissionCodes();
}

/**
 * Declared codes with no row in the given set, sorted.
 *
 * Extra rows are deliberately not reported: the catalog is additive, so a code retired from the
 * source keeps its row and its grants. Only an absence can break authorization.
 */
export function missingPermissionCodes(present: Iterable<string>): string[] {
  const have = new Set(present);
  return allPermissionCodes()
    .filter((code) => !have.has(code))
    .sort();
}

export async function seedDatabase(em: EntityManager): Promise<void> {
  const passwords = new PasswordService();
  const passwordHash = await passwords.hash(DEMO_PASSWORD);
  const year = new Date().getUTCFullYear();

  // 1. Permissions -----------------------------------------------------------
  const permByCode = await syncPermissionCatalog(em);

  // 2. Currencies + a rate ---------------------------------------------------
  const thb = await upsert(em, Currency, { code: 'THB' }, () => ({
    code: 'THB',
    name: 'Thai Baht',
    symbol: '฿',
    decimalPlaces: 2,
    isActive: true,
  }));
  const usd = await upsert(em, Currency, { code: 'USD' }, () => ({
    code: 'USD',
    name: 'US Dollar',
    symbol: '$',
    decimalPlaces: 2,
    isActive: true,
  }));
  const lak = await upsert(em, Currency, { code: 'LAK' }, () => ({
    code: 'LAK',
    name: 'Lao Kip',
    symbol: '₭',
    decimalPlaces: 0,
    isActive: true,
  }));
  await upsert(
    em,
    ExchangeRate,
    {
      company: null,
      fromCurrency: 'USD',
      toCurrency: 'THB',
      rateDate: `${year}-01-01`,
      rateType: 'DAILY',
    },
    () => ({
      company: undefined,
      fromCurrency: usd,
      toCurrency: thb,
      rate: '35',
      rateDate: `${year}-01-01`,
      rateType: 'DAILY',
    }),
  );

  // 3. Org -------------------------------------------------------------------
  const company = await upsert(em, Company, { code: SEED_COMPANY_CODE }, () => ({
    code: SEED_COMPANY_CODE,
    nameTh: 'HAL Co',
    nameEn: 'HAL Co',
    taxId: '0000000000000',
    branchCode: '00000',
    baseCurrency: lak,
    isActive: true,
    // How far back a time correction may reach, from the shift day being corrected. Stated here
    // rather than left to the column default so the demo shows it is a company's policy — it is
    // the same knob a real payroll close would tighten.
    correctionWindowDays: 30,
    createdAt: new Date(),
  }));
  const deptProc = await upsert(
    em,
    Department,
    { company: company.id, deptCode: 'PROC' },
    () => ({ company, deptCode: 'PROC', name: 'Procurement', isActive: true }),
  );
  await upsert(em, Department, { company: company.id, deptCode: 'HR' }, () => ({
    company,
    deptCode: 'HR',
    name: 'Human Resources',
    isActive: true,
  }));
  const fy = await upsert(
    em,
    FiscalYear,
    { company: company.id, year },
    () => ({
      company,
      year,
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
      status: 'OPEN',
    }),
  );
  await upsert(
    em,
    HolidayCalendar,
    { company: company.id, holidayDate: `${year}-12-31` },
    () => ({ company, holidayDate: `${year}-12-31`, name: "New Year's Eve" }),
  );

  // 3a. Attendance baseline — the hours the company expects, so the capture slice has something
  // to judge against. OFFICE is the ordinary Thai office week: 08:00-17:00 with an unpaid hour
  // at noon, Monday to Friday, fifteen minutes' grace before anyone is marked late.
  const officeShift = await upsert(
    em,
    WorkShift,
    { company: company.id, code: 'OFFICE' },
    () => ({
      company,
      code: 'OFFICE',
      name: 'Office 08:00-17:00',
      startMinute: 8 * 60,
      endMinute: 17 * 60,
      breakStartMinute: 12 * 60,
      breakEndMinute: 13 * 60,
      standardMinutes: 480,
      graceMinutes: 15,
      // Arrive after 12:00 and the morning is gone — half the shift.
      halfDayThresholdMinutes: 240,
      otMinMinutes: 30,
      otRoundMinutes: 30,
      isActive: true,
    }),
  );
  // Monday-Friday run the shift's own hours (null start/end = inherit), and Saturday is a half
  // day: same 08:00 start, out at 12:00. Sunday has no row at all, which is what makes it
  // non-working. This is the case a "which days" flag cannot express — Saturday differs in its
  // hours, not in whether it is worked — and it is why the pattern is a table.
  for (const weekday of [1, 2, 3, 4, 5]) {
    await upsert(em, WorkShiftDay, { workShift: officeShift.id, weekday }, () => ({
      workShift: officeShift,
      weekday,
      isWorking: true,
    }));
  }
  await upsert(em, WorkShiftDay, { workShift: officeShift.id, weekday: 6 }, () => ({
    workShift: officeShift,
    weekday: 6,
    isWorking: true,
    // start_minute stays null so it follows the shift; only the end is overridden.
    endMinute: 12 * 60,
  }));
  await upsert(
    em,
    WorkLocation,
    { company: company.id, code: 'HQ' },
    () => ({
      company,
      code: 'HQ',
      name: 'Head Office',
      // Coordinates as decimal STRINGS — never a JS number (money/geo rule).
      latitude: '13.756331',
      longitude: '100.501765',
      radiusMeters: 200,
      controlPolicy: ControlPolicy.SOFT_WARNING,
      isActive: true,
    }),
  );
  // Department default, so an employee with no individual assignment still resolves a shift.
  // Deliberately left as the ONLY source for the seeded employee: it exercises the fallback leg
  // of resolution, which an explicit assignment would hide.
  deptProc.defaultWorkShift = officeShift;

  // 3a-bis. Two attendance periods, so BOTH sides of every gate are visible in dev data: June is
  // closed, July is open. A correction into June is refused by name, one into July goes through,
  // and a punch that lands in June is still recorded but shows up in the closed-period read.
  const closedPeriod = await upsert(
    em,
    AttendancePeriod,
    { company: company.id, code: '2026-06' },
    () => ({
      company,
      code: '2026-06',
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
      status: AttendancePeriodStatus.CLOSED,
    }),
  );
  await upsert(em, AttendancePeriod, { company: company.id, code: '2026-07' }, () => ({
    company,
    code: '2026-07',
    periodStart: '2026-07-01',
    periodEnd: '2026-07-31',
    status: AttendancePeriodStatus.DRAFT,
  }));
  void closedPeriod;

  // 3b. Job levels — per-company position ladder (job_level.code referenced by
  // employee.job_level and workflow_step.condition_json). Ranks spaced so admins can reorder.
  for (const [jlCode, jlName, jlRank] of [
    ['STAFF', 'Staff', 10],
    ['SUPERVISOR', 'Supervisor', 20],
    ['MANAGER', 'Manager', 30],
    ['DIRECTOR', 'Director', 40],
    ['EXECUTIVE', 'Executive', 50],
  ] as const) {
    await upsert(em, JobLevel, { company: company.id, code: jlCode }, () => ({
      company,
      code: jlCode,
      name: jlName,
      rank: jlRank,
      isActive: true,
    }));
  }

  // 4. Roles + permission wiring --------------------------------------------
  const adminRole = await upsert(
    em,
    Role,
    { company: company.id, code: 'ADMIN' },
    () => ({ company, code: 'ADMIN', name: 'Administrator', isActive: true }),
  );
  const approverRole = await upsert(
    em,
    Role,
    { company: company.id, code: 'APPROVER' },
    () => ({ company, code: 'APPROVER', name: 'Approver', isActive: true }),
  );
  const requesterRole = await upsert(
    em,
    Role,
    { company: company.id, code: 'REQUESTER' },
    () => ({ company, code: 'REQUESTER', name: 'Requester', isActive: true }),
  );

  const grant = async (role: Role, codes: string[], scope: Scope) => {
    for (const code of codes) {
      const permission = permByCode.get(code)!;
      await upsert(
        em,
        RolePermission,
        { role: role.id, permission: permission.id },
        () => ({ role, permission, scope }),
      );
    }
  };
  // Group-consolidated reporting is meaningful only at GROUP scope. Grant it FIRST so the
  // bulk COMPANY grant below (upsert keyed by role+permission, first-write-wins) doesn't
  // downgrade it to COMPANY.
  await grant(adminRole, [ReportingPermissions.REPORT_GROUP_VIEW], Scope.GROUP);
  await grant(adminRole, allPermissionCodes(), Scope.COMPANY);
  await grant(
    approverRole,
    ['DOC_VIEW', 'DOC_APPROVE', 'BUDGET_VIEW', 'NOTIFICATION_VIEW'],
    Scope.COMPANY,
  );
  await grant(
    requesterRole,
    [
      'DOC_VIEW',
      'DOC_CREATE',
      'DOC_SUBMIT',
      'DOC_CANCEL',
      'MASTER_VIEW',
      'NOTIFICATION_VIEW',
      // Self-service attendance: punch as yourself and read your OWN days. Deliberately NOT
      // ATTEND_PUNCH_READ or ATTEND_DAY_READ — an ordinary employee sees their own attendance and
      // nobody else's, which is the whole reason the SELF codes exist. Leave and correction
      // requests need no attendance code at all: they are documents, and DOC_CREATE already covers
      // raising one.
      AttendancePermissions.ATTEND_PUNCH_SELF,
      AttendancePermissions.ATTEND_DAY_SELF,
    ],
    Scope.DEPARTMENT,
  );

  // 4b. Full approval-chain roles (ผู้สะเหนอใช้ requesterRole เดิม — เป็นคนสร้างเอกสาร ไม่ใช่ step).
  // แต่ละ role คือ 1 ขั้นในสาย: หัวหน้าแผนก → งบ → ประธาน → การเงิน → หน.การเงิน → บัญชี → หน.บัญชี.
  // authorize ด้วย permission code (DOC_APPROVE) ไม่ใช่ชื่อ role — invariant #5.
  const chainRoleDefs: Array<[string, string]> = [
    ['DEPT_HEAD', 'หัวหน้าแผนก'],
    ['BUDGET_OFFICER', 'งบประมาณ'],
    ['PRESIDENT', 'ประธาน'],
    ['FINANCE', 'การเงิน'],
    ['FINANCE_HEAD', 'หัวหน้าการเงิน'],
    ['ACCOUNTING', 'บัญชี'],
    ['ACCOUNTING_HEAD', 'หัวหน้าบัญชี'],
  ];
  const chainRoles = new Map<string, Role>();
  for (const [code, name] of chainRoleDefs) {
    const role = await upsert(em, Role, { company: company.id, code }, () => ({
      company,
      code,
      name,
      isActive: true,
    }));
    chainRoles.set(code, role);
    await grant(
      role,
      ['DOC_VIEW', 'DOC_APPROVE', 'BUDGET_VIEW', 'NOTIFICATION_VIEW'],
      Scope.COMPANY,
    );
  }

  // Finance does not only approve — it is the team that moves the money and then records that it
  // moved. Recording a settlement is gated on PAYMENT_MANAGE, so without this the only account
  // that could close out an approved compensation was the administrator, and the finance team got
  // a 403 on the very worklist built for them. Deliberately NOT granted: PAYMENT_SLIP_DELETE and
  // the batch permissions. A slip is the audit record of a payment; the ability to delete one is
  // a separate decision from the ability to record one.
  for (const code of ['FINANCE', 'FINANCE_HEAD']) {
    await grant(
      chainRoles.get(code)!,
      [PaymentPermissions.PAYMENT_VIEW, PaymentPermissions.PAYMENT_MANAGE],
      Scope.COMPANY,
    );
  }

  // 5. Users + assignments ---------------------------------------------------
  const mkUser = (username: string) =>
    upsert(em, AppUser, { username }, () => ({
      username,
      email: `${username}@demo.local`,
      passwordHash,
      status: 'ACTIVE',
      // Demo users are pre-verified so the seeded baseline is immediately loginable
      // (login rejects unverified emails — see RbacAuthService).
      emailVerifiedAt: new Date(),
      createdAt: new Date(),
    }));
  const admin = await mkUser('admin');
  const approver = await mkUser('approver');
  const requester = await mkUser('requester');
  const requesterEmp = await upsert(
    em,
    Employee,
    { company: company.id, empCode: 'EMP-REQ' },
    () => ({
      company,
      department: deptProc,
      user: requester,
      empCode: 'EMP-REQ',
      fullName: 'Demo Requester',
      jobLevel: 'STAFF',
      status: 'ACTIVE',
    }),
  );

  const assign = (user: AppUser, role: Role, isDefault: boolean) =>
    upsert(
      em,
      UserCompanyRole,
      { user: user.id, company: company.id, role: role.id },
      () => ({ user, company, department: deptProc, role, isDefault }),
    );
  await assign(admin, adminRole, true);
  await assign(approver, approverRole, true);
  await assign(requester, requesterRole, true);

  // 5b. Approval-chain approvers — one demo user per chain role, each a distinct person
  // from the requester so the 7-step chain routes end-to-end without hitting the
  // no-self-approval rule (invariant #8). Username = lower-cased role code.
  for (const [code] of chainRoleDefs) {
    const chainUser = await mkUser(code.toLowerCase());
    await assign(chainUser, chainRoles.get(code)!, true);
  }

  // 6. Master data -----------------------------------------------------------
  for (const [code, name, bankCode, accountNo] of [
    ['V001', 'Acme Supplies', 'BCEL', '0101234567'],
    ['V002', 'Globex Trading', 'LDB', '0209876543'],
  ]) {
    const vendor = await upsert(em, Vendor, { vendorCode: code }, () => ({
      vendorCode: code,
      name,
      paymentTermDays: 30,
      isActive: true,
    }));
    await upsert(
      em,
      VendorCompany,
      { vendor: vendor.id, company: company.id },
      () => ({
        vendor,
        company,
        isActive: true,
        approvedDate: `${year}-01-01`,
      }),
    );
    // A payee account per vendor, so the demo data can still submit a DISB — that type is
    // requires_payee, and without an account its submit is refused. `accountNo` is a string with a
    // leading zero on purpose: it is an identifier, and as a number the zero would vanish.
    await upsert(
      em,
      VendorBankAccount,
      { vendor: vendor.id, bankCode, accountNo },
      () => ({
        vendor,
        bankCode,
        accountNo,
        accountName: name,
        currency: lak,
        isPrimary: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
  }
  // I003 is stock-tracked so the inventory flow is exercisable end to end; the first two stay
  // untracked, which is also the regression guard that untracked items behave exactly as before.
  for (const [code, name, stockTracked] of [
    ['I001', 'A4 Paper', false],
    ['I002', 'Toner Cartridge', false],
    ['I003', 'Safety Helmet', true],
  ] as Array<[string, string, boolean]>) {
    const item = await upsert(em, Item, { itemCode: code }, () => ({
      itemCode: code,
      name,
      defaultUnit: 'ea',
      isStockTracked: stockTracked,
      isActive: true,
    }));
    // GL now lives per company on item_company (validated against the company chart).
    await upsert(
      em,
      ItemCompany,
      { item: item.id, company: company.id },
      () => ({ item, company, isActive: true, defaultGlAccount: '5000' }),
    );
  }

  // Warehouses for the seeded company. Two of them, so an inter-warehouse transfer is
  // exercisable without extra setup.
  for (const [code, name] of [
    ['MAIN', 'Main store'],
    ['SITE', 'Site store'],
  ]) {
    await upsert(em, Warehouse, { company: company.id, code }, () => ({
      company,
      code,
      name,
      isActive: true,
    }));
  }

  // 7. Document config -------------------------------------------------------
  const workflow = await upsert(
    em,
    Workflow,
    { company: company.id, name: 'Standard Approval' },
    () => ({ company, name: 'Standard Approval', isActive: true }),
  );
  await upsert(em, WorkflowStep, { workflow: workflow.id, stepNo: 1 }, () => ({
    workflow,
    stepNo: 1,
    stepName: 'Approver',
    approverRole,
    approveMode: 'SEQUENTIAL',
    slaHours: 24,
  }));

  // Full 7-step approval chain. step_no = ลำดับส่งต่อ; SEQUENTIAL = อนุมัติทีละขั้น.
  const chainWorkflow = await upsert(
    em,
    Workflow,
    { company: company.id, name: 'Full Approval Chain' },
    () => ({ company, name: 'Full Approval Chain', isActive: true }),
  );
  const chainSteps: Array<[number, string, string]> = [
    [1, 'DEPT_HEAD', 'หัวหน้าแผนก'],
    [2, 'BUDGET_OFFICER', 'งบประมาณ'],
    [3, 'PRESIDENT', 'ประธาน'],
    [4, 'FINANCE', 'การเงิน'],
    [5, 'FINANCE_HEAD', 'หัวหน้าการเงิน'],
    [6, 'ACCOUNTING', 'บัญชี'],
    [7, 'ACCOUNTING_HEAD', 'หัวหน้าบัญชี'],
  ];
  for (const [stepNo, roleCode, stepName] of chainSteps) {
    await upsert(
      em,
      WorkflowStep,
      { workflow: chainWorkflow.id, stepNo },
      () => ({
        workflow: chainWorkflow,
        stepNo,
        stepName,
        approverRole: chainRoles.get(roleCode)!,
        approveMode: 'SEQUENTIAL',
        slaHours: 24,
      }),
    );
  }

  /**
   * The journal-voucher route, banded by amount.
   *
   * A voucher is the only way a person writes the ledger directly, so it is checked by somebody
   * else — and how MANY somebodies depends on how much it moves. Both steps engage below the
   * threshold's ceiling and above its floor respectively, so a small voucher takes one approval and
   * a large one takes two.
   *
   * The figure is a working DEFAULT and nothing more. It lives in `workflow_step.amount_min`, which
   * means a company sets its own materiality limit by editing configuration — not by deploying, and
   * not by asking anyone to change code. That is the whole reason vouchers were moved onto this
   * engine instead of growing a ladder of their own.
   */
  const JV_SECOND_APPROVAL_FROM = '10000000.00';
  const voucherWorkflow = await upsert(
    em,
    Workflow,
    { company: company.id, name: 'Journal Voucher Approval' },
    () => ({ company, name: 'Journal Voucher Approval', isActive: true }),
  );
  const voucherSteps: Array<[number, string, string, string | undefined]> = [
    [1, 'ACCOUNTING', 'บัญชี', undefined],
    [2, 'ACCOUNTING_HEAD', 'หัวหน้าบัญชี', JV_SECOND_APPROVAL_FROM],
  ];
  for (const [stepNo, roleCode, stepName, amountMin] of voucherSteps) {
    await upsert(
      em,
      WorkflowStep,
      { workflow: voucherWorkflow.id, stepNo },
      () => ({
        workflow: voucherWorkflow,
        stepNo,
        stepName,
        approverRole: chainRoles.get(roleCode)!,
        approveMode: 'SEQUENTIAL',
        amountMin,
        slaHours: 24,
      }),
    );
  }

  // Document categories are company-scoped config (document_category); seed the canonical set so
  // the config UI has options and document_type.category codes resolve to a real category.
  for (const [code, name] of [
    [DocCategory.PROCUREMENT, 'Procurement'],
    [DocCategory.FINANCE, 'Finance'],
    [DocCategory.HR, 'HR'],
    [DocCategory.ADMIN, 'Admin'],
    [DocCategory.IT, 'IT'],
  ] as const) {
    await upsert(em, DocumentCategory, { company: company.id, code }, () => ({
      company,
      code,
      name,
      isActive: true,
    }));
  }

  const docTypes: Array<[string, string, DocCategory, Partial<DocumentType>]> =
    [
      [
        'PR',
        'Purchase Requisition',
        DocCategory.PROCUREMENT,
        {
          requiresBudget: true,
          requiresVendor: true,
          postAction: 'CUT_BUDGET',
        },
      ],
      // The entry no event produces: depreciation, an accrual, opening balances, a correction.
      // Every flag stays false — a voucher reserves no budget and no quota, names no vendor, no
      // payee, no item and no warehouse — and POST_JOURNAL is what makes full approval write the
      // ledger. Its content is `journal_voucher`, not `document_line`: a voucher line has a side,
      // and the document's total (Σ debits) is what the amount bands above compare against.
      ['JV', 'Journal Voucher', DocCategory.FINANCE, { postAction: 'POST_JOURNAL' }],
      // A compensation owed to a PERSON — a customer claim, a staff reimbursement. It accrues at
      // approval because the obligation arises then: the claimant is owed whether the transfer
      // happens today or in three weeks. It names no vendor, which is what makes its accrual credit
      // CLAIM_PAYABLE rather than the trade payable, and it therefore names no payee bank account —
      // it is paid by hand, with the evidence attached to the record.
      //
      // Seeded so the flow that pays a person is reachable on a fresh install. A path only tests can
      // reach is one whose tests are the only thing holding it up.
      [
        'CLAIM',
        'Compensation Claim',
        DocCategory.FINANCE,
        { requiresBudget: true, accruesOnApproval: true },
      ],
      ['MEMO', 'Memo', DocCategory.ADMIN, {}],
      // derivesQuantity: leave days are counted from the shift and the holiday calendar, never
      // stated by a caller — so the generic submit endpoint refuses this type and it may only be
      // submitted through POST /leave-requests/:documentId/submit.
      ['LEAVE', 'Leave Request', DocCategory.HR, { requiresQuota: true, derivesQuantity: true }],
      // Overtime certification. derivesQuantity for the same reason as leave: the hours are summed
      // from attendance_day, never stated by the claimant. requiresQuota stays FALSE — the
      // statutory weekly ceiling is what binds, and an OT quota is a company's own optional budget.
      ['OT', 'Overtime Claim', DocCategory.HR, { derivesQuantity: true }],
      // Time correction. NOT derivesQuantity: a correction carries no quantity at all — it names a
      // punch. Nothing is reserved and nothing is counted, so the generic submit path is exactly
      // right for it, and approval is what writes the corrective event into the ledger.
      ['TCORR', 'Time Correction', DocCategory.HR, {}],
      // Procurement chain: PROC reserves + auto-creates a PO (CREATE_SUCCESSOR); the PO commits;
      // a DISB references the PO, is 3-way matched at submit, and settles the reservation
      // (CUT_BUDGET) on approval — then appears in the ready-to-pay queue.
      [
        'PROC',
        'Procurement Requisition',
        DocCategory.PROCUREMENT,
        { requiresBudget: true, requiresVendor: true, postAction: 'CREATE_SUCCESSOR' },
      ],
      [
        'PO',
        'Purchase Order',
        DocCategory.PROCUREMENT,
        { requiresVendor: true },
      ],
      [
        'DISB',
        'Disbursement',
        DocCategory.FINANCE,
        // requiresPayee — a disbursement names the account the money goes to, and that choice
        // rides the approval chain with the amount. PR stays false on purpose: it also carries
        // CUT_BUDGET, but nobody knows the payee when raising a requisition.
        //
        // accruesOnApproval — the disbursement IS the accepted invoice: three-way matching has
        // passed, the FX rate is locked and the budget has settled to ACTUAL, so the obligation to
        // the vendor is certain and belongs in the books now rather than when the cash moves. It
        // credits ACCOUNTS_PAYABLE because the document carries a vendor, and the payment then
        // clears that payable instead of debiting expense a second time. PR and PO deliberately do
        // NOT accrue: a requisition and an order are commitments, not liabilities.
        {
          requiresVendor: true,
          requiresPayee: true,
          postAction: 'CUT_BUDGET',
          accruesOnApproval: true,
        },
      ],
      // HR documents: on approval the post-action updates the related employee (promotion) or
      // closes them + revokes this company's roles (resignation), at the effective date.
      [
        'PROMOTE',
        'Promotion',
        DocCategory.HR,
        { postAction: 'UPDATE_EMPLOYEE' },
      ],
      [
        'RESIGN',
        'Resignation',
        DocCategory.HR,
        { postAction: 'TERMINATE_EMPLOYEE' },
      ],
      // Budget adjustment as an approvable document — direction is config (post_action),
      // executed by the post-action on full approval. Routable via the deptProc mapping below.
      [
        'BUDGET_ADJ_INC',
        'Budget Adjustment (Increase)',
        DocCategory.FINANCE,
        { postAction: 'ADJUST_INCREASE' },
      ],
      [
        'BUDGET_ADJ_DEC',
        'Budget Adjustment (Decrease)',
        DocCategory.FINANCE,
        { postAction: 'ADJUST_DECREASE' },
      ],
      // Budget transfer as an approvable document — the paired TRANSFER_OUT/IN is written
      // by the post-action on full approval. Content (from/to budget, amount, reason) is
      // carried on budget_movement via the budget Transfer dialog, not the generic form.
      [
        'BUDGET_TRANSFER',
        'Budget Transfer',
        DocCategory.FINANCE,
        { postAction: 'TRANSFER' },
      ],
      // A budget plan proposes budgets for a fiscal year; approving it is what puts them in force.
      // requiresBudget stays false — a plan proposes budget, it does not consume any, so
      // submitting one must take no reservation. Its lines live on budget_movement, like the other
      // two budget document types.
      [
        'BUDGET_PLAN',
        'Budget Plan',
        DocCategory.FINANCE,
        { postAction: 'ACTIVATE_BUDGET' },
      ],
      // Stock movements are ordinary configured documents (invariant 7): they inherit workflow
      // routing, forms, approval_log and the reject/cancel release hook rather than owning code.
      // Each requires a warehouse and an item on every line — a movement with neither has nothing
      // to move and nowhere to move it.
      [
        'ISSUE',
        'Goods Issue',
        DocCategory.ADMIN,
        { requiresItem: true, requiresWarehouse: true, postAction: 'ISSUE_STOCK' },
      ],
      [
        'STOCK_ADJ',
        'Stock Adjustment',
        DocCategory.ADMIN,
        { requiresItem: true, requiresWarehouse: true, postAction: 'ADJUST_STOCK' },
      ],
      [
        'STOCK_XFER',
        'Stock Transfer',
        DocCategory.ADMIN,
        { requiresItem: true, requiresWarehouse: true, postAction: 'TRANSFER_STOCK' },
      ],
    ];
  const typeByCode = new Map<string, DocumentType>();
  for (const [code, name, category, flags] of docTypes) {
    const dt = await upsert(em, DocumentType, { code }, () => ({
      company,
      code,
      name,
      category,
      requiresBudget: false,
      requiresQuota: false,
      requiresVendor: false,
      isActive: true,
      ...flags,
    }));
    typeByCode.set(code, dt);
    const tmpl = await upsert(
      em,
      FormTemplate,
      { documentType: dt.id, version: 1 },
      () => ({
        documentType: dt,
        version: 1,
        status: 'PUBLISHED',
        createdAt: new Date(),
      }),
    );
    // Budget movement documents (adjustment / transfer / plan) carry their content on
    // budget_movement (created via the budget Adjust / Transfer dialog, or plan intake), not the
    // generic form — so they get a published template with no required fields. Other types get
    // the required `reason` field.
    // POST_JOURNAL joins them: a voucher's content is its lines and their two sides, which the
    // generic form cannot render and the bespoke voucher screen does — so it gets a published
    // template with no required fields, like the budget movements.
    const movementDriven =
      flags.postAction === 'TRANSFER' ||
      flags.postAction === 'ACTIVATE_BUDGET' ||
      flags.postAction === 'POST_JOURNAL' ||
      flags.postAction?.startsWith('ADJUST');
    // HR documents carry the well-known fields the post-action reads (the HR form-field contract).
    const hrFields: Record<string, Array<[string, string]>> = {
      UPDATE_EMPLOYEE: [
        ['new_position', 'New position'],
        ['new_salary', 'New salary'],
        ['new_job_level', 'New job level'],
        ['effective_date', 'Effective date'],
      ],
      TERMINATE_EMPLOYEE: [['effective_date', 'Effective date']],
    };
    const isHr = !!flags.postAction && flags.postAction in hrFields;
    if (isHr) {
      let order = 0;
      for (const [fieldName, fieldLabel] of hrFields[flags.postAction!]) {
        const fn = fieldName;
        const fl = fieldLabel;
        const so = order++;
        await upsert(
          em,
          FormField,
          { formTemplate: tmpl.id, fieldName: fn },
          () => ({
            formTemplate: tmpl,
            fieldName: fn,
            fieldLabel: fl,
            fieldType: fn === 'effective_date' ? 'date' : 'text',
            isRequired: false,
            sortOrder: so,
          }),
        );
      }
    } else if (!movementDriven) {
      await upsert(
        em,
        FormField,
        { formTemplate: tmpl.id, fieldName: 'reason' },
        () => ({
          formTemplate: tmpl,
          fieldName: 'reason',
          fieldLabel: 'Reason',
          fieldType: 'text',
          isRequired: true,
          sortOrder: 0,
        }),
      );
    }
    // PR วิ่งสายอนุมัติ 7 ขั้น (Full Approval Chain); JV วิ่งสายที่แบ่งขั้นตามวงเงิน;
    // type อื่นใช้ Standard Approval.
    const routedWorkflow =
      code === 'PR' ? chainWorkflow : code === 'JV' ? voucherWorkflow : workflow;
    await upsert(
      em,
      DeptDocType,
      { department: deptProc.id, documentType: dt.id },
      () => ({
        department: deptProc,
        documentType: dt,
        formTemplate: tmpl,
        workflow: routedWorkflow,
        isActive: true,
      }),
    );
  }

  // Reference-chain pairings (document_type_ref) — predecessor→successor, per company.
  // Replaces the old hardcoded REF_CHAIN: PROC/PR → PO, PO → DISB, ADVANCE → CLEAR_ADVANCE.
  // Skips any pairing whose types this company doesn't have (e.g. no ADVANCE/CLEAR_ADVANCE here).
  // `autoCreate` = the CREATE_SUCCESSOR post-action auto-creates this successor on approval; only
  // PROC→PO is auto (PROC is the CREATE_SUCCESSOR type), the rest are manual create-from.
  // `successorDepartment` = the department an auto-created successor lands in; null means the
  // source document's own department. PROC→PO names Procurement explicitly: the requesting
  // department asks, the buying department buys, so the PO must not follow whoever raised the
  // requisition. Only auto_create reads it — a manual create-from takes the creating user's dept.
  const refPairs: Array<[string, string, boolean, Department | undefined]> = [
    ['PR', 'PO', false, undefined],
    ['PROC', 'PO', true, deptProc],
    ['PO', 'DISB', false, undefined],
    ['ADVANCE', 'CLEAR_ADVANCE', false, undefined],
  ];
  for (const [predecessorCode, successorCode, autoCreate, successorDepartment] of refPairs) {
    const predecessorType = typeByCode.get(predecessorCode);
    const successorType = typeByCode.get(successorCode);
    if (!predecessorType || !successorType) continue;
    await upsert(
      em,
      DocumentTypeRef,
      {
        company: company.id,
        predecessorType: predecessorType.id,
        successorType: successorType.id,
      },
      () => ({ company, predecessorType, successorType, autoCreate, successorDepartment }),
    );
  }

  // 8. Chart of accounts -----------------------------------------------------
  // Minimal standard chart per company; '5000' matches the seeded budget below. '1000',
  // '4900', '7100' back the GL system-account roles (cash clearing, FX gain, FX loss), and
  // '1300' / '2150' / '5900' back the inventory ones — without them every stock movement
  // commits but its posting is skipped and logged, which reads like a silent failure.
  const chart: Array<[string, string, AccountType]> = [
    ['1000', 'Cash', AccountType.ASSET],
    // The account the BANK's balance lives in is `1000`; `1010` is where a payment sits between
    // being recorded and the bank confirming it left. CASH_CLEARING points at the second, which is
    // what makes the clearing balance the reconciling item.
    ['1010', 'Cash Clearing', AccountType.ASSET],
    // Filed input VAT: what the revenue authority owes once a return goes in. Input VAT before
    // filing is tax paid on purchases; after filing it is a debt somebody owes.
    ['1320', 'VAT Receivable', AccountType.ASSET],
    ['1150', 'Input VAT', AccountType.ASSET],
    ['1300', 'Inventory', AccountType.ASSET],
    ['2000', 'Accounts Payable', AccountType.LIABILITY],
    ['2150', 'Goods Received Not Invoiced', AccountType.LIABILITY],
    ['2200', 'Accrued Expenses', AccountType.LIABILITY],
    // Owed to a person: an approved compensation or reimbursement, until it is paid.
    ['2300', 'Claims Payable', AccountType.LIABILITY],
    ['5900', 'Inventory Adjustment', AccountType.EXPENSE],
    ['2100', 'WHT Payable', AccountType.LIABILITY],
    ['3000', 'Owner Equity', AccountType.EQUITY],
    ['3200', 'Retained Earnings', AccountType.EQUITY],
    ['4000', 'Revenue', AccountType.REVENUE],
    ['4900', 'FX Gain', AccountType.REVENUE],
    ['5000', 'Office Supplies Expense', AccountType.EXPENSE],
    ['7100', 'FX Loss', AccountType.EXPENSE],
  ];
  const accountByCode = new Map<string, Account>();
  for (const [code, name, accountType] of chart) {
    const account = await upsert(
      em,
      Account,
      { company: company.id, code },
      () => ({
        company,
        code,
        name,
        accountType,
        isPostable: true,
        isActive: true,
      }),
    );
    accountByCode.set(code, account);
  }

  // GL system-account role map: the posting engine resolves these by role (invariant 7).
  const roleMap: Array<[AccountRoleType, string]> = [
    [AccountRoleType.CASH_CLEARING, '1010'],
    [AccountRoleType.VAT_RECEIVABLE, '1320'],
    [AccountRoleType.FX_GAIN, '4900'],
    [AccountRoleType.FX_LOSS, '7100'],
    [AccountRoleType.VAT_INPUT, '1150'],
    [AccountRoleType.WHT_PAYABLE, '2100'],
    [AccountRoleType.INVENTORY, '1300'],
    [AccountRoleType.GRNI, '2150'],
    [AccountRoleType.INVENTORY_ADJUSTMENT, '5900'],
    // '2000' has existed unmapped since the chart was seeded; it is the trade payable a purchase
    // that accrues at approval credits. Deliberately its own account, not shared with GRNI (2150)
    // or WHT_PAYABLE (2100): two roles on one account makes both balances unreadable.
    [AccountRoleType.ACCOUNTS_PAYABLE, '2000'],
    // Its own account, not GRNI's (2150) or AP's (2000): two roles on one account makes both
    // balances unreadable, and this one is read every month end.
    [AccountRoleType.ACCRUED_EXPENSE, '2200'],
    // What is owed to a PERSON between approving their claim and paying it — a compensation, a
    // reimbursement. Its own account, not the trade payable's (2000): the two are reported
    // separately ("trade and other payables"), and one account for both makes each unreadable.
    // Mapped here rather than left to each company: without it a claim cannot be accrued at all,
    // and the flow that pays a person would be specified and unreachable on a fresh install.
    [AccountRoleType.CLAIM_PAYABLE, '2300'],
    [AccountRoleType.RETAINED_EARNINGS, '3200'],
  ];
  for (const [role, code] of roleMap) {
    await upsert(em, AccountRole, { company: company.id, role }, () => ({
      company,
      role,
      account: accountByCode.get(code)!,
    }));
  }

  // Default Thai purchase tax codes: VAT 7% and the common WHT rates (3% services, 5% rent).
  const taxCodes: Array<[string, string, TaxKind, string]> = [
    ['VAT7', 'VAT 7%', TaxKind.VAT, '0.07'],
    ['WHT3', 'WHT 3%', TaxKind.WHT, '0.03'],
    ['WHT5', 'WHT 5%', TaxKind.WHT, '0.05'],
  ];
  for (const [code, name, kind, rate] of taxCodes) {
    await upsert(em, TaxCode, { company: company.id, code }, () => ({
      company,
      code,
      name,
      kind,
      rate,
      isActive: true,
    }));
  }

  // 9. Budget + quota --------------------------------------------------------
  // Written ACTIVE directly, as a grandfathered row. Budgets now reach ACTIVE only by approving a
  // budget plan, but seeding one would mean seeding a document, a routing, and an approval nobody
  // gave — a fictional signature in approval_log, which is append-only. A row that predates plans
  // and says so is honest; a manufactured approval is not.
  await upsert(
    em,
    Budget,
    { fiscalYear: fy.id, department: deptProc.id, glAccount: '5000' },
    () => ({
      fiscalYear: fy,
      department: deptProc,
      glAccount: '5000',
      account: accountByCode.get('5000'),
      budgetName: 'Office Supplies',
      amountTotal: '1000000',
      status: 'ACTIVE',
    }),
  );

  // Every ACTIVE budget must be governed by a control point, or its spending is never checked and
  // nothing says so. The migration seeds one per budget that already existed; a budget created
  // here, on a database seeded after migrating, has none — so it gets its own, self-scoped and
  // blocking at its ceiling, which is what BudgetService.create mints for the same situation.
  await upsert(
    em,
    BudgetControlPoint,
    {
      company: company.id,
      fiscalYear: fy.id,
      accountNode: accountByCode.get('5000')?.id,
      departmentNode: deptProc.id,
    },
    () => ({
      company,
      fiscalYear: fy,
      accountNode: accountByCode.get('5000'),
      departmentNode: deptProc,
      capAmount: undefined,
      toleranceJson: ToleranceLadder.stringify(ToleranceLadder.BLOCK_AT_CEILING),
      isActive: true,
    }),
  );

  // Backfill: link any budget whose account_id is still null to the seeded account
  // matching its gl_account within the same company. Unmatched codes stay null (logged).
  await em.flush();
  const unlinked = await em.find(
    Budget,
    { account: null, fiscalYear: { company: company.id } },
    { ...FILTER_OFF, populate: ['fiscalYear'] },
  );
  for (const b of unlinked) {
    const account = accountByCode.get(b.glAccount);
    if (account) b.account = account;
    else
      console.warn(
        `[seed] budget ${b.id} gl_account '${b.glAccount}' has no matching account; left unlinked`,
      );
  }
  const quota = await upsert(
    em,
    Quota,
    { company: company.id, quotaType: 'ANNUAL_LEAVE' },
    () => ({
      company,
      department: deptProc,
      quotaType: 'ANNUAL_LEAVE',
      unit: 'day',
      limitValue: '0',
      resetCycle: 'YEARLY',
      isActive: true,
    }),
  );
  await upsert(
    em,
    QuotaEntitlement,
    { quota: quota.id, employee: requesterEmp.id, year },
    () => ({
      quota,
      employee: requesterEmp,
      year,
      entitledValue: '12',
      carriedOver: '0',
      adjusted: '0',
    }),
  );

  // 8b. Leave: two quotas whose policies contrast, so the difference is visible in the data --
  // ANNUAL_LEAVE keeps HARD_STOP and is fully paid — gone is gone.
  // SICK_LEAVE is SOFT_WARNING with a paid ceiling below its limit, because Thai law entitles an
  // employee to sick leave for as long as they are genuinely ill while paying for at most 30 days
  // a year. A quota that blocked at the paid ceiling would contradict the law rather than apply it.
  const sickQuota = await upsert(
    em,
    Quota,
    { company: company.id, quotaType: 'SICK_LEAVE' },
    () => ({
      company,
      quotaType: 'SICK_LEAVE',
      unit: 'day',
      limitValue: '90',
      paidLimitValue: '30',
      resetCycle: 'YEARLY',
      controlPolicy: ControlPolicy.SOFT_WARNING,
      isActive: true,
    }),
  );
  await upsert(em, QuotaEntitlement, { quota: sickQuota.id, employee: requesterEmp.id, year }, () => ({
    quota: sickQuota,
    employee: requesterEmp,
    year,
    entitledValue: '90',
    carriedOver: '0',
    adjusted: '0',
  }));

  // Leave-type rules. They differ per kind, which is why they live here and not on `quota`:
  // sick leave may be reported on return and wants a certificate past three days; annual leave
  // needs a day's notice and no document at all.
  await upsert(em, LeaveType, { quota: quota.id }, () => ({
    quota,
    advanceNoticeDays: 1,
    backdateLimitDays: 0,
    isActive: true,
  }));
  await upsert(em, LeaveType, { quota: sickQuota.id }, () => ({
    quota: sickQuota,
    advanceNoticeDays: 0,
    backdateLimitDays: 30,
    attachmentRequiredOverDays: 3,
    isActive: true,
  }));

  // 9. Notification templates ------------------------------------------------
  const templates: Array<[string, string, string]> = [
    [
      'DOC_PENDING_APPROVAL',
      'Pending approval',
      'Document {doc_no} from {requester_name} awaits your approval.',
    ],
    ['DOC_REJECTED', 'Document rejected', 'Document {doc_no} was rejected.'],
    [
      'DOC_COMPLETED',
      'Document approved',
      'Document {doc_no} has been approved.',
    ],
    [
      'SLA_OVERDUE',
      'Approval overdue',
      'Document {doc_no} is overdue for approval.',
    ],
  ];
  for (const [code, subject, body] of templates) {
    await upsert(em, NotificationTemplate, { code }, () => ({
      code,
      channel: 'IN_APP',
      subjectTemplate: subject,
      bodyTemplate: body,
      isActive: true,
    }));
  }

  await em.flush();
}
