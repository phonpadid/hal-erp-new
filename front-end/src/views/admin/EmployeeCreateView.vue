<script setup lang="ts">
import { employeeCreateSchema } from '@erp/shared';
import Button from 'primevue/button';
import DatePicker from 'primevue/datepicker';
import Divider from 'primevue/divider';
import Fluid from 'primevue/fluid';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Select from 'primevue/select';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import ThemedIllustration from '@/components/ThemedIllustration.vue';
import rawIllustration from '@/assets/illustrations/undraw_online-profile_v9c1.svg?raw';
import { api } from '../../api/client';
import { useAuthStore } from '../../stores/auth';
import { useEmployeeAdminStore } from '../../stores/employeeAdmin';
import { useJobLevelsStore } from '../../stores/jobLevels';
import { useFeedback } from '../../composables/useFeedback';
import { storeToRefs } from 'pinia';

const auth = useAuthStore();
const employees = useEmployeeAdminStore();
const jobLevels = useJobLevelsStore();
const fb = useFeedback();
const router = useRouter();
const { t } = useI18n();

// Salary is sensitive: only editable by callers holding EMP_SALARY_VIEW (mirrors the server).
const canSeeSalary = auth.can('EMP_SALARY_VIEW');
const departments = ref<Array<{ id: string; name: string }>>([]);
// Active job levels for the Select; submits the level `code` (what employee.job_level stores).
const { selectable: jobLevelOptions } = storeToRefs(jobLevels);

// DatePicker binds a Date; the shared schema (one source of truth with the backend DTO)
// carries hireDate as a 'YYYY-MM-DD' string — convert + validate against the same schema.
const empModel = ref<{
  empCode: string; fullName: string; departmentId: string; position: string;
  jobLevel: string; hireDate: Date | null; salary: string; status: string;
}>({ empCode: '', fullName: '', departmentId: '', position: '', jobLevel: '', hireDate: null, salary: '', status: 'ACTIVE' });
const empErr = ref<Record<string, string>>({});
const saving = ref(false);

/** Local-date → 'YYYY-MM-DD' (no UTC shift). */
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

function cancel() {
  router.push({ name: 'employee-admin' });
}

async function submitEmp() {
  // Optional fields collapse '' → undefined so empty inputs don't fail string-only checks.
  const base = {
    empCode: empModel.value.empCode,
    fullName: empModel.value.fullName,
    departmentId: empModel.value.departmentId,
    position: empModel.value.position || undefined,
    jobLevel: empModel.value.jobLevel || undefined,
    hireDate: empModel.value.hireDate ? toYmd(empModel.value.hireDate) : undefined,
    // Salary is only sent when the editor is allowed to see/set it.
    salary: canSeeSalary ? empModel.value.salary || undefined : undefined,
    status: empModel.value.status,
  };
  const parsed = employeeCreateSchema.safeParse(base);
  if (!parsed.success) {
    empErr.value = fieldErrors(parsed.error.issues);
    return;
  }
  empErr.value = {};
  saving.value = true;
  const ok = await employees.create(parsed.data);
  saving.value = false;
  if (ok) {
    fb.success(t('feedback.created'));
    router.push({ name: 'employee-admin' });
  } else fb.error(employees.error);
}

onMounted(async () => {
  // Active job levels for the active company (reloads via the store on company switch). Fired
  // independently so it isn't blocked by the departments fetch.
  jobLevels.loadSelectable();
  // /departments returns a Paginated<Department>; unwrap .items for the Select.
  departments.value = await api
    .get('/departments', { params: { limit: 200 } })
    .then((r) => (Array.isArray(r.data) ? r.data : r.data.items))
    .catch(() => []);
});
</script>

<template>
  <div>
    <PageHeader :title="$t('admin.employee.newEmployee')" :subtitle="$t('admin.employee.createPage.subtitle')">
      <template #actions>
        <Button :label="$t('common.cancel')" icon="pi pi-arrow-left" text size="small" @click="cancel" />
      </template>
    </PageHeader>

    <div class="grid grid-cols-1 lg:grid-cols-5 gap-8 lg:items-center">
      <!-- LEFT: decorative illustration on the page background (not inside the form card) -->
      <aside class="hidden lg:flex lg:col-span-2 flex-col items-center justify-center gap-6 px-4">
        <ThemedIllustration :svg="rawIllustration" accent="#F50057" class="w-full max-w-sm" />
        <div class="text-center max-w-sm">
          <h2 class="text-lg font-semibold text-color m-0">{{ $t('admin.employee.newEmployee') }}</h2>
          <p class="text-muted-color text-sm mt-2 mb-0">{{ $t('admin.employee.createPage.helper') }}</p>
        </div>
      </aside>

      <!-- RIGHT: the form, in its own card -->
      <div class="card mb-0! lg:col-span-3">
        <Fluid>
          <div class="flex flex-col gap-5">
            <div class="flex flex-col gap-1.5">
              <label class="text-sm font-medium text-color">
                {{ $t('admin.employee.fields.empCode') }} <span class="text-red-500">*</span>
              </label>
              <IconField>
                <InputIcon class="pi pi-id-card" />
                <InputText v-model="empModel.empCode" :invalid="!!empErr.empCode" autofocus />
              </IconField>
              <Message v-if="empErr.empCode" severity="error" size="small" variant="simple">{{ empErr.empCode }}</Message>
            </div>

            <div class="flex flex-col gap-1.5">
              <label class="text-sm font-medium text-color">
                {{ $t('admin.employee.fields.fullName') }} <span class="text-red-500">*</span>
              </label>
              <IconField>
                <InputIcon class="pi pi-user" />
                <InputText v-model="empModel.fullName" :invalid="!!empErr.fullName" />
              </IconField>
              <Message v-if="empErr.fullName" severity="error" size="small" variant="simple">{{ empErr.fullName }}</Message>
            </div>

            <div class="flex flex-col gap-1.5">
              <label class="text-sm font-medium text-color">
                {{ $t('admin.employee.fields.department') }} <span class="text-red-500">*</span>
              </label>
              <Select v-model="empModel.departmentId" :options="departments" optionLabel="name" optionValue="id" filter :invalid="!!empErr.departmentId" :placeholder="$t('admin.employee.fields.departmentPlaceholder')">
                <template #dropdownicon><i class="pi pi-sitemap" /></template>
              </Select>
              <Message v-if="empErr.departmentId" severity="error" size="small" variant="simple">{{ empErr.departmentId }}</Message>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div class="flex flex-col gap-1.5">
                <label class="text-sm font-medium text-color">{{ $t('admin.employee.fields.position') }}</label>
                <IconField>
                  <InputIcon class="pi pi-briefcase" />
                  <InputText v-model="empModel.position" />
                </IconField>
              </div>
              <div class="flex flex-col gap-1.5">
                <label class="text-sm font-medium text-color">{{ $t('admin.employee.fields.jobLevel') }}</label>
                <Select
                  v-model="empModel.jobLevel"
                  :options="jobLevelOptions"
                  optionLabel="name"
                  optionValue="code"
                  :placeholder="$t('admin.employee.fields.jobLevelPlaceholder')"
                  showClear
                />
              </div>
            </div>

            <div class="grid grid-cols-1 gap-4" :class="canSeeSalary ? 'sm:grid-cols-2' : ''">
              <div class="flex flex-col gap-1.5">
                <label class="text-sm font-medium text-color">{{ $t('admin.employee.fields.hireDate') }}</label>
                <DatePicker v-model="empModel.hireDate" showButtonBar dateFormat="yy-mm-dd" showIcon iconDisplay="input" />
              </div>
              <div v-if="canSeeSalary" class="flex flex-col gap-1.5">
                <label class="text-sm font-medium text-color">{{ $t('admin.employee.fields.salary') }}</label>
                <IconField>
                  <InputIcon class="pi pi-money-bill" />
                  <InputText v-model="empModel.salary" inputmode="decimal" />
                </IconField>
              </div>
            </div>

            <Divider class="my-1!" />

            <div class="flex justify-end gap-2">
              <Button :label="$t('common.cancel')" severity="secondary" text @click="cancel" />
              <Button :label="$t('common.create')" icon="pi pi-check" :loading="saving" @click="submitEmp" />
            </div>
          </div>
        </Fluid>
      </div>
    </div>
  </div>
</template>
