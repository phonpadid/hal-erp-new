import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';

// Route components are lazy-loaded so vue-router code-splits each view into its own
// chunk, keeping the initial bundle small. CreateDocumentView is shared by the
// new/edit routes; the loader is defined once so both reuse the same chunk.
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
const BudgetDetailView = () => import('../views/budgets/BudgetDetailView.vue');
const BudgetFormView = () => import('../views/budgets/BudgetFormView.vue');
const BudgetListView = () => import('../views/budgets/BudgetListView.vue');
const CreateDocumentView = () => import('../views/documents/CreateDocumentView.vue');
const DocumentDetailView = () => import('../views/documents/DocumentDetailView.vue');
const MyDocumentsView = () => import('../views/documents/MyDocumentsView.vue');
const ApprovalConfigView = () => import('../views/admin/ApprovalConfigView.vue');
const CurrencyAdminView = () => import('../views/admin/CurrencyAdminView.vue');
const AccountsAdminView = () => import('../views/admin/AccountsAdminView.vue');
const JournalView = () => import('../views/JournalView.vue');
const TaxCodesAdminView = () => import('../views/admin/TaxCodesAdminView.vue');
const TaxSummaryView = () => import('../views/TaxSummaryView.vue');
const DocTypesView = () => import('../views/admin/doc-config/DocTypesView.vue');
const FormTemplatesView = () => import('../views/admin/doc-config/FormTemplatesView.vue');
const DeptMappingsView = () => import('../views/admin/doc-config/DeptMappingsView.vue');
const WorkflowsView = () => import('../views/admin/doc-config/WorkflowsView.vue');
const WorkflowDetailView = () => import('../views/admin/doc-config/WorkflowDetailView.vue');
const WorkflowStepCreateView = () => import('../views/admin/doc-config/WorkflowStepCreateView.vue');
const EmployeeAdminView = () => import('../views/admin/EmployeeAdminView.vue');
const EmployeeCreateView = () => import('../views/admin/EmployeeCreateView.vue');
const EmployeeOnboardView = () => import('../views/admin/EmployeeOnboardView.vue');
const CompaniesView = () => import('../views/admin/org/CompaniesView.vue');
const DepartmentsView = () => import('../views/admin/org/DepartmentsView.vue');
const FiscalYearsView = () => import('../views/admin/org/FiscalYearsView.vue');
const HolidaysView = () => import('../views/admin/org/HolidaysView.vue');
const RbacAdminView = () => import('../views/admin/RbacAdminView.vue');
const MasterDataView = () => import('../views/master/MasterDataView.vue');
const NotificationInboxView = () => import('../views/notifications/NotificationInboxView.vue');
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

/** State the guard needs — kept minimal so it can be unit-tested in isolation. */
export interface GuardState {
  isAuthenticated: boolean;
  hasCompany: boolean;
  can: (code: string) => boolean;
}

export interface GuardRoute {
  name?: string | null;
  meta: { public?: boolean; requiresCompany?: boolean; permission?: string };
}

/**
 * Pure routing guard. Returns the name of the route to redirect to, or null to
 * allow navigation. Gating is by permission CODE only (invariant 5; UX-only).
 */
export function evaluateGuard(state: GuardState, route: GuardRoute): string | null {
  if (route.meta.public) return null;
  if (!state.isAuthenticated) return 'login';
  if (route.meta.requiresCompany !== false && !state.hasCompany && route.name !== 'select-company') {
    return 'select-company';
  }
  if (route.meta.permission && !state.can(route.meta.permission)) return 'home';
  return null;
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
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
        { path: 'profile', name: 'profile', component: ProfileView, meta: {} },
        { path: 'documents', name: 'documents', component: MyDocumentsView, meta: { permission: 'DOC_VIEW' } },
        { path: 'documents/new', name: 'document-new', component: CreateDocumentView, meta: { permission: 'DOC_CREATE' } },
        { path: 'documents/:id/edit', name: 'document-edit', component: CreateDocumentView, meta: { permission: 'DOC_CREATE' } },
        { path: 'documents/:id', name: 'document-detail', component: DocumentDetailView, meta: { permission: 'DOC_VIEW' } },
        { path: 'approvals', name: 'approvals', component: ApprovalInboxView, meta: { permission: 'DOC_APPROVE' } },
        { path: 'payments', name: 'payments', component: ReadyToPayView, meta: { permission: 'PAYMENT_VIEW' } },
        { path: 'budgets', name: 'budgets', component: BudgetListView, meta: { permission: 'BUDGET_VIEW' } },
        { path: 'budgets/new', name: 'budget-new', component: BudgetFormView, meta: { permission: 'BUDGET_MANAGE' } },
        { path: 'budgets/:id', name: 'budget-detail', component: BudgetDetailView, meta: { permission: 'BUDGET_VIEW' } },
        { path: 'budgets/:id/edit', name: 'budget-edit', component: BudgetFormView, meta: { permission: 'BUDGET_MANAGE' } },
        { path: 'notifications', name: 'notifications', component: NotificationInboxView, meta: { permission: 'NOTIFICATION_VIEW' } },
        { path: 'master-data', name: 'master-data', component: MasterDataView, meta: { permission: 'MASTER_VIEW' } },
        { path: 'quota', name: 'quota', component: QuotaListView, meta: { permission: 'QUOTA_VIEW' } },
        { path: 'quota/:id', name: 'quota-detail', component: QuotaDetailView, meta: { permission: 'QUOTA_VIEW' } },
        { path: 'quota-admin', name: 'quota-admin', component: QuotaAdminView, meta: { permission: 'QUOTA_MANAGE' } },
        { path: 'quota-admin/:id', name: 'quota-admin-detail', component: QuotaAdminDetailView, meta: { permission: 'QUOTA_MANAGE' } },
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
        { path: 'reports/ledger/:accountId', name: 'report-account-ledger', component: AccountLedgerReport, meta: { permission: 'GL_VIEW' } },
        { path: 'rbac-admin', name: 'rbac-admin', component: RbacAdminView, meta: { permission: 'RBAC_MANAGE' } },
        { path: 'employee-admin', name: 'employee-admin', component: EmployeeAdminView, meta: { permission: 'EMPLOYEE_MANAGE' } },
        { path: 'employee-admin/new', name: 'employee-create', component: EmployeeCreateView, meta: { permission: 'EMPLOYEE_MANAGE' } },
        // Onboard needs EMPLOYEE_MANAGE + RBAC_MANAGE; the route gates the first, the view enforces the second.
        { path: 'employee-admin/:id/onboard', name: 'employee-onboard', component: EmployeeOnboardView, meta: { permission: 'EMPLOYEE_MANAGE' } },
        // Configuration is split into four directly-linkable sections shown in the sidebar;
        // the bare path redirects to the first so old /doc-config links still resolve.
        { path: 'doc-config', redirect: { name: 'doc-config-types' } },
        { path: 'doc-config/types', name: 'doc-config-types', component: DocTypesView, meta: { permission: 'DOC_CONFIG_MANAGE' } },
        { path: 'doc-config/forms', name: 'doc-config-forms', component: FormTemplatesView, meta: { permission: 'DOC_CONFIG_MANAGE' } },
        { path: 'doc-config/mappings', name: 'doc-config-mappings', component: DeptMappingsView, meta: { permission: 'DOC_CONFIG_MANAGE' } },
        { path: 'doc-config/workflows', name: 'doc-config-workflows', component: WorkflowsView, meta: { permission: 'DOC_CONFIG_MANAGE' } },
        { path: 'doc-config/workflows/:workflowId', name: 'doc-config-workflow-detail', component: WorkflowDetailView, meta: { permission: 'DOC_CONFIG_MANAGE' } },
        { path: 'doc-config/workflows/:workflowId/steps/new', name: 'workflow-step-create', component: WorkflowStepCreateView, meta: { permission: 'DOC_CONFIG_MANAGE' } },
        { path: 'doc-config/workflows/:workflowId/steps/:stepId/edit', name: 'workflow-step-edit', component: WorkflowStepCreateView, meta: { permission: 'DOC_CONFIG_MANAGE' } },
        { path: 'org-admin', redirect: { name: 'org-companies' } },
        { path: 'org-admin/companies', name: 'org-companies', component: CompaniesView, meta: { permission: 'COMPANY_VIEW' } },
        { path: 'org-admin/departments', name: 'org-departments', component: DepartmentsView, meta: { permission: 'COMPANY_VIEW' } },
        { path: 'org-admin/fiscal-years', name: 'org-fiscal-years', component: FiscalYearsView, meta: { permission: 'COMPANY_VIEW' } },
        { path: 'org-admin/holidays', name: 'org-holidays', component: HolidaysView, meta: { permission: 'COMPANY_VIEW' } },
        { path: 'currency-admin', name: 'currency-admin', component: CurrencyAdminView, meta: { permission: 'CURRENCY_VIEW' } },
        { path: 'accounts', name: 'accounts-admin', component: AccountsAdminView, meta: { permission: 'COA_VIEW' } },
        { path: 'journal', name: 'journal', component: JournalView, meta: { permission: 'GL_VIEW' } },
        { path: 'tax-codes', name: 'tax-codes', component: TaxCodesAdminView, meta: { permission: 'TAX_VIEW' } },
        { path: 'tax-summary', name: 'tax-summary', component: TaxSummaryView, meta: { permission: 'TAX_VIEW' } },
        { path: 'approval-config', name: 'approval-config', component: ApprovalConfigView, meta: { permission: 'WORKFLOW_MANAGE' } },
      ],
    },
  ],
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  const target = evaluateGuard(
    { isAuthenticated: auth.isAuthenticated, hasCompany: auth.hasCompany, can: (c) => auth.can(c) },
    { name: to.name as string | undefined, meta: to.meta as { public?: boolean; requiresCompany?: boolean; permission?: string } },
  );
  return target && target !== to.name ? { name: target } : true;
});

export default router;
