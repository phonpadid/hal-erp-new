<script setup lang="ts">
import { budgetCreateSchema, budgetUpdateSchema, departmentSchema, fiscalYearSchema } from '@erp/shared';
import { Form, FormField } from '@primevue/forms';
import { zodResolver } from '@primevue/forms/resolvers/zod';
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
import SelectButton from 'primevue/selectbutton';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import ThemedIllustration from '@/components/ThemedIllustration.vue';
import rawIllustration from '@/assets/illustrations/undraw_empty-wallet_j0kn.svg?raw';
import { orgApi } from '../../api/org';
import type { Department, FiscalYear } from '../../api/org';
import { budgetsApi } from '../../api/budgets';
import { useAuthStore } from '../../stores/auth';
import { useBudgetsStore } from '../../stores/budgets';
import { useAccountsStore } from '../../stores/accounts';
import { useFeedback } from '../../composables/useFeedback';
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

const id = computed(() => (route.params.id as string | undefined) || undefined);
const isEdit = computed(() => !!id.value);
const ready = ref(false);
const saving = ref(false);

const fiscalYears = ref<FiscalYear[]>([]);
const departments = ref<Department[]>([]);
const baseCurrencyCode = ref('');
const policyOptions = computed(() => [
  { label: t('budgets.policy.HARD_STOP'), value: 'HARD_STOP' },
  { label: t('budgets.policy.SOFT_WARNING'), value: 'SOFT_WARNING' },
]);
const statusOptions = computed(() => [
  { label: t('budgets.status.ACTIVE'), value: 'ACTIVE' },
  { label: t('budgets.status.INACTIVE'), value: 'INACTIVE' },
  { label: t('budgets.status.CLOSED'), value: 'CLOSED' },
]);

const resolver = computed(() => zodResolver(isEdit.value ? budgetUpdateSchema : budgetCreateSchema));
const initialValues = ref<Record<string, unknown>>({});
// In edit mode the amount is shown read-only (not a form field) with a hint to use Adjust.
const currentAmount = ref<string>('');

onMounted(async () => {
  if (isEdit.value) {
    const current: any = await budgetsApi.get(id.value!);
    currentAmount.value = current.amountTotal;
    baseCurrencyCode.value = current.fiscalYear?.company?.baseCurrency?.code ?? '';
    initialValues.value = {
      budgetName: current.budgetName ?? '',
      controlPolicy: current.controlPolicy ?? 'HARD_STOP',
      status: current.status ?? 'ACTIVE',
    };
  } else {
    const [fy, dept] = await Promise.all([
      orgApi.fiscalYears.list(1, 100),
      orgApi.departments.list(1, 100),
      accounts.loadSelectable(),
    ]);
    fiscalYears.value = fy.items;
    departments.value = dept.items;
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
      glAccount: '',
      budgetName: '',
      amountTotal: '',
      controlPolicy: 'HARD_STOP',
    };
  }
  ready.value = true;
});

// Template ref to the budget <Form> so the inline create-dialogs can select the record they add.
const budgetForm = ref<{ setFieldValue: (field: string, value: unknown) => void } | null>(null);

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
    fiscalYears.value = (await orgApi.fiscalYears.list(1, 100)).items;
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
    departments.value = (await orgApi.departments.list(1, 100)).items;
    budgetForm.value?.setFieldValue('departmentId', created.id);
    deptDialog.value = false;
    fb.success(t('feedback.created'));
  } catch (err) {
    fb.error(err, t('budgets.form.failed'));
  } finally {
    deptSaving.value = false;
  }
}

async function onSubmit(e: FormSubmitEvent) {
  if (!e.valid) return;
  saving.value = true;
  try {
    if (isEdit.value) {
      await budgets.updateBudget(id.value!, e.values as any);
      fb.success(t('feedback.updated'));
      await router.push({ name: 'budget-detail', params: { id: id.value } });
    } else {
      const created = await budgets.createBudget(e.values as any);
      fb.success(t('feedback.created'));
      await router.push({ name: 'budget-detail', params: { id: created.id } });
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
    <Form
      v-if="ready"
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

              <FormField v-slot="$f" name="glAccount" class="flex flex-col gap-1.5">
                <label class="text-sm font-medium text-color">{{ $t('budgets.form.glAccount') }}</label>
                <Select :options="accountOptions" optionLabel="label" optionValue="value" filter :placeholder="$t('budgets.form.glAccountPlaceholder')" :invalid="$f?.invalid" />
                <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message>
              </FormField>
            </template>

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
                  <InputText type="text" inputmode="decimal" placeholder="0.00" class="text-right" :invalid="$f?.invalid" />
                </InputGroup>
                <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message>
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
                  <InputText :modelValue="currentAmount" type="text" disabled class="text-right" />
                  <InputGroupAddon><i class="pi pi-lock text-muted-color" /></InputGroupAddon>
                </InputGroup>
                <Message severity="secondary" variant="simple" size="small" icon="pi pi-info-circle">
                  {{ $t('budgets.form.amountReadonlyHint') }}
                </Message>
              </div>
            </template>

            <FormField v-slot="$f" name="controlPolicy" class="flex flex-col gap-1.5">
              <label class="text-sm font-medium text-color">{{ $t('budgets.form.controlPolicy') }}</label>
              <SelectButton :options="policyOptions" optionLabel="label" optionValue="value" :allowEmpty="false" />
              <small class="flex items-center gap-1.5 text-muted-color">
                <i :class="($f.value || 'HARD_STOP') === 'HARD_STOP' ? 'pi pi-ban' : 'pi pi-exclamation-triangle'" />
                {{ $t('budgets.policyDesc.' + ($f.value || 'HARD_STOP')) }}
              </small>
            </FormField>

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
