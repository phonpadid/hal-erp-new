import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import AppLayout from '../layouts/AppLayout.vue';
import LoginView from '../views/LoginView.vue';
import ForgotPasswordView from '../views/auth/ForgotPasswordView.vue';
import CheckEmailView from '../views/auth/CheckEmailView.vue';
import ResetPasswordView from '../views/auth/ResetPasswordView.vue';
import VerifyEmailView from '../views/auth/VerifyEmailView.vue';
import SelectCompanyView from '../views/SelectCompanyView.vue';
import DashboardView from '../views/DashboardView.vue';
import ProfileView from '../views/ProfileView.vue';
import ApprovalInboxView from '../views/approvals/ApprovalInboxView.vue';
import ReadyToPayView from '../views/payments/ReadyToPayView.vue';
import BudgetDetailView from '../views/budgets/BudgetDetailView.vue';
import BudgetFormView from '../views/budgets/BudgetFormView.vue';
import BudgetListView from '../views/budgets/BudgetListView.vue';
import CreateDocumentView from '../views/documents/CreateDocumentView.vue';
import DocumentDetailView from '../views/documents/DocumentDetailView.vue';
import MyDocumentsView from '../views/documents/MyDocumentsView.vue';
import ApprovalConfigView from '../views/admin/ApprovalConfigView.vue';
import CurrencyAdminView from '../views/admin/CurrencyAdminView.vue';
import AccountsAdminView from '../views/admin/AccountsAdminView.vue';
import JournalView from '../views/JournalView.vue';
import TaxCodesAdminView from '../views/admin/TaxCodesAdminView.vue';
import TaxSummaryView from '../views/TaxSummaryView.vue';
import DocTypesView from '../views/admin/doc-config/DocTypesView.vue';
import FormTemplatesView from '../views/admin/doc-config/FormTemplatesView.vue';
import DeptMappingsView from '../views/admin/doc-config/DeptMappingsView.vue';
import WorkflowsView from '../views/admin/doc-config/WorkflowsView.vue';
import WorkflowDetailView from '../views/admin/doc-config/WorkflowDetailView.vue';
import WorkflowStepCreateView from '../views/admin/doc-config/WorkflowStepCreateView.vue';
import EmployeeAdminView from '../views/admin/EmployeeAdminView.vue';
import EmployeeCreateView from '../views/admin/EmployeeCreateView.vue';
import EmployeeOnboardView from '../views/admin/EmployeeOnboardView.vue';
import CompaniesView from '../views/admin/org/CompaniesView.vue';
import DepartmentsView from '../views/admin/org/DepartmentsView.vue';
import FiscalYearsView from '../views/admin/org/FiscalYearsView.vue';
import HolidaysView from '../views/admin/org/HolidaysView.vue';
import RbacAdminView from '../views/admin/RbacAdminView.vue';
import MasterDataView from '../views/master/MasterDataView.vue';
import NotificationInboxView from '../views/notifications/NotificationInboxView.vue';
import QuotaDetailView from '../views/quota/QuotaDetailView.vue';
import QuotaListView from '../views/quota/QuotaListView.vue';
import QuotaAdminView from '../views/admin/QuotaAdminView.vue';
import QuotaAdminDetailView from '../views/admin/QuotaAdminDetailView.vue';
import BudgetBalanceReport from '../views/reports/BudgetBalanceReport.vue';
import BudgetUtilizationReport from '../views/reports/BudgetUtilizationReport.vue';
import DocumentSummaryReport from '../views/reports/DocumentSummaryReport.vue';
import SpendByVendorReport from '../views/reports/SpendByVendorReport.vue';
import ApprovalAgingReport from '../views/reports/ApprovalAgingReport.vue';
import QuotaRemainingReport from '../views/reports/QuotaRemainingReport.vue';
import BudgetAuditReport from '../views/reports/BudgetAuditReport.vue';
import GroupBudgetReport from '../views/reports/GroupBudgetReport.vue';
import TrialBalanceReport from '../views/reports/TrialBalanceReport.vue';
import IncomeStatementReport from '../views/reports/IncomeStatementReport.vue';
import BalanceSheetReport from '../views/reports/BalanceSheetReport.vue';
import AccountLedgerReport from '../views/reports/AccountLedgerReport.vue';

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
