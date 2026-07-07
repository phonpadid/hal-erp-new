<script setup lang="ts">
import { onboardEmployeeSchema } from '@erp/shared';
import AutoComplete from 'primevue/autocomplete';
import Button from 'primevue/button';
import DatePicker from 'primevue/datepicker';
import Fluid from 'primevue/fluid';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Select from 'primevue/select';
import Step from 'primevue/step';
import StepList from 'primevue/steplist';
import StepPanel from 'primevue/steppanel';
import StepPanels from 'primevue/steppanels';
import Stepper from 'primevue/stepper';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import ThemedIllustration from '@/components/ThemedIllustration.vue';
import rawIllustration from '@/assets/illustrations/undraw_user-account_fvqa.svg?raw';
import rawAccessIllustration from '@/assets/illustrations/undraw_all-checked_d3u6.svg?raw';
import rawReviewIllustration from '@/assets/illustrations/undraw_information-tab_6nod.svg?raw';
import { api } from '../../api/client';
import { rbacApi } from '../../api/rbac';
import type { Employee } from '../../api/employees';
import { employeesApi } from '../../api/employees';
import { useAuthStore } from '../../stores/auth';
import { useEmployeeAdminStore } from '../../stores/employeeAdmin';
import { useFeedback } from '../../composables/useFeedback';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const employees = useEmployeeAdminStore();
const fb = useFeedback();
const { t } = useI18n();

const employeeId = String(route.params.id);
const stepValue = ref('1');
const emp = ref<Employee | null>(null);
const roles = ref<Array<{ id: string; name: string; code: string }>>([]);
const departments = ref<Array<{ id: string; name: string }>>([]);

// Company is fixed to the active company (server takes it from context, never the body).
const activeCompanyName = computed(
  () => auth.companies.find((c) => c.id === auth.activeCompanyId)?.nameTh ?? '',
);

const model = ref<{
  username: string;
  email: string;
  roleId: string;
  departmentId: string;
  validFrom: Date | null;
  validTo: Date | null;
}>({ username: '', email: '', roleId: '', departmentId: '', validFrom: null, validTo: null });
const err = ref<Record<string, string>>({});

/** Local-date → 'YYYY-MM-DD' (no UTC shift). */
function toYmd(d: Date | null): string | undefined {
  if (!d) return undefined;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fieldErrors(issues: Array<{ path: Array<string | number>; message: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const k = String(i.path[0] ?? '');
    if (k && !out[k]) out[k] = i.message;
  }
  return out;
}
/** Clear a field's inline error the moment the user edits it, so a corrected field stops
 * showing red immediately (instead of only on the next validate/Next). */
function clearErr(field: string) {
  if (err.value[field]) delete err.value[field];
}

// Email domain autocomplete: suggest completing the address with common providers (gmail first).
const EMAIL_DOMAINS = ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com'];
const emailSuggestions = ref<string[]>([]);
function onEmailComplete(e: { query: string }) {
  const q = e.query ?? '';
  const at = q.indexOf('@');
  if (at === -1) {
    // No '@' yet — offer "<typed>@<domain>" for each provider.
    emailSuggestions.value = q ? EMAIL_DOMAINS.map((d) => `${q}@${d}`) : [];
  } else {
    // Filter providers by the partial domain the user has started typing.
    const local = q.slice(0, at);
    const typed = q.slice(at + 1).toLowerCase();
    emailSuggestions.value = EMAIL_DOMAINS.filter((d) => d.startsWith(typed)).map((d) => `${local}@${d}`);
  }
}
/** The onboarding payload (validity as 'YYYY-MM-DD' strings, empties dropped). */
function payload() {
  return {
    username: model.value.username,
    email: model.value.email,
    roleId: model.value.roleId,
    departmentId: model.value.departmentId,
    validFrom: toYmd(model.value.validFrom),
    validTo: toYmd(model.value.validTo),
  };
}

/** Validate only the given fields against the shared schema; sets `err` and returns ok. */
function validateFields(fields: string[]): boolean {
  const parsed = onboardEmployeeSchema.safeParse(payload());
  const issues = parsed.success ? [] : parsed.error.issues.filter((i) => fields.includes(String(i.path[0])));
  err.value = fieldErrors(issues);
  return issues.length === 0;
}

function nextFromAccount() {
  if (validateFields(['username', 'email'])) stepValue.value = '2';
}
function nextFromAccess() {
  if (validateFields(['roleId', 'departmentId', 'validFrom', 'validTo'])) stepValue.value = '3';
}

const roleName = computed(() => roles.value.find((r) => r.id === model.value.roleId)?.name ?? '');
const departmentName = computed(() => departments.value.find((d) => d.id === model.value.departmentId)?.name ?? '');

async function submit() {
  const parsed = onboardEmployeeSchema.safeParse(payload());
  if (!parsed.success) {
    err.value = fieldErrors(parsed.error.issues);
    return;
  }
  err.value = {};
  if (await employees.onboard(employeeId, parsed.data)) {
    fb.success(t('feedback.done'));
    router.push({ name: 'employee-admin' });
  } else fb.error(employees.error);
}

onMounted(async () => {
  // Mirror the server's both-codes guard: the route gates EMPLOYEE_MANAGE; enforce RBAC_MANAGE here.
  if (!auth.can('RBAC_MANAGE')) {
    router.replace({ name: 'employee-admin' });
    return;
  }
  emp.value = await employeesApi.get(employeeId).catch(() => null);
  if (emp.value?.hasAccount) {
    // Already has an account — nothing to onboard.
    router.replace({ name: 'employee-admin' });
    return;
  }
  // Default the department to the employee's own.
  if (emp.value) model.value.departmentId = emp.value.departmentId;
  roles.value = await rbacApi.roles(1, 200).then((r) => r.items).catch(() => []);
  departments.value = await api
    .get('/departments', { params: { limit: 200 } })
    .then((r) => (Array.isArray(r.data) ? r.data : r.data.items))
    .catch(() => []);
});
</script>

<template>
  <div>
    <PageHeader :title="$t('admin.onboard.title', { name: emp?.fullName ?? '' })" />
    <div class="card">
      <Stepper v-model:value="stepValue" linear>
        <StepList>
          <Step value="1">{{ $t('admin.onboard.steps.account') }}</Step>
          <Step value="2">{{ $t('admin.onboard.steps.access') }}</Step>
          <Step value="3">{{ $t('admin.onboard.steps.review') }}</Step>
        </StepList>
        <StepPanels>
          <!-- Step 1: Account -->
          <StepPanel value="1">
            <div class="mt-4 grid grid-cols-1 lg:grid-cols-5 gap-8 lg:items-center">
              <!-- LEFT: decorative illustration; accent follows the theme primary. -->
              <aside class="hidden lg:flex lg:col-span-2 flex-col items-center justify-center gap-6 px-4">
                <ThemedIllustration :svg="rawIllustration" accent="#F50057" class="w-full max-w-xs" />
                <div class="text-center max-w-sm">
                  <h2 class="text-lg font-semibold text-color m-0">{{ $t('admin.onboard.steps.account') }}</h2>
                  <p class="text-muted-color text-sm mt-2 mb-0">{{ $t('admin.employee.createAccountHelp') }}</p>
                </div>
              </aside>

              <!-- RIGHT: the account form -->
              <div class="lg:col-span-3">
                <Fluid class="flex flex-col gap-6">
                  <div class="flex flex-col gap-5">
                    <div class="flex flex-col gap-1.5">
                      <label class="text-sm font-medium">{{ $t('admin.employee.fields.username') }}</label>
                      <InputText v-model="model.username" :invalid="!!err.username" @update:modelValue="clearErr('username')" />
                      <Message v-if="err.username" severity="error" size="small" variant="simple">{{ err.username }}</Message>
                    </div>
                    <div class="flex flex-col gap-1.5">
                      <label class="text-sm font-medium">{{ $t('admin.employee.fields.email') }}</label>
                      <AutoComplete
                        v-model="model.email"
                        :suggestions="emailSuggestions"
                        :completeOnFocus="false"
                        fluid
                        :invalid="!!err.email"
                        @complete="onEmailComplete"
                        @update:modelValue="clearErr('email')"
                      />
                      <Message v-if="err.email" severity="error" size="small" variant="simple">{{ err.email }}</Message>
                    </div>
                  </div>
                  <div class="flex justify-end border-t border-surface-200 dark:border-surface-700 pt-5">
                    <Button :label="$t('common.next')" icon="pi pi-arrow-right" iconPos="right" @click="nextFromAccount" />
                  </div>
                </Fluid>
              </div>
            </div>
          </StepPanel>

          <!-- Step 2: Access -->
          <StepPanel value="2">
            <div class="mt-4 grid grid-cols-1 lg:grid-cols-5 gap-8 lg:items-center">
              <!-- LEFT: decorative illustration; accent follows the theme primary. -->
              <aside class="hidden lg:flex lg:col-span-2 flex-col items-center justify-center gap-6 px-4">
                <ThemedIllustration :svg="rawAccessIllustration" accent="#F50057" class="w-full max-w-xs" />
                <div class="text-center max-w-sm">
                  <h2 class="text-lg font-semibold text-color m-0">{{ $t('admin.onboard.steps.access') }}</h2>
                  <p class="text-muted-color text-sm mt-2 mb-0">{{ $t('admin.onboard.accessHelp') }}</p>
                </div>
              </aside>

              <!-- RIGHT: the access form -->
              <div class="lg:col-span-3">
                <Fluid class="flex flex-col gap-6">
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
                    <div class="flex flex-col gap-1.5">
                      <label class="text-sm font-medium">{{ $t('admin.onboard.fields.company') }}</label>
                      <InputText :value="activeCompanyName" disabled />
                    </div>
                    <div class="flex flex-col gap-1.5">
                      <label class="text-sm font-medium">{{ $t('admin.onboard.fields.department') }}</label>
                      <Select
                        v-model="model.departmentId"
                        :options="departments"
                        optionLabel="name"
                        optionValue="id"
                        :invalid="!!err.departmentId"
                        :placeholder="$t('admin.employee.fields.departmentPlaceholder')"
                        @update:modelValue="clearErr('departmentId')"
                      />
                      <Message v-if="err.departmentId" severity="error" size="small" variant="simple">{{ err.departmentId }}</Message>
                    </div>
                    <div class="flex flex-col gap-1.5 sm:col-span-2">
                      <label class="text-sm font-medium">{{ $t('admin.onboard.fields.role') }}</label>
                      <Select
                        v-model="model.roleId"
                        :options="roles"
                        optionLabel="name"
                        optionValue="id"
                        filter
                        :invalid="!!err.roleId"
                        :placeholder="$t('admin.onboard.fields.rolePlaceholder')"
                        @update:modelValue="clearErr('roleId')"
                      />
                      <Message v-if="err.roleId" severity="error" size="small" variant="simple">{{ err.roleId }}</Message>
                    </div>
                    <div class="flex flex-col gap-1.5">
                      <label class="text-sm font-medium">{{ $t('admin.onboard.fields.validFrom') }}</label>
                      <DatePicker v-model="model.validFrom" dateFormat="yy-mm-dd" showIcon />
                    </div>
                    <div class="flex flex-col gap-1.5">
                      <label class="text-sm font-medium">{{ $t('admin.onboard.fields.validTo') }}</label>
                      <DatePicker v-model="model.validTo" dateFormat="yy-mm-dd" showIcon />
                    </div>
                  </div>
                  <div class="flex justify-between border-t border-surface-200 dark:border-surface-700 pt-5">
                    <Button :label="$t('common.back')" icon="pi pi-arrow-left" text @click="stepValue = '1'" />
                    <Button :label="$t('common.next')" icon="pi pi-arrow-right" iconPos="right" @click="nextFromAccess" />
                  </div>
                </Fluid>
              </div>
            </div>
          </StepPanel>

          <!-- Step 3: Review -->
          <StepPanel value="3">
            <div class="mt-4 grid grid-cols-1 lg:grid-cols-5 gap-8 lg:items-center">
              <!-- LEFT: decorative illustration; accent follows the theme primary. -->
              <aside class="hidden lg:flex lg:col-span-2 flex-col items-center justify-center gap-6 px-4">
                <ThemedIllustration :svg="rawReviewIllustration" accent="#F50057" class="w-full max-w-xs" />
                <div class="text-center max-w-sm">
                  <h2 class="text-lg font-semibold text-color m-0">{{ $t('admin.onboard.steps.review') }}</h2>
                  <p class="text-muted-color text-sm mt-2 mb-0">{{ $t('admin.onboard.reviewHelp') }}</p>
                </div>
              </aside>

              <!-- RIGHT: the summary + confirm -->
              <div class="lg:col-span-3">
                <div class="flex flex-col gap-6">
                  <div class="rounded-lg border border-surface-200 dark:border-surface-700 divide-y divide-surface-200 dark:divide-surface-700">
                    <div class="flex justify-between gap-4 px-4 py-3"><span class="text-muted-color">{{ $t('admin.employee.fields.username') }}</span><span class="font-medium">{{ model.username }}</span></div>
                    <div class="flex justify-between gap-4 px-4 py-3"><span class="text-muted-color">{{ $t('admin.employee.fields.email') }}</span><span class="font-medium">{{ model.email }}</span></div>
                    <div class="flex justify-between gap-4 px-4 py-3"><span class="text-muted-color">{{ $t('admin.onboard.fields.company') }}</span><span class="font-medium">{{ activeCompanyName }}</span></div>
                    <div class="flex justify-between gap-4 px-4 py-3"><span class="text-muted-color">{{ $t('admin.onboard.fields.department') }}</span><span class="font-medium">{{ departmentName }}</span></div>
                    <div class="flex justify-between gap-4 px-4 py-3"><span class="text-muted-color">{{ $t('admin.onboard.fields.role') }}</span><span class="font-medium">{{ roleName }}</span></div>
                  </div>
                  <div class="flex justify-between border-t border-surface-200 dark:border-surface-700 pt-5">
                    <Button :label="$t('common.back')" icon="pi pi-arrow-left" text @click="stepValue = '2'" />
                    <Button :label="$t('admin.onboard.confirm')" icon="pi pi-check" @click="submit" />
                  </div>
                </div>
              </div>
            </div>
          </StepPanel>
        </StepPanels>
      </Stepper>
    </div>
  </div>
</template>
