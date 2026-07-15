import { describe, expect, it } from 'vitest';
import type { Component } from 'vue';
import { mountView, type MountViewOptions } from '../mountView';

// Auth / shell
import LoginView from '../../views/LoginView.vue';
import SelectCompanyView from '../../views/SelectCompanyView.vue';
import DashboardView from '../../views/DashboardView.vue';
// Documents
import MyDocumentsView from '../../views/documents/MyDocumentsView.vue';
import CreateDocumentView from '../../views/documents/CreateDocumentView.vue';
import DocumentDetailView from '../../views/documents/DocumentDetailView.vue';
// Approvals / payments
import ApprovalInboxView from '../../views/approvals/ApprovalInboxView.vue';
import ReadyToPayView from '../../views/payments/ReadyToPayView.vue';
// Budgets
import BudgetListView from '../../views/budgets/BudgetListView.vue';
import BudgetDetailView from '../../views/budgets/BudgetDetailView.vue';
import BudgetFormView from '../../views/budgets/BudgetFormView.vue';
// Quota
import QuotaListView from '../../views/quota/QuotaListView.vue';
import QuotaDetailView from '../../views/quota/QuotaDetailView.vue';
// Reports
import GroupBudgetReport from '../../views/reports/GroupBudgetReport.vue';
import BudgetBalanceReport from '../../views/reports/BudgetBalanceReport.vue';
import BudgetAuditReport from '../../views/reports/BudgetAuditReport.vue';
import ApprovalAgingReport from '../../views/reports/ApprovalAgingReport.vue';
import QuotaRemainingReport from '../../views/reports/QuotaRemainingReport.vue';
import BudgetUtilizationReport from '../../views/reports/BudgetUtilizationReport.vue';
import DocumentSummaryReport from '../../views/reports/DocumentSummaryReport.vue';
import SpendByVendorReport from '../../views/reports/SpendByVendorReport.vue';
// Notifications / master
import NotificationInboxView from '../../views/notifications/NotificationInboxView.vue';
import MasterDataView from '../../views/master/MasterDataView.vue';
// Admin
import DocTypesView from '../../views/admin/doc-config/DocTypesView.vue';
import FormTemplatesView from '../../views/admin/doc-config/FormTemplatesView.vue';
import DeptMappingsView from '../../views/admin/doc-config/DeptMappingsView.vue';
import WorkflowsView from '../../views/admin/doc-config/WorkflowsView.vue';
import WorkflowDetailView from '../../views/admin/doc-config/WorkflowDetailView.vue';
import WorkflowStepCreateView from '../../views/admin/doc-config/WorkflowStepCreateView.vue';
import ApprovalConfigView from '../../views/admin/ApprovalConfigView.vue';
import RbacAdminView from '../../views/admin/RbacAdminView.vue';
import CurrencyAdminView from '../../views/admin/CurrencyAdminView.vue';
import EmployeeAdminView from '../../views/admin/EmployeeAdminView.vue';
import EmployeeCreateView from '../../views/admin/EmployeeCreateView.vue';
import QuotaAdminView from '../../views/admin/QuotaAdminView.vue';
import QuotaAdminDetailView from '../../views/admin/QuotaAdminDetailView.vue';
// Org admin
import CompaniesView from '../../views/admin/org/CompaniesView.vue';
import CompanyFormView from '../../views/admin/org/CompanyFormView.vue';
import DepartmentsView from '../../views/admin/org/DepartmentsView.vue';
import FiscalYearsView from '../../views/admin/org/FiscalYearsView.vue';
import HolidaysView from '../../views/admin/org/HolidaysView.vue';

type Case = [name: string, component: Component, options: MountViewOptions];

const VIEWS: Case[] = [
  ['login', LoginView, { path: '/login', routeName: 'login' }],
  ['select-company', SelectCompanyView, { path: '/select-company', routeName: 'select-company' }],
  ['home', DashboardView, { path: '/', routeName: 'home' }],
  ['documents', MyDocumentsView, { path: '/documents', routeName: 'documents' }],
  ['document-new', CreateDocumentView, { path: '/documents/new', routeName: 'document-new' }],
  ['document-detail', DocumentDetailView, { path: '/documents/:id', routeName: 'document-detail', routeParams: { id: 'doc-1' } }],
  ['approvals', ApprovalInboxView, { path: '/approvals', routeName: 'approvals' }],
  ['payments', ReadyToPayView, { path: '/payments', routeName: 'payments' }],
  ['budgets', BudgetListView, { path: '/budgets', routeName: 'budgets' }],
  ['budget-new', BudgetFormView, { path: '/budgets/new', routeName: 'budget-new' }],
  ['budget-detail', BudgetDetailView, { path: '/budgets/:id', routeName: 'budget-detail', routeParams: { id: 'bud-1' } }],
  ['quota', QuotaListView, { path: '/quota', routeName: 'quota' }],
  ['quota-detail', QuotaDetailView, { path: '/quota/:id', routeName: 'quota-detail', routeParams: { id: 'q-1' } }],
  ['quota-admin', QuotaAdminView, { path: '/quota-admin', routeName: 'quota-admin' }],
  ['quota-admin-detail', QuotaAdminDetailView, { path: '/quota-admin/:id', routeName: 'quota-admin-detail', routeParams: { id: 'q-1' } }],
  ['reports-group', GroupBudgetReport, { path: '/reports/group', routeName: 'reports-group' }],
  ['report-budget-balance', BudgetBalanceReport, { path: '/reports/budget-balance', routeName: 'report-budget-balance' }],
  ['report-budget-audit', BudgetAuditReport, { path: '/reports/budget-audit', routeName: 'report-budget-audit' }],
  ['report-approval-aging', ApprovalAgingReport, { path: '/reports/approval-aging', routeName: 'report-approval-aging' }],
  ['report-quota-remaining', QuotaRemainingReport, { path: '/reports/quota-remaining', routeName: 'report-quota-remaining' }],
  ['report-budget-utilization', BudgetUtilizationReport, { path: '/reports/budget-utilization', routeName: 'report-budget-utilization' }],
  ['report-document-summary', DocumentSummaryReport, { path: '/reports/documents', routeName: 'report-documents' }],
  ['report-spend-by-vendor', SpendByVendorReport, { path: '/reports/spend-by-vendor', routeName: 'report-spend-by-vendor' }],
  ['notifications', NotificationInboxView, { path: '/notifications', routeName: 'notifications' }],
  ['master-data', MasterDataView, { path: '/master-data', routeName: 'master-data' }],
  ['doc-config-types', DocTypesView, { path: '/doc-config/types', routeName: 'doc-config-types' }],
  ['doc-config-forms', FormTemplatesView, { path: '/doc-config/forms', routeName: 'doc-config-forms' }],
  ['doc-config-mappings', DeptMappingsView, { path: '/doc-config/mappings', routeName: 'doc-config-mappings' }],
  ['doc-config-workflows', WorkflowsView, { path: '/doc-config/workflows', routeName: 'doc-config-workflows' }],
  ['doc-config-workflow-detail', WorkflowDetailView, { path: '/doc-config/workflows/:workflowId', routeName: 'doc-config-workflow-detail', routeParams: { workflowId: 'wf-1' } }],
  ['workflow-step-create', WorkflowStepCreateView, { path: '/doc-config/workflows/:workflowId/steps/new', routeName: 'workflow-step-create', routeParams: { workflowId: 'wf-1' } }],
  ['workflow-step-edit', WorkflowStepCreateView, { path: '/doc-config/workflows/:workflowId/steps/:stepId/edit', routeName: 'workflow-step-edit', routeParams: { workflowId: 'wf-1', stepId: 'step-1' } }],
  ['approval-config', ApprovalConfigView, { path: '/approval-config', routeName: 'approval-config' }],
  ['rbac-admin', RbacAdminView, { path: '/rbac-admin', routeName: 'rbac-admin' }],
  ['currency-admin', CurrencyAdminView, { path: '/currency-admin', routeName: 'currency-admin' }],
  ['employee-admin', EmployeeAdminView, { path: '/employee-admin', routeName: 'employee-admin' }],
  ['employee-create', EmployeeCreateView, { path: '/employee-admin/new', routeName: 'employee-create' }],
  ['org-companies', CompaniesView, { path: '/org-admin/companies', routeName: 'org-companies' }],
  ['company-new', CompanyFormView, { path: '/org-admin/companies/new', routeName: 'company-new' }],
  ['org-departments', DepartmentsView, { path: '/org-admin/departments', routeName: 'org-departments' }],
  ['org-fiscal-years', FiscalYearsView, { path: '/org-admin/fiscal-years', routeName: 'org-fiscal-years' }],
  ['org-holidays', HolidaysView, { path: '/org-admin/holidays', routeName: 'org-holidays' }],
];

describe('smoke: every routed view mounts without throwing', () => {
  it.each(VIEWS)('renders %s', async (_name, component, options) => {
    const w = await mountView(component, options);
    expect(w.exists()).toBe(true);
    // A view that crashed mid-render leaves an empty root; assert it produced markup.
    expect(w.html().length).toBeGreaterThan(0);
  });
});
