import type { RouteRecordRaw } from 'vue-router';

// Route components are lazy-loaded so vue-router code-splits each view into its own
// chunk, keeping the initial bundle small. CreateDocumentView is shared by the
// new/edit routes; the loader is defined once so both reuse the same chunk.
//
// This module is intentionally free of side effects (it does NOT create the router or
// touch browser history), so the route table can be imported and asserted on in unit
// tests without pulling in `createWebHistory()`.
const AppLayout = () => import('../layouts/AppLayout.vue');
const LoginView = () => import('../views/LoginView.vue');
const ForgotPasswordView = () => import('../views/auth/ForgotPasswordView.vue');
const CheckEmailView = () => import('../views/auth/CheckEmailView.vue');
const ResetPasswordView = () => import('../views/auth/ResetPasswordView.vue');
const VerifyEmailView = () => import('../views/auth/VerifyEmailView.vue');
const SelectCompanyView = () => import('../views/SelectCompanyView.vue');
const DashboardView = () => import('../views/DashboardView.vue');
const ProfileView = () => import('../views/ProfileView.vue');
const ApprovalInboxView = () => import('../views/approvals/ApprovalInboxView.vue');
const ReadyToPayView = () => import('../views/payments/ReadyToPayView.vue');
const SettlementsView = () => import('../views/settlements/SettlementsView.vue');
const PaymentBatchesView = () => import('../views/payments/PaymentBatchesView.vue');
const PaymentBatchDetailView = () => import('../views/payments/PaymentBatchDetailView.vue');
const BudgetDetailView = () => import('../views/budgets/BudgetDetailView.vue');
const BudgetFormView = () => import('../views/budgets/BudgetFormView.vue');
const BudgetListView = () => import('../views/budgets/BudgetListView.vue');
const ControlPointListView = () => import('../views/budgets/ControlPointListView.vue');
const ControlPointDetailView = () => import('../views/budgets/ControlPointDetailView.vue');
const CreateDocumentView = () => import('../views/documents/CreateDocumentView.vue');
const DocumentDetailView = () => import('../views/documents/DocumentDetailView.vue');
const MyDocumentsView = () => import('../views/documents/MyDocumentsView.vue');
const ApprovalConfigView = () => import('../views/admin/ApprovalConfigView.vue');
const CurrencyAdminView = () => import('../views/admin/CurrencyAdminView.vue');
const AccountsAdminView = () => import('../views/admin/AccountsAdminView.vue');
const JournalView = () => import('../views/JournalView.vue');
const TaxCodesAdminView = () => import('../views/admin/TaxCodesAdminView.vue');
const JobLevelsAdminView = () => import('../views/admin/JobLevelsAdminView.vue');
const TaxSummaryView = () => import('../views/TaxSummaryView.vue');
const DocTypesView = () => import('../views/admin/doc-config/DocTypesView.vue');
const DocTypeFormView = () => import('../views/admin/doc-config/DocTypeFormView.vue');
const DocCategoriesView = () => import('../views/admin/doc-config/DocCategoriesView.vue');
const FormTemplatesView = () => import('../views/admin/doc-config/FormTemplatesView.vue');
const DeptMappingsView = () => import('../views/admin/doc-config/DeptMappingsView.vue');
const WorkflowsView = () => import('../views/admin/doc-config/WorkflowsView.vue');
const WorkflowDetailView = () => import('../views/admin/doc-config/WorkflowDetailView.vue');
const WorkflowStepCreateView = () => import('../views/admin/doc-config/WorkflowStepCreateView.vue');
const EmployeeAdminView = () => import('../views/admin/EmployeeAdminView.vue');
const EmployeeCreateView = () => import('../views/admin/EmployeeCreateView.vue');
const EmployeeOnboardView = () => import('../views/admin/EmployeeOnboardView.vue');
const CompaniesView = () => import('../views/admin/org/CompaniesView.vue');
const CompanyFormView = () => import('../views/admin/org/CompanyFormView.vue');
const DepartmentsView = () => import('../views/admin/org/DepartmentsView.vue');
const FiscalYearsView = () => import('../views/admin/org/FiscalYearsView.vue');
const HolidaysView = () => import('../views/admin/org/HolidaysView.vue');
const RbacAdminView = () => import('../views/admin/RbacAdminView.vue');
const ApiKeysAdminView = () => import('../views/admin/ApiKeysAdminView.vue');
const MasterDataView = () => import('../views/master/MasterDataView.vue');
const NotificationInboxView = () => import('../views/notifications/NotificationInboxView.vue');
const StockOnHandView = () => import('../views/inventory/StockOnHandView.vue');
const WarehousesAdminView = () => import('../views/admin/WarehousesAdminView.vue');
const MyAttendanceView = () => import('../views/attendance/MyAttendanceView.vue');
const AttendancePeriodsView = () => import('../views/attendance/AttendancePeriodsView.vue');
const AttendancePeriodDetailView = () => import('../views/attendance/AttendancePeriodDetailView.vue');
const TeamAttendanceView = () => import('../views/attendance/TeamAttendanceView.vue');
const PunchLedgerView = () => import('../views/attendance/PunchLedgerView.vue');
const MyDaysView = () => import('../views/attendance/MyDaysView.vue');
const RequestLeaveView = () => import('../views/attendance/RequestLeaveView.vue');
const RequestCorrectionView = () => import('../views/attendance/RequestCorrectionView.vue');
const QuotaDetailView = () => import('../views/quota/QuotaDetailView.vue');
const QuotaListView = () => import('../views/quota/QuotaListView.vue');
const QuotaAdminView = () => import('../views/admin/QuotaAdminView.vue');
const QuotaAdminDetailView = () => import('../views/admin/QuotaAdminDetailView.vue');
const BudgetBalanceReport = () => import('../views/reports/BudgetBalanceReport.vue');
const BudgetUtilizationReport = () => import('../views/reports/BudgetUtilizationReport.vue');
const DocumentSummaryReport = () => import('../views/reports/DocumentSummaryReport.vue');
const SpendByVendorReport = () => import('../views/reports/SpendByVendorReport.vue');
const ApprovalAgingReport = () => import('../views/reports/ApprovalAgingReport.vue');
const QuotaRemainingReport = () => import('../views/reports/QuotaRemainingReport.vue');
const BudgetAuditReport = () => import('../views/reports/BudgetAuditReport.vue');
const GroupBudgetReport = () => import('../views/reports/GroupBudgetReport.vue');
const TrialBalanceReport = () => import('../views/reports/TrialBalanceReport.vue');
const IncomeStatementReport = () => import('../views/reports/IncomeStatementReport.vue');
const BalanceSheetReport = () => import('../views/reports/BalanceSheetReport.vue');
const AccountLedgerReport = () => import('../views/reports/AccountLedgerReport.vue');

/**
 * One breadcrumb ancestor declared on a route's meta. `{ nav }` references a NAV
 * entry by key (reusing its label, link, and permission); the object form is an
 * explicit crumb (e.g. "New" / "Edit"). The current page is not listed here — it is
 * the derived leaf (a NAV entry, the last explicit crumb, or a page's dynamic crumb).
 */
export type BreadcrumbCrumb =
  | { nav: string }
  | { labelKey: string; to?: string; permission?: string };

declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean;
    requiresCompany?: boolean;
    permission?: string;
    breadcrumb?: BreadcrumbCrumb[];
  }
}

export const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: LoginView, meta: { public: true } },
  // Public self-service password reset (no auth).
  { path: '/forgot-password', name: 'forgot-password', component: ForgotPasswordView, meta: { public: true } },
  { path: '/forgot-password/sent', name: 'forgot-password-sent', component: CheckEmailView, meta: { public: true } },
  { path: '/reset-password', name: 'reset-password', component: ResetPasswordView, meta: { public: true } },
  { path: '/verify-email', name: 'verify-email', component: VerifyEmailView, meta: { public: true } },
  {
    path: '/select-company',
    name: 'select-company',
    component: SelectCompanyView,
    meta: { requiresCompany: false },
  },
  {
    path: '/',
    component: AppLayout,
    children: [
      // Landing dashboard: no permission gate so it's always a safe redirect target;
      // each widget gates itself by its feature permission code (UX only).
      { path: '', name: 'home', component: DashboardView, meta: {} },
      // Own account: any authenticated user, no permission gate (acts on self).
      { path: 'profile', name: 'profile', component: ProfileView, meta: { breadcrumb: [{ labelKey: 'breadcrumb.profile' }] } },
      // Self-service attendance. The punch screen and my-days carry the SELF codes, so an ordinary
      // employee reaches them without the power to see anyone else's attendance. The two request
      // forms carry DOC_CREATE, because raising one is a document action and changes nothing until
      // it is approved.
      { path: 'attendance/me', name: 'my-attendance', component: MyAttendanceView, meta: { permission: 'ATTEND_PUNCH_SELF' } },
      { path: 'attendance/my-days', name: 'my-attendance-days', component: MyDaysView, meta: { permission: 'ATTEND_DAY_SELF' } },
      { path: 'attendance/leave/new', name: 'request-leave', component: RequestLeaveView, meta: { permission: 'DOC_CREATE', breadcrumb: [{ nav: 'myAttendance' }] } },
      { path: 'attendance/correction/new', name: 'request-correction', component: RequestCorrectionView, meta: { permission: 'DOC_CREATE', breadcrumb: [{ nav: 'myAttendance' }] } },
      // HR attendance operations, each gated on the code for the read it performs. The writes
      // inside — closing, reopening, recomputing, punching on behalf — are gated separately in the
      // views, because the guard takes exactly one code per route.
      { path: 'attendance/periods', name: 'attendance-periods', component: AttendancePeriodsView, meta: { permission: 'ATTEND_PERIOD_READ' } },
      { path: 'attendance/periods/:id', name: 'attendance-period-detail', component: AttendancePeriodDetailView, meta: { permission: 'ATTEND_PERIOD_READ', breadcrumb: [{ nav: 'attendancePeriods' }] } },
      { path: 'attendance/team', name: 'team-attendance', component: TeamAttendanceView, meta: { permission: 'ATTEND_DAY_READ' } },
      { path: 'attendance/ledger', name: 'punch-ledger', component: PunchLedgerView, meta: { permission: 'ATTEND_PUNCH_READ' } },
      { path: 'documents', name: 'documents', component: MyDocumentsView, meta: { permission: 'DOC_VIEW' } },
      { path: 'documents/new', name: 'document-new', component: CreateDocumentView, meta: { permission: 'DOC_CREATE', breadcrumb: [{ nav: 'documents' }, { labelKey: 'breadcrumb.new' }] } },
      { path: 'documents/:id/edit', name: 'document-edit', component: CreateDocumentView, meta: { permission: 'DOC_CREATE', breadcrumb: [{ nav: 'documents' }, { labelKey: 'breadcrumb.edit' }] } },
      { path: 'documents/:id', name: 'document-detail', component: DocumentDetailView, meta: { permission: 'DOC_VIEW', breadcrumb: [{ nav: 'documents' }] } },
      { path: 'approvals', name: 'approvals', component: ApprovalInboxView, meta: { permission: 'DOC_APPROVE' } },
      { path: 'payments', name: 'payments', component: ReadyToPayView, meta: { permission: 'PAYMENT_VIEW' } },
      // Settlement of accrue-on-approval documents (document_settlement). Gated on PAYMENT_MANAGE —
      // recording a settlement is a finance act — distinct from the PAYMENT_VIEW ready-to-pay queue.
      { path: 'settlements', name: 'settlements', component: SettlementsView, meta: { permission: 'PAYMENT_MANAGE' } },
      { path: 'payment-batches', name: 'payment-batches', component: PaymentBatchesView, meta: { permission: 'PAYMENT_BATCH_VIEW' } },
      { path: 'payment-batches/:id', name: 'payment-batch-detail', component: PaymentBatchDetailView, meta: { permission: 'PAYMENT_BATCH_VIEW', breadcrumb: [{ nav: 'paymentBatches' }] } },
      { path: 'budgets', name: 'budgets', component: BudgetListView, meta: { permission: 'BUDGET_VIEW' } },
      // Control points: WHERE spending is checked. Declared before budgets/:id so the literal
      // path is not captured as a budget id.
      { path: 'budgets/control-points', name: 'control-points', component: ControlPointListView, meta: { permission: 'BUDGET_VIEW' } },
      { path: 'budgets/control-points/:id', name: 'control-point-detail', component: ControlPointDetailView, meta: { permission: 'BUDGET_VIEW', breadcrumb: [{ nav: 'controlPoints' }] } },
      { path: 'budgets/new', name: 'budget-new', component: BudgetFormView, meta: { permission: 'BUDGET_MANAGE', breadcrumb: [{ nav: 'budgets' }, { labelKey: 'breadcrumb.new' }] } },
      { path: 'budgets/:id', name: 'budget-detail', component: BudgetDetailView, meta: { permission: 'BUDGET_VIEW', breadcrumb: [{ nav: 'budgets' }] } },
      { path: 'budgets/:id/edit', name: 'budget-edit', component: BudgetFormView, meta: { permission: 'BUDGET_MANAGE', breadcrumb: [{ nav: 'budgets' }, { labelKey: 'breadcrumb.edit' }] } },
      { path: 'notifications', name: 'notifications', component: NotificationInboxView, meta: { permission: 'NOTIFICATION_VIEW', breadcrumb: [{ labelKey: 'breadcrumb.notifications' }] } },
      { path: 'master-data', name: 'master-data', component: MasterDataView, meta: { permission: 'MASTER_VIEW' } },
      { path: 'stock', name: 'stock', component: StockOnHandView, meta: { permission: 'INV_VIEW' } },
      { path: 'warehouses', name: 'warehouses', component: WarehousesAdminView, meta: { permission: 'INV_VIEW' } },
      { path: 'quota', name: 'quota', component: QuotaListView, meta: { permission: 'QUOTA_VIEW' } },
      { path: 'quota/:id', name: 'quota-detail', component: QuotaDetailView, meta: { permission: 'QUOTA_VIEW', breadcrumb: [{ nav: 'quota' }] } },
      // QUOTA_VIEW, not QUOTA_MANAGE: the list is a read, and the view already hides every
      // write action behind `canManage`. Gating the route on MANAGE locked a QUOTA_VIEW user out of
      // a screen the spec says they may read.
      { path: 'quota-admin', name: 'quota-admin', component: QuotaAdminView, meta: { permission: 'QUOTA_VIEW' } },
      { path: 'quota-admin/:id', name: 'quota-admin-detail', component: QuotaAdminDetailView, meta: { permission: 'QUOTA_MANAGE', breadcrumb: [{ nav: 'quotaAdmin' }] } },
      // Reports are individual pages (no tabs); the bare /reports redirects to the first.
      { path: 'reports', redirect: { name: 'report-budget-balance' } },
      { path: 'reports/budget-balance', name: 'report-budget-balance', component: BudgetBalanceReport, meta: { permission: 'REPORT_VIEW' } },
      { path: 'reports/budget-utilization', name: 'report-budget-utilization', component: BudgetUtilizationReport, meta: { permission: 'REPORT_VIEW' } },
      { path: 'reports/documents', name: 'report-documents', component: DocumentSummaryReport, meta: { permission: 'REPORT_VIEW' } },
      { path: 'reports/spend-by-vendor', name: 'report-spend-by-vendor', component: SpendByVendorReport, meta: { permission: 'REPORT_VIEW' } },
      { path: 'reports/approval-aging', name: 'report-approval-aging', component: ApprovalAgingReport, meta: { permission: 'REPORT_VIEW' } },
      { path: 'reports/quota-remaining', name: 'report-quota-remaining', component: QuotaRemainingReport, meta: { permission: 'REPORT_VIEW' } },
      { path: 'reports/budget-audit', name: 'report-budget-audit', component: BudgetAuditReport, meta: { permission: 'REPORT_VIEW' } },
      { path: 'reports/group', name: 'reports-group', component: GroupBudgetReport, meta: { permission: 'REPORT_GROUP_VIEW' } },
      { path: 'reports/trial-balance', name: 'report-trial-balance', component: TrialBalanceReport, meta: { permission: 'GL_VIEW' } },
      { path: 'reports/income-statement', name: 'report-income-statement', component: IncomeStatementReport, meta: { permission: 'GL_VIEW' } },
      { path: 'reports/balance-sheet', name: 'report-balance-sheet', component: BalanceSheetReport, meta: { permission: 'GL_VIEW' } },
      { path: 'reports/ledger/:accountId', name: 'report-account-ledger', component: AccountLedgerReport, meta: { permission: 'GL_VIEW', breadcrumb: [{ nav: 'reportTrialBalance' }] } },
      { path: 'rbac-admin', name: 'rbac-admin', component: RbacAdminView, meta: { permission: 'RBAC_MANAGE' } },
      { path: 'api-keys', name: 'api-keys', component: ApiKeysAdminView, meta: { permission: 'API_KEY_MANAGE', breadcrumb: [{ labelKey: 'breadcrumb.apiKeys' }] } },
      { path: 'employee-admin', name: 'employee-admin', component: EmployeeAdminView, meta: { permission: 'EMPLOYEE_MANAGE' } },
      { path: 'employee-admin/new', name: 'employee-create', component: EmployeeCreateView, meta: { permission: 'EMPLOYEE_MANAGE', breadcrumb: [{ nav: 'employees' }, { labelKey: 'breadcrumb.new' }] } },
      // Onboard needs EMPLOYEE_MANAGE + RBAC_MANAGE; the route gates the first, the view enforces the second.
      { path: 'employee-admin/:id/onboard', name: 'employee-onboard', component: EmployeeOnboardView, meta: { permission: 'EMPLOYEE_MANAGE', breadcrumb: [{ nav: 'employees' }, { labelKey: 'breadcrumb.onboard' }] } },
      // Configuration is split into four directly-linkable sections shown in the sidebar;
      // the bare path redirects to the first so old /doc-config links still resolve.
      { path: 'doc-config', redirect: { name: 'doc-config-types' } },
      { path: 'doc-config/types', name: 'doc-config-types', component: DocTypesView, meta: { permission: 'DOC_CONFIG_MANAGE' } },
      { path: 'doc-config/types/new', name: 'doc-config-type-new', component: DocTypeFormView, meta: { permission: 'DOC_CONFIG_MANAGE', breadcrumb: [{ nav: 'configTypes' }, { labelKey: 'breadcrumb.new' }] } },
      { path: 'doc-config/types/:id/edit', name: 'doc-config-type-edit', component: DocTypeFormView, meta: { permission: 'DOC_CONFIG_MANAGE', breadcrumb: [{ nav: 'configTypes' }, { labelKey: 'breadcrumb.edit' }] } },
      { path: 'doc-config/categories', name: 'doc-config-categories', component: DocCategoriesView, meta: { permission: 'DOC_CONFIG_MANAGE' } },
      { path: 'doc-config/forms', name: 'doc-config-forms', component: FormTemplatesView, meta: { permission: 'DOC_CONFIG_MANAGE' } },
      { path: 'doc-config/mappings', name: 'doc-config-mappings', component: DeptMappingsView, meta: { permission: 'DOC_CONFIG_MANAGE' } },
      { path: 'doc-config/workflows', name: 'doc-config-workflows', component: WorkflowsView, meta: { permission: 'DOC_CONFIG_MANAGE' } },
      { path: 'doc-config/workflows/:workflowId', name: 'doc-config-workflow-detail', component: WorkflowDetailView, meta: { permission: 'DOC_CONFIG_MANAGE', breadcrumb: [{ nav: 'configWorkflows' }] } },
      { path: 'doc-config/workflows/:workflowId/steps/new', name: 'workflow-step-create', component: WorkflowStepCreateView, meta: { permission: 'DOC_CONFIG_MANAGE', breadcrumb: [{ nav: 'configWorkflows' }] } },
      { path: 'doc-config/workflows/:workflowId/steps/:stepId/edit', name: 'workflow-step-edit', component: WorkflowStepCreateView, meta: { permission: 'DOC_CONFIG_MANAGE', breadcrumb: [{ nav: 'configWorkflows' }] } },
      { path: 'org-admin', redirect: { name: 'org-companies' } },
      { path: 'org-admin/companies', name: 'org-companies', component: CompaniesView, meta: { permission: 'COMPANY_VIEW' } },
      { path: 'org-admin/companies/new', name: 'company-new', component: CompanyFormView, meta: { permission: 'COMPANY_MANAGE', breadcrumb: [{ nav: 'orgCompanies' }, { labelKey: 'breadcrumb.new' }] } },
      { path: 'org-admin/companies/:id/edit', name: 'company-edit', component: CompanyFormView, meta: { permission: 'COMPANY_MANAGE', breadcrumb: [{ nav: 'orgCompanies' }, { labelKey: 'breadcrumb.edit' }] } },
      { path: 'org-admin/departments', name: 'org-departments', component: DepartmentsView, meta: { permission: 'COMPANY_VIEW' } },
      { path: 'org-admin/fiscal-years', name: 'org-fiscal-years', component: FiscalYearsView, meta: { permission: 'COMPANY_VIEW' } },
      { path: 'org-admin/holidays', name: 'org-holidays', component: HolidaysView, meta: { permission: 'COMPANY_VIEW' } },
      { path: 'currency-admin', name: 'currency-admin', component: CurrencyAdminView, meta: { permission: 'CURRENCY_VIEW' } },
      { path: 'accounts', name: 'accounts-admin', component: AccountsAdminView, meta: { permission: 'COA_VIEW' } },
      { path: 'journal', name: 'journal', component: JournalView, meta: { permission: 'GL_VIEW' } },
      { path: 'tax-codes', name: 'tax-codes', component: TaxCodesAdminView, meta: { permission: 'TAX_VIEW' } },
      { path: 'job-levels', name: 'job-levels', component: JobLevelsAdminView, meta: { permission: 'JOB_LEVEL_VIEW' } },
      { path: 'tax-summary', name: 'tax-summary', component: TaxSummaryView, meta: { permission: 'TAX_VIEW' } },
      { path: 'approval-config', name: 'approval-config', component: ApprovalConfigView, meta: { permission: 'WORKFLOW_MANAGE' } },
    ],
  },
];
