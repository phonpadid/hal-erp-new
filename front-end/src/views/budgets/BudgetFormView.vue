<script setup lang="ts">
import { budgetCreateSchema, budgetUpdateSchema, canTransitionBudget, departmentSchema, fiscalYearSchema } from '@erp/shared';
import { Form, FormField } from '@primevue/forms';
import { zodResolver } from '@primevue/forms/resolvers/zod';
import { formatAmount, groupDigits, stripGrouping } from '../../utils/money';
import Button from 'primevue/button';
import DatePicker from 'primevue/datepicker';
import Dialog from 'primevue/dialog';
import Divider from 'primevue/divider';
import Fluid from 'primevue/fluid';
import IconField from 'primevue/iconfield';
import InputGroup from 'primevue/inputgroup';
import InputGroupAddon from 'primevue/inputgroupaddon';
import InputIcon from 'primevue/inputicon';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Select from 'primevue/select';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import ErrorState from '@/components/ErrorState.vue';
import ThemedIllustration from '@/components/ThemedIllustration.vue';
import rawIllustration from '@/assets/illustrations/undraw_empty-wallet_j0kn.svg?raw';
import { orgApi } from '../../api/org';
import type { Department, FiscalYear } from '../../api/org';
import { budgetsApi } from '../../api/budgets';
import type { BudgetNodeView, SelectableDepartment, SelectableFiscalYear } from '../../api/budgets';
import { useAuthStore } from '../../stores/auth';
import { useBudgetsStore } from '../../stores/budgets';
import { useAccountsStore } from '../../stores/accounts';
import { useFeedback } from '../../composables/useFeedback';
import { messageOf } from '../../utils/apiError';
import type { FormSubmitEvent } from '@primevue/forms';

// Create/edit a budget by dimension (BUDGET_MANAGE). amountTotal is a decimal string and
// is editable ONLY at creation — corrections are ledger adjustments, never an overwrite
// (invariant 3). One Zod schema (shared with the backend) per mode, so validation can't drift.
const { t } = useI18n();
const fb = useFeedback();
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const budgets = useBudgetsStore();
const accounts = useAccountsStore();

// GL picker options — active, postable accounts of the active company. The stored value is
// the account code (glAccount), which the backend resolves to the account on submit.
const accountOptions = computed(() =>
  accounts.selectable.map((a) => ({ label: `${a.code} — ${a.name}`, value: a.code })),
);

const nodeLabel = (n: BudgetNodeView) => (n.name ? `${n.code} — ${n.name}` : n.code);
/**
 * Nodes of the chosen fiscal year only. A plan is rewritten each year and keeps its numbering, so
 * `1.101` exists once per year and offering last year's would attach this year's money to it.
 */
const nodeOptionsFor = (fiscalYearId: unknown) =>
  nodes.value
    .filter((n) => !fiscalYearId || n.fiscalYearId === fiscalYearId)
    .map((n) => ({ label: nodeLabel(n), value: n.id }));

const id = computed(() => (route.params.id as string | undefined) || undefined);
const isEdit = computed(() => !!id.value);
const ready = ref(false);
const saving = ref(false);

// Typed by what the BUDGET reads return, not by the organisation directory's records. The pickers
// need a year and a name; the whole `fiscal_year` / `department` row was always more than that.
const fiscalYears = ref<SelectableFiscalYear[]>([]);
const departments = ref<SelectableDepartment[]>([]);
/**
 * The plan's structure. A node is where the money sits — it is the budget's identity, and the code
 * a requester picks it by. The GL account cannot be that: several budgets legitimately share one,
 * and a budget whose spending posts to several records none.
 */
const nodes = ref<BudgetNodeView[]>([]);
const currentNodeLabel = ref('');
const baseCurrencyCode = ref('');
/** The status this budget holds, which decides what the picker below may offer. */
const currentStatus = ref('');
/**
 * Only the moves the server will accept, asked of the same table it refuses on.
 *
 * The list used to be these three regardless of where the budget stood, so editing a REJECTED one
 * offered three statuses and the server refused all three: every option in the control was an
 * error, and the reader had to submit one to find out. A picker that offers a move the server
 * rejects reports a rule as a failure.
 *
 * The status it already holds is always among the candidates — `canTransitionBudget` allows a
 * status onto itself — so a budget in DRAFT or REJECTED still has a value to show and the rest of
 * the form stays editable. Its name and account can be corrected; only the money cannot move.
 */
const statusOptions = computed(() =>
  ['ACTIVE', 'INACTIVE', 'CLOSED', currentStatus.value]
    .filter((v, i, all) => v && all.indexOf(v) === i)
    .filter((v) => canTransitionBudget(currentStatus.value, v))
    .map((value) => ({ label: t(`budgets.status.${value}`), value })),
);

// The amount FIELD holds grouped text so the person sees their separators; everything downstream
// must see the plain decimal string the shared schema and the wire agree on. Stripping here rather
// than in each consumer keeps that conversion in one place, so client and server cannot drift about
// what was typed (money rule, and the one-schema rule in CLAUDE.md).
const baseResolver = computed(() => zodResolver(isEdit.value ? budgetUpdateSchema : budgetCreateSchema));
const resolver = computed(() => (e: { values: Record<string, unknown> }) => {
  const values =
    'amountTotal' in (e.values ?? {})
      ? { ...e.values, amountTotal: stripGrouping(String(e.values.amountTotal ?? '')) }
      : e.values;
  return baseResolver.value({ ...e, values } as never);
});
/**
 * What is in the amount box right now, ungrouped — the field itself is uncontrolled, so nothing
 * else can see it.
 *
 * Zero is a legitimate appropriation: a plan line the organisation spends against but never funded
 * is a real budget whose figure is nothing, and the plan importer already writes `0` for the
 * section the customer's workbook marks `ບໍ່ມີງົບ`. What zero does NOT do is announce itself — the
 * budget is created, and every document charging it is refused until someone changes the tolerance
 * ladder on the control point governing it, on a different screen this form never mentions. Saying
 * it here is the difference between a decision and a discovery six weeks later.
 */
const amountEntered = ref('');
const amountIsZero = computed(
  () => /^\d+(\.\d+)?$/.test(amountEntered.value) && Number(amountEntered.value) === 0,
);

/**
 * Field errors from the SHARED schema arrive as i18n keys; errors from a local schema arrive as
 * text already translated. Translating only what looks like one of our keys keeps both readable —
 * `A positive amount` used to reach a Lao officer as English, being the one message the form could
 * show them.
 */
const fieldError = (message: unknown): string => {
  const raw = String(message ?? '');
  return raw.startsWith('validation.') ? t(raw) : raw;
};

const initialValues = ref<Record<string, unknown>>({});
// In edit mode the amount is shown read-only (not a form field) with a hint to use Adjust.
const currentAmount = ref<string>('');
// Formatted to the budget's OWN company base-currency decimal_places, not a hardcoded 2 — the same
// rule `BudgetListView` follows, and the reason LAK reads `100,000,000` rather than
// `100,000,000.00`.
const currentDecimals = ref<number>(2);

/**
 * Why the form cannot be shown.
 *
 * This load had no error handling at all. When a read it depends on refused — `GET /fiscal-years`
 * answering 403 to a budget officer without `FISCAL_YEAR_MANAGE` — the rejection abandoned
 * `onMounted`, so the node read never ran and `initialValues` was never assigned. What rendered was
 * a form with every required picker empty and no message: indistinguishable from one nobody has
 * filled in yet, and impossible to act on. A screen that cannot load what it needs has to say so.
 */
const loadError = ref('');

onMounted(() => retryLoad());

async function retryLoad() {
  loadError.value = '';
  try {
    await load();
  } catch (e) {
    loadError.value = messageOf(e);
  }
}

async function load() {
  if (isEdit.value) {
    // The departments come along on an edit too, now that the owning one can be corrected. Read
    // through the BUDGET-scoped endpoint for the same reason the create branch does: the
    // organisation directory demands `DEPARTMENT_VIEW`, which a budget officer has no reason to
    // hold.
    const [current, dept] = await Promise.all([
      budgetsApi.get(id.value!) as Promise<any>,
      budgetsApi.selectableDepartments(),
      accounts.loadSelectable(),
    ]);
    departments.value = dept;
    currentStatus.value = current.status ?? 'ACTIVE';
    currentAmount.value = current.amountTotal;
    currentDecimals.value = current.fiscalYear?.company?.baseCurrency?.decimalPlaces ?? 2;
    baseCurrencyCode.value = current.fiscalYear?.company?.baseCurrency?.code ?? '';
    currentNodeLabel.value = current.node
      ? (current.node.name ? `${current.node.code} — ${current.node.name}` : current.node.code)
      : '';
    initialValues.value = {
      budgetName: current.budgetName ?? '',
      glAccount: current.glAccount ?? '',
      status: current.status ?? 'ACTIVE',
      departmentId: current.department?.id ?? '',
    };
  } else {
    // Read through BUDGET-scoped endpoints, not the organisation directory. The directory demands
    // `FISCAL_YEAR_MANAGE` and `DEPARTMENT_VIEW`, which a budget officer has no reason to hold — so
    // both answered 403 for the one user this form exists for, and the `Promise.all` below took the
    // rest of the load down with it.
    const [fy, dept] = await Promise.all([
      budgetsApi.selectableFiscalYears(),
      budgetsApi.selectableDepartments(),
      accounts.loadSelectable(),
    ]);
    fiscalYears.value = fy;
    departments.value = dept;
    // Every node of the company, filtered to the chosen fiscal year as soon as one is picked.
    nodes.value = await budgetsApi.nodes();
    // Best-effort: label the amount with the active company's base currency. A user without
    // company-read permission still gets the form (the addon falls back to a money icon).
    try {
      const companies = await orgApi.companies.list(1, 100);
      baseCurrencyCode.value = companies.items.find((c) => c.id === auth.activeCompanyId)?.baseCurrency?.code ?? '';
    } catch {
      baseCurrencyCode.value = '';
    }
    initialValues.value = {
      fiscalYearId: '',
      departmentId: '',
      nodeId: '',
      glAccount: '',
      budgetName: '',
      amountTotal: '',
    };
  }
  ready.value = true;
}

// Template ref to the budget <Form> so the inline create-dialogs can select the record they add.
const budgetForm = ref<{ setFieldValue: (field: string, value: unknown) => void } | null>(null);

/**
 * Regroup the amount as it is typed, keeping the caret where the person left it.
 *
 * `InputText` merges the form's own binding AFTER the attrs from here, so the form's handler runs
 * second and stores whatever `event.target.value` holds by then — which is why this rewrites the
 * element in place rather than calling `setFieldValue`. Assigning `.value` sends the caret to the
 * end, so it is put back by counting DIGITS rather than characters: separators appear and vanish as
 * the number grows, and a character offset would drift by one every time a comma is born.
 */
function onAmountInput(event: Event): void {
  const el = event.target as HTMLInputElement;
  // Mirrored out of the uncontrolled input so the zero notice below can react to it. Set BEFORE
  // the early return further down: `0` needs no regrouping, so the one value the notice exists
  // for is the one value that return would skip.
  amountEntered.value = stripGrouping(el.value);
  const caret = el.selectionStart ?? el.value.length;
  const digitsBefore = (el.value.slice(0, caret).match(/\d/g) ?? []).length;
  const grouped = groupDigits(el.value);
  if (grouped === el.value) return;
  el.value = grouped;
  let seen = 0;
  let pos = grouped.length;
  for (let i = 0; i < grouped.length; i += 1) {
    if (seen === digitsBefore) {
      pos = i;
      break;
    }
    if (/\d/.test(grouped[i])) seen += 1;
    if (seen === digitsBefore) pos = i + 1;
  }
  el.setSelectionRange(pos, pos);
}

/** Local-date → 'YYYY-MM-DD' (no UTC shift); '' for null. */
function toYmd(d: Date | null): string {
  if (!d) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** First Zod issue per top-level field, for inline messages. */
function fieldErrors(issues: Array<{ path: Array<string | number>; message: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const k = String(i.path[0] ?? '');
    if (k && !out[k]) out[k] = i.message;
  }
  return out;
}

// --- Inline "create" dialogs: add a missing fiscal year / department without leaving the budget
// form. On success we refresh the option list and select the new record via the form ref. Both
// reuse the same shared Zod schema as the org admin pages, so validation can't drift.
const fyDialog = ref(false);
const fyModel = ref<{ year: Date | null; startDate: Date | null; endDate: Date | null }>({ year: null, startDate: null, endDate: null });
const fyErr = ref<Record<string, string>>({});
const fySaving = ref(false);
function openFyDialog() {
  fyErr.value = {};
  fyModel.value = { year: new Date(new Date().getFullYear(), 0, 1), startDate: null, endDate: null };
  fyDialog.value = true;
}
async function submitFy() {
  const parsed = fiscalYearSchema.safeParse({
    year: fyModel.value.year ? fyModel.value.year.getFullYear() : NaN,
    startDate: toYmd(fyModel.value.startDate),
    endDate: toYmd(fyModel.value.endDate),
  });
  if (!parsed.success) {
    fyErr.value = fieldErrors(parsed.error.issues);
    return;
  }
  fyErr.value = {};
  fySaving.value = true;
  try {
    const created = (await orgApi.fiscalYears.create(parsed.data)) as FiscalYear;
    fiscalYears.value = await budgetsApi.selectableFiscalYears();
    budgetForm.value?.setFieldValue('fiscalYearId', created.id);
    fyDialog.value = false;
    fb.success(t('feedback.created'));
  } catch (err) {
    fb.error(err, t('budgets.form.failed'));
  } finally {
    fySaving.value = false;
  }
}

const deptDialog = ref(false);
const deptModel = ref<{ deptCode: string; name: string; costCenter: string }>({ deptCode: '', name: '', costCenter: '' });
const deptErr = ref<Record<string, string>>({});
const deptSaving = ref(false);
function openDeptDialog() {
  deptErr.value = {};
  deptModel.value = { deptCode: '', name: '', costCenter: '' };
  deptDialog.value = true;
}
async function submitDept() {
  const parsed = departmentSchema.safeParse({
    deptCode: deptModel.value.deptCode,
    name: deptModel.value.name,
    costCenter: deptModel.value.costCenter || undefined,
  });
  if (!parsed.success) {
    deptErr.value = fieldErrors(parsed.error.issues);
    return;
  }
  deptErr.value = {};
  deptSaving.value = true;
  try {
    const created = (await orgApi.departments.create(parsed.data)) as Department;
    departments.value = await budgetsApi.selectableDepartments();
    budgetForm.value?.setFieldValue('departmentId', created.id);
    deptDialog.value = false;
    fb.success(t('feedback.created'));
  } catch (err) {
    fb.error(err, t('budgets.form.failed'));
  } finally {
    deptSaving.value = false;
  }
}

// --- Inline "create" dialog: add a plan node without leaving the budget form. A plan is usually
// written before its structure exists in the system, so requiring the tree to be built first would
// stop the person who is building it.
const nodeDialog = ref(false);
const nodeModel = ref<{ code: string; name: string; parentId: string | null }>({ code: '', name: '', parentId: null });
const nodeErr = ref<Record<string, string>>({});
const nodeSaving = ref(false);
const nodeDialogFyId = ref<string>('');
function openNodeDialog(fiscalYearId: unknown) {
  nodeErr.value = {};
  nodeModel.value = { code: '', name: '', parentId: null };
  nodeDialogFyId.value = typeof fiscalYearId === 'string' ? fiscalYearId : '';
  nodeDialog.value = true;
}
async function submitNode() {
  // A node belongs to a fiscal year, so there is nothing to create until one is chosen. Said as a
  // field error rather than a disabled button, which would not say why.
  if (!nodeDialogFyId.value) {
    nodeErr.value = { code: t('budgets.form.nodeFiscalYearFirst') };
    return;
  }
  if (!nodeModel.value.code.trim()) {
    nodeErr.value = { code: t('validation.required') };
    return;
  }
  nodeErr.value = {};
  nodeSaving.value = true;
  try {
    const created = await budgetsApi.createNode({
      fiscalYearId: nodeDialogFyId.value,
      code: nodeModel.value.code.trim(),
      name: nodeModel.value.name.trim() || undefined,
      parentId: nodeModel.value.parentId ?? undefined,
    });
    nodes.value = await budgetsApi.nodes();
    budgetForm.value?.setFieldValue('nodeId', created.id);
    nodeDialog.value = false;
    fb.success(t('feedback.created'));
  } catch (err) {
    // The server owns uniqueness; surfacing its message against the code field is what tells the
    // user WHICH code clashed rather than that something went wrong.
    nodeErr.value = { code: messageOf(err) };
  } finally {
    nodeSaving.value = false;
  }
}

async function onSubmit(e: FormSubmitEvent) {
  if (!e.valid) return;
  saving.value = true;
  // Same conversion the resolver validated against — the field's grouping is a display concern and
  // never reaches the wire.
  const values: Record<string, unknown> =
    'amountTotal' in (e.values ?? {})
      ? { ...e.values, amountTotal: stripGrouping(String(e.values.amountTotal ?? '')) }
      : { ...e.values };
  try {
    if (isEdit.value) {
      await budgets.updateBudget(id.value!, values as any);
      fb.success(t('feedback.updated'));
      await router.push({ name: 'budget-detail', params: { id: id.value } });
    } else {
      // Saving PROPOSES the budget: it is drafted, then a plan is raised asking for the approval
      // that puts it in force. Routing to the plan rather than to the budget is the honest
      // destination — the budget's own page has nothing to show yet, while the plan is the thing
      // the user has to submit next.
      const { documentId } = await budgets.proposeBudget(values as any);
      fb.success(t('feedback.created'));
      await router.push({ name: 'document-detail', params: { id: documentId } });
    }
  } catch (err) {
    fb.error(err, t('budgets.form.failed'));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="w-full">
    <PageHeader
      :title="isEdit ? $t('budgets.form.editTitle') : $t('budgets.form.createTitle')"
      :subtitle="isEdit ? $t('budgets.form.subtitleEdit') : $t('budgets.form.subtitleCreate')"
    >
      <template #actions>
        <Button :label="$t('common.back')" icon="pi pi-arrow-left" text @click="router.back()" />
      </template>
    </PageHeader>

    <div class="grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">
      <!-- LEFT: decorative illustration on the page background; accent follows the theme primary. -->
      <aside class="hidden lg:flex lg:col-span-2 lg:self-center flex-col items-center justify-center gap-6 px-4">
        <ThemedIllustration :svg="rawIllustration" accent="#F50057" class="w-full max-w-sm" />
        <div class="text-center max-w-sm">
          <h2 class="text-lg font-semibold text-color m-0">{{ $t('budgets.form.section') }}</h2>
          <p class="text-muted-color text-sm mt-2 mb-0">{{ $t('budgets.form.sectionHint') }}</p>
        </div>
      </aside>

      <!-- RIGHT: the form -->
      <div class="lg:col-span-3">
    <!-- Said before the fields, not after saving: what the button does is part of deciding whether
         to fill the form in. Setting a ceiling now needs an approval, and a user who expects the
         budget to be usable on save would otherwise find out from an empty balance. -->
    <Message v-if="!isEdit && !loadError" severity="info" :closable="false" class="mb-4">
      {{ $t('budgets.plan.proposeNotice') }}
    </Message>
    <!-- A read the form depends on refused or failed. Said out loud, with the server's reason,
         rather than rendering a form whose required pickers are all empty. -->
    <ErrorState
      v-if="loadError"
      :message="loadError"
      data-testid="budget-form-load-error"
      @retry="retryLoad"
    />
    <Form
      v-else-if="ready"
      v-slot="$form"
      ref="budgetForm"
      :key="isEdit ? 'edit' : 'create'"
      :resolver="resolver"
      :initialValues="initialValues"
      @submit="onSubmit"
    >
      <Fluid>
        <div class="card mb-0!">
          <div class="flex flex-col gap-5">
            <!-- Identity & dimension: what the budget is and where it applies. -->
            <FormField name="budgetName" class="flex flex-col gap-1.5">
              <label class="text-sm font-medium text-color">{{ $t('budgets.form.budgetName') }}</label>
              <IconField>
                <InputIcon class="pi pi-wallet" />
                <InputText type="text" :placeholder="$t('budgets.form.budgetNamePlaceholder')" />
              </IconField>
            </FormField>

            <!-- The owning department, on an edit. Alone, and not beside the fiscal year: the year
                 and the plan node are the budget's identity and stay fixed, while the department is
                 a fact about the organisation and organisations reorganise. -->
            <FormField v-if="isEdit" v-slot="$f" name="departmentId" class="flex flex-col gap-1.5">
              <label class="text-sm font-medium text-color">{{ $t('budgets.form.department') }}</label>
              <div class="flex gap-2">
                <Select :options="departments" optionLabel="name" optionValue="id" filter :placeholder="$t('common.select')" :invalid="$f?.invalid" class="flex-1" data-testid="edit-department">
                  <template #dropdownicon><i class="pi pi-sitemap" /></template>
                </Select>
                <Button v-can="'DEPARTMENT_MANAGE'" type="button" icon="pi pi-plus" outlined class="shrink-0 aspect-square w-auto!" :aria-label="$t('admin.org.newDepartment')" v-tooltip.top="$t('admin.org.newDepartment')" @click="openDeptDialog" />
              </div>
              <small class="text-muted-color">{{ $t('budgets.form.departmentMoveHint') }}</small>
              <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message>
            </FormField>

            <template v-if="!isEdit">
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <FormField v-slot="$f" name="fiscalYearId" class="flex flex-col gap-1.5">
                  <label class="text-sm font-medium text-color">{{ $t('budgets.form.fiscalYear') }}</label>
                  <div class="flex gap-2">
                    <Select :options="fiscalYears" optionLabel="year" optionValue="id" :placeholder="$t('common.select')" :invalid="$f?.invalid" class="flex-1">
                      <template #dropdownicon><i class="pi pi-calendar" /></template>
                    </Select>
                    <Button v-can="'FISCAL_YEAR_MANAGE'" type="button" icon="pi pi-plus" outlined class="shrink-0 aspect-square w-auto!" :aria-label="$t('admin.org.newFiscalYear')" v-tooltip.top="$t('admin.org.newFiscalYear')" @click="openFyDialog" />
                  </div>
                  <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message>
                </FormField>

                <FormField v-slot="$f" name="departmentId" class="flex flex-col gap-1.5">
                  <label class="text-sm font-medium text-color">{{ $t('budgets.form.department') }}</label>
                  <div class="flex gap-2">
                    <Select :options="departments" optionLabel="name" optionValue="id" filter :placeholder="$t('common.select')" :invalid="$f?.invalid" class="flex-1">
                      <template #dropdownicon><i class="pi pi-sitemap" /></template>
                    </Select>
                    <Button v-can="'DEPARTMENT_MANAGE'" type="button" icon="pi pi-plus" outlined class="shrink-0 aspect-square w-auto!" :aria-label="$t('admin.org.newDepartment')" v-tooltip.top="$t('admin.org.newDepartment')" @click="openDeptDialog" />
                  </div>
                  <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message>
                </FormField>
              </div>

              <!-- The budget's IDENTITY. Presented before the account and above it, because that
                   is the relationship: the node says which plan line this money is, the account is
                   only a hint about where its spending posts. -->
              <FormField v-slot="$f" name="nodeId" class="flex flex-col gap-1.5">
                <label class="text-sm font-medium text-color">{{ $t('budgets.form.node') }}</label>
                <div class="flex gap-2">
                  <Select
                    :options="nodeOptionsFor($form.fiscalYearId?.value)"
                    optionLabel="label"
                    optionValue="value"
                    filter
                    :placeholder="$t('budgets.form.nodePlaceholder')"
                    :invalid="$f?.invalid"
                    class="flex-1"
                  >
                    <template #dropdownicon><i class="pi pi-sitemap" /></template>
                  </Select>
                  <Button
                    v-can="'BUDGET_MANAGE'"
                    type="button"
                    icon="pi pi-plus"
                    outlined
                    class="shrink-0 aspect-square w-auto!"
                    :aria-label="$t('budgets.form.newNode')"
                    v-tooltip.top="$t('budgets.form.newNode')"
                    @click="openNodeDialog($form.fiscalYearId?.value)"
                  />
                </div>
                <Message severity="secondary" variant="simple" size="small" icon="pi pi-info-circle">
                  {{ $t('budgets.form.nodeHint') }}
                </Message>
                <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message>
              </FormField>
            </template>

            <!-- Optional in BOTH modes, and correctable: it is a hint, not an identity. -->
            <FormField v-slot="$f" name="glAccount" class="flex flex-col gap-1.5">
              <label class="text-sm font-medium text-color">{{ $t('budgets.form.glAccount') }}</label>
              <Select :options="accountOptions" optionLabel="label" optionValue="value" filter showClear :placeholder="$t('budgets.form.glAccountPlaceholder')" :invalid="$f?.invalid" />
              <Message severity="secondary" variant="simple" size="small" icon="pi pi-info-circle">
                {{ $t('budgets.form.glAccountHint') }}
              </Message>
              <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message>
            </FormField>

            <!-- In edit mode the node is shown but never editable: documents and history refer to
                 this budget by its code, so rewriting it would rewrite what they appear to say. -->
            <div v-if="isEdit" class="flex flex-col gap-1.5">
              <label class="text-sm font-medium text-color">{{ $t('budgets.form.node') }}</label>
              <InputGroup>
                <InputGroupAddon><i class="pi pi-sitemap" /></InputGroupAddon>
                <InputText :modelValue="currentNodeLabel" type="text" disabled />
                <InputGroupAddon><i class="pi pi-lock text-muted-color" /></InputGroupAddon>
              </InputGroup>
              <Message severity="secondary" variant="simple" size="small" icon="pi pi-info-circle">
                {{ $t('budgets.form.nodeReadonlyHint') }}
              </Message>
            </div>

            <Divider class="my-1!" />

            <!-- Amount & control policy. -->
            <template v-if="!isEdit">
              <FormField v-slot="$f" name="amountTotal" class="flex flex-col gap-1.5 max-w-sm">
                <label class="text-sm font-medium text-color">{{ $t('budgets.form.amountTotal') }}</label>
                <!-- A decimal STRING (money rule). InputText keeps it a string end-to-end. -->
                <InputGroup>
                  <InputGroupAddon>
                    <span v-if="baseCurrencyCode" class="text-sm font-medium">{{ baseCurrencyCode }}</span>
                    <i v-else class="pi pi-money-bill" />
                  </InputGroupAddon>
                  <InputText type="text" inputmode="decimal" placeholder="0.00" class="text-right" :invalid="$f?.invalid" @input="onAmountInput" />
                </InputGroup>
                <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ fieldError($f.error?.message) }}</Message>
                <!-- Zero is accepted, and says what it will do. Not an error: the save must go
                     through, because an unfunded line is a real line. -->
                <Message
                  v-else-if="amountIsZero"
                  severity="warn"
                  size="small"
                  variant="simple"
                  icon="pi pi-exclamation-triangle"
                  data-testid="zero-amount-notice"
                >
                  {{ $t('budgets.form.zeroAmountNotice') }}
                </Message>
              </FormField>
            </template>
            <template v-else>
              <div class="flex flex-col gap-1.5 max-w-sm">
                <label class="text-sm font-medium text-color">{{ $t('budgets.form.amountTotal') }}</label>
                <InputGroup>
                  <InputGroupAddon>
                    <span v-if="baseCurrencyCode" class="text-sm font-medium">{{ baseCurrencyCode }}</span>
                    <i v-else class="pi pi-money-bill" />
                  </InputGroupAddon>
                  <InputText :modelValue="formatAmount(currentAmount, currentDecimals)" type="text" disabled class="text-right" />
                  <InputGroupAddon><i class="pi pi-lock text-muted-color" /></InputGroupAddon>
                </InputGroup>
                <Message severity="secondary" variant="simple" size="small" icon="pi pi-info-circle">
                  {{ $t('budgets.form.amountReadonlyHint') }}
                </Message>
              </div>
            </template>

            <FormField v-if="isEdit" v-slot="$f" name="status" class="flex flex-col gap-1.5 max-w-xs">
              <label class="text-sm font-medium text-color">{{ $t('common.status') }}</label>
              <Select :options="statusOptions" optionLabel="label" optionValue="value" :invalid="$f?.invalid" />
              <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message>
            </FormField>
          </div>
        </div>
      </Fluid>

      <div class="flex justify-end gap-2 mt-2">
        <Button :label="$t('common.cancel')" severity="secondary" text @click="router.back()" />
        <Button v-can="'BUDGET_MANAGE'" type="submit" :loading="saving" :icon="isEdit ? 'pi pi-check' : 'pi pi-plus'" :label="isEdit ? $t('common.save') : $t('common.create')" />
      </div>
    </Form>
      </div>
    </div>

    <!-- Inline create: new fiscal year -->
    <Dialog v-model:visible="fyDialog" :header="$t('admin.org.newFiscalYear')" modal class="w-96">
      <Fluid>
        <div class="flex flex-col gap-3">
          <div class="flex flex-col gap-1">
            <label class="text-sm text-muted-color">{{ $t('admin.org.fields.year') }}</label>
            <DatePicker v-model="fyModel.year" view="year" dateFormat="yy" />
            <Message v-if="fyErr.year" severity="error" size="small" variant="simple">{{ fyErr.year }}</Message>
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm text-muted-color">{{ $t('admin.org.fields.startDate') }}</label>
            <DatePicker v-model="fyModel.startDate" showButtonBar dateFormat="yy-mm-dd" />
            <Message v-if="fyErr.startDate" severity="error" size="small" variant="simple">{{ fyErr.startDate }}</Message>
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm text-muted-color">{{ $t('admin.org.fields.endDate') }}</label>
            <DatePicker v-model="fyModel.endDate" showButtonBar dateFormat="yy-mm-dd" />
            <Message v-if="fyErr.endDate" severity="error" size="small" variant="simple">{{ fyErr.endDate }}</Message>
          </div>
          <div class="flex justify-end gap-2">
            <Button :label="$t('common.cancel')" text @click="fyDialog = false" />
            <Button :label="$t('common.create')" icon="pi pi-check" :loading="fySaving" @click="submitFy" />
          </div>
        </div>
      </Fluid>
    </Dialog>

    <!-- Inline create: new plan node -->
    <Dialog v-model:visible="nodeDialog" :header="$t('budgets.form.newNode')" modal class="w-96">
      <Fluid>
        <div class="flex flex-col gap-3">
          <div class="flex flex-col gap-1">
            <label class="text-sm text-muted-color">{{ $t('budgets.form.nodeCode') }}</label>
            <InputText v-model="nodeModel.code" :placeholder="$t('budgets.form.nodeCodePlaceholder')" />
            <Message v-if="nodeErr.code" severity="error" size="small" variant="simple">{{ nodeErr.code }}</Message>
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm text-muted-color">{{ $t('budgets.form.nodeName') }}</label>
            <InputText v-model="nodeModel.name" />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm text-muted-color">{{ $t('budgets.form.nodeParent') }}</label>
            <Select
              v-model="nodeModel.parentId"
              :options="nodeOptionsFor(nodeDialogFyId)"
              optionLabel="label"
              optionValue="value"
              filter
              showClear
              :placeholder="$t('budgets.form.nodeParentNone')"
            />
          </div>
          <div class="flex justify-end gap-2">
            <Button :label="$t('common.cancel')" text @click="nodeDialog = false" />
            <Button :label="$t('common.create')" icon="pi pi-check" :loading="nodeSaving" @click="submitNode" />
          </div>
        </div>
      </Fluid>
    </Dialog>

    <!-- Inline create: new department -->
    <Dialog v-model:visible="deptDialog" :header="$t('admin.org.newDepartment')" modal class="w-96">
      <Fluid>
        <div class="flex flex-col gap-3">
          <div class="flex flex-col gap-1">
            <label class="text-sm text-muted-color">{{ $t('common.code') }}</label>
            <InputText v-model="deptModel.deptCode" />
            <Message v-if="deptErr.deptCode" severity="error" size="small" variant="simple">{{ deptErr.deptCode }}</Message>
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm text-muted-color">{{ $t('common.name') }}</label>
            <InputText v-model="deptModel.name" />
            <Message v-if="deptErr.name" severity="error" size="small" variant="simple">{{ deptErr.name }}</Message>
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm text-muted-color">{{ $t('admin.org.fields.costCenter') }}</label>
            <InputText v-model="deptModel.costCenter" />
          </div>
          <div class="flex justify-end gap-2">
            <Button :label="$t('common.cancel')" text @click="deptDialog = false" />
            <Button :label="$t('common.create')" icon="pi pi-check" :loading="deptSaving" @click="submitDept" />
          </div>
        </div>
      </Fluid>
    </Dialog>
  </div>
</template>
