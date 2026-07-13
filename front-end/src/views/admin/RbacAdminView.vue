<script setup lang="ts">
import { assignRoleBaseSchema, assignRoleSchema, attachPermissionSchema, createRoleSchema, SCOPES } from '@erp/shared';
import { Form, FormField } from '@primevue/forms';
import { zodResolver } from '@primevue/forms/resolvers/zod';
import Button from 'primevue/button';
import Chip from 'primevue/chip';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import DatePicker from 'primevue/datepicker';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import Tab from 'primevue/tab';
import TabList from 'primevue/tablist';
import TabPanel from 'primevue/tabpanel';
import TabPanels from 'primevue/tabpanels';
import Tabs from 'primevue/tabs';
import ToggleSwitch from 'primevue/toggleswitch';
import { FilterMatchMode } from '@primevue/core/api';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFeedback } from '../../composables/useFeedback';
import PageHeader from '@/components/PageHeader.vue';
import PageToolbar from '@/components/PageToolbar.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import AppDataTable from '@/components/AppDataTable.vue';
import { api } from '../../api/client';
import { rbacApi } from '../../api/rbac';
import { useAuthStore } from '../../stores/auth';
import { useRbacAdminStore } from '../../stores/rbacAdmin';
import type { FormSubmitEvent } from '@primevue/forms';
import type { AdminRole, AdminUser, CatalogPermission, CrossCompanyAssignment, RoleGrant, UserAssignment } from '../../api/rbac';

const auth = useAuthStore();
const rbac = useRbacAdminStore();
const fb = useFeedback();
const { t } = useI18n();
const departments = ref<Array<{ id: string; name: string }>>([]);
const scopeOptions = SCOPES.map((s) => ({ label: s, value: s }));

const roleDialog = ref(false);
// Per-role permission manager. Hold the role id (not the object) so the grant list stays
// bound to the live store role after add/remove + reload, instead of a stale snapshot.
const manageDialog = ref<{ open: boolean; roleId?: string }>({ open: false });
const manageFilter = ref('');
const expandedModules = ref<Set<string>>(new Set());
// How many grant codes to preview inline in the roles table before "+N more".
const SUMMARY_GRANTS = 3;
// Bucket for grants/permissions whose module is unknown (localized label at render).
const OTHER_MODULE = '__other__';
const assignDialog = ref<{ open: boolean; user?: AdminUser }>({ open: false });
// Acting / temporary authority: a validity window held outside the Form (DatePicker binds
// a Date; the shared schema carries dates as 'YYYY-MM-DD' strings).
const acting = ref(false);
const actingFrom = ref<Date | null>(null);
const actingTo = ref<Date | null>(null);
const assignWindowErr = ref('');
// Read-only cross-company view of one user's active assignments.
const crossDialog = ref<{ open: boolean; user?: AdminUser; rows: CrossCompanyAssignment[]; loading: boolean }>({
  open: false,
  rows: [],
  loading: false,
});

/** Local-date → 'YYYY-MM-DD' (no UTC shift). */
function toYmd(d: Date | null): string {
  if (!d) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const todayYmd = toYmd(new Date());
const soonYmd = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return toYmd(d);
})();

/** A grant's validity state: expired (past valid_to), expiring (within 7 days), or none. */
function windowState(a: { validFrom?: string; validTo?: string }): 'expired' | 'expiring' | 'none' {
  if (a.validTo && a.validTo < todayYmd) return 'expired';
  if (a.validTo && a.validTo <= soonYmd) return 'expiring';
  return 'none';
}
/** Short window label, e.g. "2026-01-01 → 2026-03-31", empty when standing. */
function windowLabel(a: { validFrom?: string; validTo?: string }): string {
  if (!a.validFrom && !a.validTo) return '';
  return `${a.validFrom ?? '…'} → ${a.validTo ?? '…'}`;
}
function assignmentLabel(a: UserAssignment): string {
  return `${a.roleCode} @ ${a.departmentName}${a.isDefault ? ' ★' : ''}`;
}
const roleFilters = ref({ global: { value: null as string | null, matchMode: FilterMatchMode.CONTAINS } });
const userFilters = ref({ global: { value: null as string | null, matchMode: FilterMatchMode.CONTAINS } });

const createRoleResolver = zodResolver(createRoleSchema);
// Resolve only the fields the form actually renders. roleId is a context value (the role
// being managed), NOT a FormField — validating the full schema here makes zodResolver fail
// on the always-absent roleId, which blanks out the submit event's `values` entirely (the
// add silently never fires). Merge + full-validate roleId in submitGrant instead.
const attachResolver = zodResolver(attachPermissionSchema.omit({ roleId: true }));
// Same trap as attach: userId is a context value (the user being assigned), NOT a rendered
// FormField, so validating the full schema fails on the always-absent userId and blanks the
// submit event's `values` — the assign silently never fires. Merge + full-validate userId
// (and the acting window) in submitAssign instead.
const assignResolver = zodResolver(assignRoleBaseSchema.omit({ userId: true }));

async function submitRole(e: FormSubmitEvent) {
  if (!e.valid) return;
  if (await rbac.createRole(e.values)) {
    roleDialog.value = false;
    fb.success(t('feedback.created'));
  } else fb.error(rbac.error);
}
async function submitGrant(e: FormSubmitEvent) {
  if (!e.valid) return;
  // roleId is a context field (the role being managed), not a rendered FormField, so
  // @primevue/forms never tracks it in e.values — merge it from the dialog explicitly and
  // re-validate the COMPLETE payload (roleId included) against the shared schema.
  const parsed = attachPermissionSchema.safeParse({ ...e.values, roleId: manageDialog.value.roleId });
  if (!parsed.success) {
    fb.error(t('feedback.errorFallback'));
    return;
  }
  // Stays in the manage dialog: the new grant simply appears in the live grant list.
  if (await rbac.attachPermission(parsed.data)) {
    fb.success(t('feedback.created'));
  } else fb.error(rbac.error);
}

// Module per permission code, from the (fully loaded) catalog — used to group grants.
const moduleByCode = computed(() => {
  const m = new Map<string, string>();
  for (const p of rbac.permissions) m.set(p.code, p.module);
  return m;
});
function moduleLabel(module: string): string {
  return module === OTHER_MODULE ? t('admin.rbac.otherModule') : module;
}
function groupByModule<T>(rows: T[], moduleOf: (row: T) => string): Array<{ module: string; items: T[] }> {
  const buckets = new Map<string, T[]>();
  for (const row of rows) {
    const mod = moduleOf(row) || OTHER_MODULE;
    (buckets.get(mod) ?? buckets.set(mod, []).get(mod)!).push(row);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([module, items]) => ({ module, items }));
}

// The live role currently open in the manage dialog (re-derived from the store).
const manageRole = computed<AdminRole | undefined>(() => rbac.roles.find((r) => r.id === manageDialog.value.roleId));
// The open role's grants, filtered by text and grouped by module, for the manage dialog.
const manageGroups = computed(() => {
  const role = manageRole.value;
  if (!role) return [];
  const q = manageFilter.value.trim().toLowerCase();
  const filtered = q
    ? role.permissions.filter((g) => `${g.code} ${g.name}`.toLowerCase().includes(q))
    : role.permissions;
  return groupByModule<RoleGrant>(filtered, (g) => moduleByCode.value.get(g.code) ?? OTHER_MODULE);
});
// The add-grant picker (option groups): the catalog minus permissions this role already
// holds, so the admin can't pick a duplicate (a role holds each permission only once —
// the server rejects re-adds with a 409). Detach a grant first to re-add it with a new scope.
const permissionGroups = computed(() => {
  const held = new Set(manageRole.value?.permissions.map((g) => g.code) ?? []);
  const selectable = rbac.permissions.filter((p) => !held.has(p.code));
  return groupByModule<CatalogPermission>(selectable, (p) => p.module ?? OTHER_MODULE);
});

function openManage(role: AdminRole) {
  manageFilter.value = '';
  expandedModules.value = new Set(); // collapsed by default
  manageDialog.value = { open: true, roleId: role.id };
}
function toggleModule(module: string) {
  const next = new Set(expandedModules.value);
  next.has(module) ? next.delete(module) : next.add(module);
  expandedModules.value = next;
}
function openAssign(user: AdminUser) {
  acting.value = false;
  actingFrom.value = null;
  actingTo.value = null;
  assignWindowErr.value = '';
  assignDialog.value = { open: true, user };
}
async function submitAssign(e: FormSubmitEvent) {
  if (!e.valid) return;
  // Merge the acting window (held outside the Form) and re-validate it against the same
  // shared schema so valid_to >= valid_from is enforced client-side too.
  const payload = {
    ...e.values,
    // userId is a context field (the user being assigned), not a rendered FormField, so it
    // isn't in e.values — merge it from the dialog explicitly.
    userId: assignDialog.value.user?.id,
    validFrom: acting.value && actingFrom.value ? toYmd(actingFrom.value) : undefined,
    validTo: acting.value && actingTo.value ? toYmd(actingTo.value) : undefined,
  };
  const parsed = assignRoleSchema.safeParse(payload);
  if (!parsed.success) {
    assignWindowErr.value = parsed.error.issues.find((i) => i.path[0] === 'validTo')?.message
      ?? t('admin.rbac.acting.invalidWindow');
    return;
  }
  assignWindowErr.value = '';
  if (await rbac.assign(parsed.data)) {
    assignDialog.value.open = false;
    fb.success(t('feedback.created'));
  } else fb.error(rbac.error);
}

async function openCrossCompany(user: AdminUser) {
  crossDialog.value = { open: true, user, rows: [], loading: true };
  try {
    crossDialog.value.rows = await rbacApi.userAssignments(user.id);
  } catch (e) {
    fb.error((e as Error).message);
  } finally {
    crossDialog.value.loading = false;
  }
}
async function detachPermission(roleId: string, code: string) {
  if (!(await fb.confirm({ message: t('feedback.confirm.detachPermission') }))) return;
  if (await rbac.detachPermission(roleId, code)) fb.success(t('feedback.done'));
  else fb.error(rbac.error);
}
async function removeAssignment(a: UserAssignment) {
  if (!(await fb.confirm({ message: t('feedback.confirm.removeAssignment') }))) return;
  if (await rbac.removeAssignment(a.id)) fb.success(t('feedback.done'));
  else fb.error(rbac.error);
}
async function revokeAccess(userId: string, companyId: string) {
  if (!(await fb.confirm({ message: t('feedback.confirm.revokeAccess') }))) return;
  if (await rbac.revokeAccess(userId, companyId)) fb.success(t('feedback.done'));
  else fb.error(rbac.error);
}

onMounted(async () => {
  rbac.loadAll();
  // /departments returns a Paginated<Department> ({ items, total, … }); the Select needs
  // the array, so unwrap .items (tolerate a bare array too, in case the shape changes).
  departments.value = await api
    .get('/departments', { params: { limit: 200 } })
    .then((r) => (Array.isArray(r.data) ? r.data : r.data.items))
    .catch(() => []);
});
</script>

<template>
  <div>
    <PageHeader :title="$t('admin.rbac.title')" />

    <ErrorState v-if="rbac.error" :message="rbac.error" @retry="rbac.loadAll()" />

    <div v-else class="card">
    <Tabs value="roles">
      <TabList>
        <Tab value="roles">{{ $t('admin.rbac.tabs.roles') }}</Tab>
        <Tab value="users">{{ $t('admin.rbac.tabs.users') }}</Tab>
      </TabList>
      <TabPanels>
        <!-- Roles -->
        <TabPanel value="roles">
          <PageToolbar :search="roleFilters.global.value ?? ''" @update:search="roleFilters.global.value = $event">
            <template #actions>
              <Button :label="$t('admin.rbac.newRole')" icon="pi pi-plus" size="small" @click="roleDialog = true" />
            </template>
          </PageToolbar>
          <AppDataTable
            :value="rbac.roles"
            :total="rbac.roles.length"
            :loading="rbac.loading"
            :filters="roleFilters"
            :globalFilterFields="['code', 'name']"
            @refresh="rbac.loadAll()"
          >
            <Column field="code" :header="$t('common.code')" />
            <Column field="name" :header="$t('common.name')" />
            <Column :header="$t('admin.rbac.columns.permissions')">
              <template #body="{ data }">
                <!-- Bounded summary: count + a few codes + "+N more"; constant row height
                     regardless of how many grants the role has. Full list lives in Manage. -->
                <div class="flex items-center gap-2 overflow-hidden">
                  <template v-if="data.permissions.length">
                    <span class="text-sm font-medium whitespace-nowrap">{{ $t('admin.rbac.grantCount', { count: data.permissions.length }) }}</span>
                    <Chip v-for="p in data.permissions.slice(0, SUMMARY_GRANTS)" :key="p.code" :label="p.code" class="whitespace-nowrap" />
                    <span v-if="data.permissions.length > SUMMARY_GRANTS" class="text-muted-color text-sm whitespace-nowrap">
                      {{ $t('admin.rbac.moreCount', { count: data.permissions.length - SUMMARY_GRANTS }) }}
                    </span>
                  </template>
                  <span v-else class="text-muted-color text-sm">{{ $t('admin.rbac.noGrants') }}</span>
                </div>
              </template>
            </Column>
            <Column header="">
              <template #body="{ data }">
                <Button :label="$t('admin.rbac.manage')" icon="pi pi-sliders-h" text size="small" @click="openManage(data)" />
              </template>
            </Column>
            <template #empty>
              <EmptyState icon="pi pi-id-card" :title="$t('admin.rbac.empty.roles')" />
            </template>
          </AppDataTable>
        </TabPanel>

        <!-- Users -->
        <TabPanel value="users">
          <PageToolbar :search="userFilters.global.value ?? ''" @update:search="userFilters.global.value = $event" />
          <AppDataTable
            :value="rbac.users"
            :total="rbac.usersTotal"
            :loading="rbac.loading"
            :page="rbac.usersPage"
            :rows="rbac.usersLimit"
            :filters="userFilters"
            :globalFilterFields="['username', 'email']"
            @page="(e: { page: number; limit: number }) => rbac.loadUsers(e.page, e.limit)"
            @refresh="rbac.loadUsers()"
          >
            <Column field="username" :header="$t('admin.rbac.columns.user')" />
            <Column field="email" :header="$t('admin.rbac.columns.email')" />
            <Column :header="$t('admin.rbac.columns.assignments')">
              <template #body="{ data }">
                <div class="flex flex-wrap items-center gap-1">
                  <span v-for="a in data.assignments" :key="a.id" class="inline-flex items-center gap-1">
                    <Chip :label="assignmentLabel(a)" removable @remove="removeAssignment(a)" />
                    <span v-if="windowLabel(a)" class="text-muted-color text-xs">{{ windowLabel(a) }}</span>
                    <Tag
                      v-if="windowState(a) !== 'none'"
                      :value="$t(`admin.rbac.window.${windowState(a)}`)"
                      :severity="windowState(a) === 'expired' ? 'danger' : 'warn'"
                    />
                  </span>
                  <span v-if="!data.assignments.length" class="text-muted-color text-sm">{{ $t('common.none') }}</span>
                </div>
              </template>
            </Column>
            <Column header="">
              <template #body="{ data }">
                <div class="flex items-center gap-1">
                  <Button
                    :title="$t('admin.rbac.assign')"
                    icon="pi pi-user-plus"
                    text
                    size="small"
                    :aria-label="$t('admin.rbac.assign')"
                    @click="openAssign(data)"
                  />
                  <Button
                    :title="$t('admin.rbac.viewAcross')"
                    icon="pi pi-building"
                    text
                    size="small"
                    :aria-label="$t('admin.rbac.viewAcross')"
                    @click="openCrossCompany(data)"
                  />
                  <Button
                    v-if="data.assignments.length"
                    :title="$t('admin.rbac.revokeAll')"
                    icon="pi pi-ban"
                    text
                    size="small"
                    severity="danger"
                    :aria-label="$t('admin.rbac.revokeAll')"
                    @click="revokeAccess(data.id, auth.activeCompanyId!)"
                  />
                </div>
              </template>
            </Column>
            <template #empty>
              <EmptyState icon="pi pi-users" :title="$t('admin.rbac.empty.users')" />
            </template>
          </AppDataTable>
        </TabPanel>
      </TabPanels>
    </Tabs>
    </div>

    <!-- New role -->
    <Dialog v-model:visible="roleDialog" :header="$t('admin.rbac.newRole')" modal class="w-96">
      <Form :resolver="createRoleResolver" :initialValues="{ code: '', name: '', description: '' }" class="flex flex-col gap-3" @submit="submitRole">
        <FormField v-slot="$field" name="code" class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('common.code') }}</label><InputText type="text" />
          <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}</Message>
        </FormField>
        <FormField v-slot="$field" name="name" class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('common.name') }}</label><InputText type="text" />
          <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}</Message>
        </FormField>
        <div class="flex justify-end gap-2"><Button :label="$t('common.cancel')" text @click="roleDialog = false" /><Button type="submit" :label="$t('common.create')" /></div>
      </Form>
    </Dialog>

    <!-- Manage permissions (per role): grouped, filterable, scrollable grant list + add -->
    <Dialog
      v-model:visible="manageDialog.open"
      :header="$t('admin.rbac.manageTitle', { code: manageRole?.code })"
      modal
      class="w-xl"
    >
      <div class="flex flex-col gap-4">
        <!-- Add grant -->
        <Form
          :key="manageRole?.id"
          :resolver="attachResolver"
          :initialValues="{ roleId: manageRole?.id, permissionCode: '', scope: 'DEPARTMENT' }"
          class="flex items-start gap-2"
          @submit="submitGrant"
        >
          <FormField v-slot="$field" name="permissionCode" class="flex flex-1 flex-col gap-1">
            <label class="text-sm text-muted-color">{{ $t('admin.rbac.fields.permission') }}</label>
            <Select
              :options="permissionGroups"
              optionLabel="code"
              optionValue="code"
              optionGroupLabel="module"
              optionGroupChildren="items"
              filter
              :placeholder="$t('admin.rbac.fields.permissionPlaceholder')"
            >
              <template #optiongroup="{ option }">{{ moduleLabel(option.module) }}</template>
            </Select>
            <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}</Message>
          </FormField>
          <FormField v-slot="$field" name="scope" class="flex w-40 flex-col gap-1">
            <label class="text-sm text-muted-color">{{ $t('admin.rbac.fields.scope') }}</label>
            <Select :options="scopeOptions" optionLabel="label" optionValue="value" />
            <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}</Message>
          </FormField>
          <Button type="submit" :label="$t('admin.rbac.grant')" class="mt-6" />
        </Form>

        <!-- Filter -->
        <InputText v-model="manageFilter" :placeholder="$t('admin.rbac.filterPlaceholder')" class="w-full" />

        <!-- Grant list: per-module collapsible sections, confined to a fixed-height scroll -->
        <div class="max-h-80 overflow-y-auto rounded border border-surface-200 dark:border-surface-700">
          <div v-if="!manageGroups.length" class="p-4 text-center text-muted-color text-sm">
            {{ manageFilter ? $t('admin.rbac.noMatches') : $t('admin.rbac.noGrants') }}
          </div>
          <div v-for="g in manageGroups" :key="g.module" class="border-b border-surface-200 last:border-b-0 dark:border-surface-700">
            <button
              type="button"
              class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-surface-100 dark:hover:bg-surface-800"
              @click="toggleModule(g.module)"
            >
              <span class="flex items-center gap-2 font-medium">
                <i :class="['pi text-xs', expandedModules.has(g.module) ? 'pi-chevron-down' : 'pi-chevron-right']" />
                {{ moduleLabel(g.module) }}
              </span>
              <span class="text-muted-color text-sm">{{ g.items.length }}</span>
            </button>
            <div v-show="expandedModules.has(g.module)" class="flex flex-wrap gap-1 px-3 pb-3">
              <Chip
                v-for="p in g.items"
                :key="p.code"
                :label="`${p.code} · ${p.scope}`"
                removable
                @remove="detachPermission(manageDialog.roleId!, p.code)"
              />
            </div>
          </div>
        </div>
      </div>
    </Dialog>

    <!-- Assign role -->
    <Dialog v-model:visible="assignDialog.open" :header="$t('admin.rbac.assignTo', { username: assignDialog.user?.username })" modal class="w-96">
      <Form :key="assignDialog.user?.id" :resolver="assignResolver" :initialValues="{ userId: assignDialog.user?.id, roleId: '', departmentId: '', isDefault: false }" class="flex flex-col gap-3" @submit="submitAssign">
        <FormField v-slot="$field" name="roleId" class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('admin.rbac.fields.role') }}</label>
          <Select :options="rbac.roles" optionLabel="code" optionValue="id" :placeholder="$t('admin.rbac.fields.rolePlaceholder')" />
          <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}</Message>
        </FormField>
        <FormField v-slot="$field" name="departmentId" class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('admin.rbac.fields.department') }}</label>
          <Select :options="departments" optionLabel="name" optionValue="id" :placeholder="$t('admin.rbac.fields.departmentPlaceholder')" />
          <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}</Message>
        </FormField>
        <FormField name="isDefault" class="flex items-center gap-2">
          <ToggleSwitch /><label class="text-sm text-muted-color">{{ $t('admin.rbac.fields.isDefault') }}</label>
        </FormField>
        <!-- Acting / temporary authority: reveals a validity window (rbac: Time-Bounded Grants). -->
        <div class="flex items-center gap-2">
          <ToggleSwitch v-model="acting" /><label class="text-sm text-muted-color">{{ $t('admin.rbac.acting.toggle') }}</label>
        </div>
        <div v-if="acting" class="flex flex-col gap-3">
          <div class="flex flex-col gap-1">
            <label class="text-sm text-muted-color">{{ $t('admin.rbac.acting.validFrom') }}</label>
            <DatePicker v-model="actingFrom" showButtonBar dateFormat="yy-mm-dd" />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm text-muted-color">{{ $t('admin.rbac.acting.validTo') }}</label>
            <DatePicker v-model="actingTo" showButtonBar dateFormat="yy-mm-dd" />
          </div>
          <Message v-if="assignWindowErr" severity="error" size="small" variant="simple">{{ assignWindowErr }}</Message>
        </div>
        <div class="flex justify-end gap-2"><Button :label="$t('common.cancel')" text @click="assignDialog.open = false" /><Button type="submit" :label="$t('admin.rbac.assign')" /></div>
      </Form>
    </Dialog>

    <!-- Cross-company assignments (read-only) -->
    <Dialog
      v-model:visible="crossDialog.open"
      :header="$t('admin.rbac.crossCompany.title', { username: crossDialog.user?.username })"
      modal
      class="w-160"
    >
      <DataTable :value="crossDialog.rows" :loading="crossDialog.loading" dataKey="id" scrollable scrollHeight="400px">
        <Column field="companyName" :header="$t('admin.rbac.crossCompany.company')" />
        <Column field="roleCode" :header="$t('admin.rbac.fields.role')" />
        <Column field="departmentName" :header="$t('admin.rbac.fields.department')" />
        <Column :header="$t('admin.rbac.crossCompany.window')">
          <template #body="{ data }">
            <span class="text-sm">{{ windowLabel(data) || '—' }}</span>
            <Tag
              v-if="windowState(data) !== 'none'"
              class="ml-1"
              :value="$t(`admin.rbac.window.${windowState(data)}`)"
              :severity="windowState(data) === 'expired' ? 'danger' : 'warn'"
            />
          </template>
        </Column>
        <template #empty>
          <EmptyState icon="pi pi-building" :title="$t('admin.rbac.crossCompany.empty')" />
        </template>
      </DataTable>
    </Dialog>
  </div>
</template>
