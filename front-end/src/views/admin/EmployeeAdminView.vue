<script setup lang="ts">
import { EMPLOYEE_STATUSES, createUserAccountSchema, employeeLinkSchema, employeeUpdateSchema } from '@erp/shared';
import Button from 'primevue/button';
import Column from 'primevue/column';
import DatePicker from 'primevue/datepicker';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Select from 'primevue/select';
import SelectButton from 'primevue/selectbutton';
import Tag from 'primevue/tag';
import ToggleSwitch from 'primevue/toggleswitch';
import { FilterMatchMode } from '@primevue/core/api';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useFeedback } from '../../composables/useFeedback';
import PageHeader from '@/components/PageHeader.vue';
import PageToolbar from '@/components/PageToolbar.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import AppDataTable from '@/components/AppDataTable.vue';
import { api } from '../../api/client';
import { useAuthStore } from '../../stores/auth';
import { useEmployeeAdminStore } from '../../stores/employeeAdmin';
import { useJobLevelsStore } from '../../stores/jobLevels';
import { storeToRefs } from 'pinia';
import type { Employee } from '../../api/employees';

const auth = useAuthStore();
const employees = useEmployeeAdminStore();
const jobLevels = useJobLevelsStore();
// Active job levels for the edit Select; submits the level `code` (employee.job_level value).
const { selectable: jobLevelOptions } = storeToRefs(jobLevels);
const fb = useFeedback();
const router = useRouter();
const { t } = useI18n();

const canSeeSalary = computed(() => auth.can('EMP_SALARY_VIEW'));
// Onboarding (create account + grant access) needs BOTH codes, mirroring the server guard.
const canOnboard = computed(() => auth.can('EMPLOYEE_MANAGE') && auth.can('RBAC_MANAGE'));
function onboard(emp: Employee) {
  router.push({ name: 'employee-onboard', params: { id: emp.id } });
}
const departments = ref<Array<{ id: string; name: string }>>([]);
const statusOptions = EMPLOYEE_STATUSES.map((s) => ({ label: s, value: s }));
const filters = ref({ global: { value: null as string | null, matchMode: FilterMatchMode.CONTAINS } });

// DatePicker binds a Date; the shared schema (one source of truth with the backend DTO)
// carries hireDate as a 'YYYY-MM-DD' string — convert + validate against the same schema.
const empDialog = ref<{ open: boolean; edit?: Employee }>({ open: false });
const empModel = ref<{
  empCode: string; fullName: string; departmentId: string; position: string;
  jobLevel: string; hireDate: Date | null; salary: string; status: string;
}>({ empCode: '', fullName: '', departmentId: '', position: '', jobLevel: '', hireDate: null, salary: '', status: 'ACTIVE' });
const empErr = ref<Record<string, string>>({});

const linkDialog = ref<{ open: boolean; emp?: Employee }>({ open: false });
// 'existing' links an already-created app_user by UUID; 'create' creates a new account
// (username + email; password is set server-side from USER_PASSWORD) and links it in one step.
const linkMode = ref<'existing' | 'create'>('existing');
const linkModeOptions = computed(() => [
  { label: t('admin.employee.linkMode.existing'), value: 'existing' },
  { label: t('admin.employee.linkMode.create'), value: 'create' },
]);
const linkModel = ref<{ userId: string }>({ userId: '' });
const acctModel = ref<{ username: string; email: string }>({ username: '', email: '' });
const linkErr = ref<Record<string, string>>({});

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

// Editing only — creating an employee happens on the dedicated employee-create page.
function openEmp(edit: Employee) {
  empErr.value = {};
  empModel.value = {
    empCode: edit.empCode, fullName: edit.fullName, departmentId: edit.departmentId,
    position: edit.position ?? '', jobLevel: edit.jobLevel ?? '',
    hireDate: edit.hireDate ? new Date(edit.hireDate) : null,
    salary: edit.salary ?? '', status: edit.status,
  };
  empDialog.value = { open: true, edit };
}

async function submitEmp() {
  if (!empDialog.value.edit) return;
  // Optional fields collapse '' → undefined so empty inputs don't fail string-only checks.
  const base = {
    fullName: empModel.value.fullName,
    departmentId: empModel.value.departmentId,
    position: empModel.value.position || undefined,
    jobLevel: empModel.value.jobLevel || undefined,
    hireDate: empModel.value.hireDate ? toYmd(empModel.value.hireDate) : undefined,
    // Salary is only sent when the editor is allowed to see/set it.
    salary: canSeeSalary.value ? empModel.value.salary || undefined : undefined,
    status: empModel.value.status,
  };
  const parsed = employeeUpdateSchema.safeParse(base);
  if (!parsed.success) {
    empErr.value = fieldErrors(parsed.error.issues);
    return;
  }
  empErr.value = {};
  if (await employees.update(empDialog.value.edit.id, parsed.data)) {
    empDialog.value.open = false;
    fb.success(t('feedback.updated'));
  } else fb.error(employees.error);
}

function openLink(emp: Employee) {
  linkErr.value = {};
  linkMode.value = 'existing';
  linkModel.value = { userId: '' };
  acctModel.value = { username: '', email: '' };
  linkDialog.value = { open: true, emp };
  // Load the unlinked accounts for the existing-mode picker.
  employees.loadLinkable();
}
// Options for the picker: label shows "username — email", value is the account id.
const linkableOptions = computed(() =>
  employees.linkable.map((a) => ({ value: a.id, label: `${a.username} — ${a.email}` })),
);
async function submitLink() {
  const empId = linkDialog.value.emp!.id;
  if (linkMode.value === 'create') {
    const parsed = createUserAccountSchema.safeParse({ ...acctModel.value });
    if (!parsed.success) {
      linkErr.value = fieldErrors(parsed.error.issues);
      return;
    }
    linkErr.value = {};
    if (await employees.createAccount(empId, parsed.data)) {
      linkDialog.value.open = false;
      fb.success(t('feedback.done'));
    } else fb.error(employees.error);
    return;
  }
  const parsed = employeeLinkSchema.safeParse({ userId: linkModel.value.userId });
  if (!parsed.success) {
    linkErr.value = fieldErrors(parsed.error.issues);
    return;
  }
  linkErr.value = {};
  if (await employees.link(empId, parsed.data.userId)) {
    linkDialog.value.open = false;
    fb.success(t('feedback.done'));
  } else fb.error(employees.error);
}
// Verify-only: turning the switch on marks the account verified (escape hatch when mail is off).
// The switch is disabled once verified, so this only ever runs for an off→on transition.
async function verifyAccount(emp: Employee) {
  if (emp.emailVerified) return;
  if (await employees.verifyAccount(emp.id)) fb.success(t('feedback.done'));
  else fb.error(employees.error);
}
async function unlink(emp: Employee) {
  if (!(await fb.confirm({ message: t('admin.employee.confirm.unlink') }))) return;
  if (await employees.unlink(emp.id)) fb.success(t('feedback.done'));
  else fb.error(employees.error);
}
async function resign(emp: Employee) {
  if (!(await fb.confirm({ message: t('admin.employee.confirm.resign') }))) return;
  if (await employees.resign(emp.id)) fb.success(t('feedback.done'));
  else fb.error(employees.error);
}

onMounted(async () => {
  employees.load();
  // Active job levels for the edit Select (reloads via the store on company switch).
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
    <PageHeader :title="$t('admin.employee.title')" />

    <PageToolbar :search="filters.global.value ?? ''" @update:search="filters.global.value = $event">
      <template #actions>
        <Button :label="$t('admin.employee.newEmployee')" icon="pi pi-plus" size="small" @click="router.push({ name: 'employee-create' })" />
      </template>
    </PageToolbar>

    <ErrorState v-if="employees.error" :message="employees.error" @retry="employees.load()" />

    <div v-else class="card">
      <AppDataTable
        :value="employees.employees"
        :total="employees.total"
        :loading="employees.loading"
        :page="employees.page"
        :rows="employees.limit"
        :filters="filters"
        :globalFilterFields="['empCode', 'fullName', 'position']"
        @page="(e: { page: number; limit: number }) => employees.load(e.page, e.limit)"
        @refresh="employees.load()"
      >
        <Column field="empCode" :header="$t('admin.employee.columns.empCode')" />
        <Column field="fullName" :header="$t('admin.employee.columns.fullName')" />
        <Column field="departmentName" :header="$t('admin.employee.columns.department')" />
        <Column field="position" :header="$t('admin.employee.columns.position')" />
        <Column :header="$t('admin.employee.columns.account')">
          <template #body="{ data }">
            <Tag
              :value="data.hasAccount ? $t('admin.employee.linked') : $t('admin.employee.noAccount')"
              :severity="data.hasAccount ? 'success' : 'secondary'"
            />
          </template>
        </Column>
        <Column :header="$t('admin.employee.columns.verified')">
          <template #body="{ data }">
            <div v-if="data.hasAccount" class="flex items-center gap-2">
              <!-- Verify-only: disabled once verified so it cannot be turned back off. -->
              <ToggleSwitch
                :modelValue="data.emailVerified"
                :disabled="data.emailVerified"
                @update:modelValue="verifyAccount(data)"
              />
              <span class="text-sm text-muted-color">
                {{ data.emailVerified ? $t('admin.employee.verified') : $t('admin.employee.unverified') }}
              </span>
            </div>
          </template>
        </Column>
        <Column v-if="canSeeSalary" :header="$t('admin.employee.columns.salary')">
          <template #body="{ data }">{{ data.salary ?? '—' }}</template>
        </Column>
        <Column :header="$t('common.status')">
          <template #body="{ data }">
            <Tag :value="data.status" :severity="data.status === 'ACTIVE' ? 'success' : 'contrast'" />
          </template>
        </Column>
        <Column header="" frozen alignFrozen="right">
          <template #body="{ data }">
            <div class="flex items-center gap-1">
              <Button
                v-tooltip.top="$t('common.edit')"
                :aria-label="$t('common.edit')"
                icon="pi pi-pencil"
                text
                rounded
                size="small"
                @click="openEmp(data)"
              />
              <Button
                v-if="!data.hasAccount"
                v-tooltip.top="$t('admin.employee.linkAccount')"
                :aria-label="$t('admin.employee.linkAccount')"
                icon="pi pi-link"
                text
                rounded
                size="small"
                @click="openLink(data)"
              />
              <Button
                v-if="!data.hasAccount && canOnboard"
                v-tooltip.top="$t('admin.onboard.action')"
                :aria-label="$t('admin.onboard.action')"
                icon="pi pi-user-plus"
                text
                rounded
                size="small"
                @click="onboard(data)"
              />
              <Button
                v-if="data.hasAccount"
                v-tooltip.top="$t('admin.employee.unlink')"
                :aria-label="$t('admin.employee.unlink')"
                icon="pi pi-user-minus"
                text
                rounded
                size="small"
                @click="unlink(data)"
              />
              <Button
                v-if="data.status === 'ACTIVE'"
                v-tooltip.top="$t('admin.employee.resign')"
                :aria-label="$t('admin.employee.resign')"
                icon="pi pi-sign-out"
                text
                rounded
                size="small"
                severity="danger"
                @click="resign(data)"
              />
            </div>
          </template>
        </Column>
        <template #empty>
          <EmptyState icon="pi pi-id-card" :title="$t('admin.employee.empty')" />
        </template>
      </AppDataTable>
    </div>

    <!-- Edit employee (creating happens on the dedicated employee-create page) -->
    <Dialog
      v-model:visible="empDialog.open"
      :header="$t('admin.employee.editEmployee')"
      modal
      class="w-96"
    >
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('admin.employee.fields.empCode') }}</label>
          <InputText v-model="empModel.empCode" disabled />
          <Message v-if="empErr.empCode" severity="error" size="small" variant="simple">{{ empErr.empCode }}</Message>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('admin.employee.fields.fullName') }}</label>
          <InputText v-model="empModel.fullName" />
          <Message v-if="empErr.fullName" severity="error" size="small" variant="simple">{{ empErr.fullName }}</Message>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('admin.employee.fields.department') }}</label>
          <Select v-model="empModel.departmentId" :options="departments" optionLabel="name" optionValue="id" :placeholder="$t('admin.employee.fields.departmentPlaceholder')" />
          <Message v-if="empErr.departmentId" severity="error" size="small" variant="simple">{{ empErr.departmentId }}</Message>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('admin.employee.fields.position') }}</label>
          <InputText v-model="empModel.position" />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('admin.employee.fields.jobLevel') }}</label>
          <Select
            v-model="empModel.jobLevel"
            :options="jobLevelOptions"
            optionLabel="name"
            optionValue="code"
            :placeholder="$t('admin.employee.fields.jobLevelPlaceholder')"
            showClear
          />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('admin.employee.fields.hireDate') }}</label>
          <DatePicker v-model="empModel.hireDate" showButtonBar dateFormat="yy-mm-dd" />
        </div>
        <div v-if="canSeeSalary" class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('admin.employee.fields.salary') }}</label>
          <InputText v-model="empModel.salary" inputmode="decimal" />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('common.status') }}</label>
          <Select v-model="empModel.status" :options="statusOptions" optionLabel="label" optionValue="value" />
        </div>
        <div class="flex justify-end gap-2">
          <Button :label="$t('common.cancel')" text @click="empDialog.open = false" />
          <Button :label="$t('common.save')" @click="submitEmp" />
        </div>
      </div>
    </Dialog>

    <!-- Link to a login account: link an existing app_user, or create + link a new one -->
    <Dialog v-model:visible="linkDialog.open" :header="$t('admin.employee.linkTo', { name: linkDialog.emp?.fullName })" modal class="w-96">
      <div class="flex flex-col gap-3">
        <SelectButton v-model="linkMode" :options="linkModeOptions" optionLabel="label" optionValue="value" :allowEmpty="false" />

        <template v-if="linkMode === 'existing'">
          <div class="flex flex-col gap-1">
            <label class="text-sm text-muted-color">{{ $t('admin.employee.fields.account') }}</label>
            <Select
              v-model="linkModel.userId"
              :options="linkableOptions"
              optionLabel="label"
              optionValue="value"
              filter
              :loading="employees.linkableLoading"
              :placeholder="$t('admin.employee.fields.accountPlaceholder')"
              :emptyMessage="$t('admin.employee.fields.accountEmpty')"
            />
            <Message v-if="linkErr.userId" severity="error" size="small" variant="simple">{{ linkErr.userId }}</Message>
          </div>
        </template>

        <template v-else>
          <div class="flex flex-col gap-1">
            <label class="text-sm text-muted-color">{{ $t('admin.employee.fields.username') }}</label>
            <InputText v-model="acctModel.username" />
            <Message v-if="linkErr.username" severity="error" size="small" variant="simple">{{ linkErr.username }}</Message>
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm text-muted-color">{{ $t('admin.employee.fields.email') }}</label>
            <InputText v-model="acctModel.email" type="email" />
            <Message v-if="linkErr.email" severity="error" size="small" variant="simple">{{ linkErr.email }}</Message>
          </div>
          <small class="text-muted-color">{{ $t('admin.employee.createAccountHelp') }}</small>
        </template>

        <div class="flex justify-end gap-2">
          <Button :label="$t('common.cancel')" text @click="linkDialog.open = false" />
          <Button
            :label="linkMode === 'create' ? $t('admin.employee.createAccount') : $t('admin.employee.linkAccount')"
            @click="submitLink"
          />
        </div>
      </div>
    </Dialog>
  </div>
</template>
