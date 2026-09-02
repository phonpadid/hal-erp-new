<script setup lang="ts">
import {
  bulkAssignRolesBaseSchema,
  bulkAssignRolesSchema,
  createRoleSchema,
  createServiceAccountSchema,
  SCOPES,
  type CreateServiceAccountInput,
} from '@erp/shared';
import { Form, FormField } from '@primevue/forms';
import { zodResolver } from '@primevue/forms/resolvers/zod';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
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
import type { AdminRole, AdminUser, CrossCompanyAssignment, UserAssignment } from '../../api/rbac';
import type { BulkWriteResult } from '@erp/shared';

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
// Resolve only the fields the form actually renders. userId is a context value (the user being
// assigned) and roleIds / the acting window are held outside the Form, NOT rendered FormFields —
// validating them here makes zodResolver fail on always-absent values, which blanks out the
// submit event's `values` entirely (the assign silently never fires). Merge + full-validate the
// complete payload in submitAssign instead.
const assignResolver = zodResolver(
  bulkAssignRolesBaseSchema.omit({ roleIds: true, validFrom: true, validTo: true }),
);

async function submitRole(e: FormSubmitEvent) {
  if (!e.valid) return;
  if (await rbac.createRole(e.values)) {
    roleDialog.value = false;
    fb.success(t('feedback.created'));
  } else fb.error(rbac.error);
}

// Service accounts: the app's only path to an account that is not a person. Creating one through
// the employee screens would both invent a fake employee and give the bot an interactive password.
const serviceAccountDialog = ref(false);
const serviceAccountResolver = zodResolver(createServiceAccountSchema);
async function submitServiceAccount(e: FormSubmitEvent) {
  if (!e.valid) return;
  if (await rbac.createServiceAccount(e.values as CreateServiceAccountInput)) {
    serviceAccountDialog.value = false;
    fb.success(t('feedback.created'));
  } else fb.error(rbac.error);
}

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

/**
 * One catalog permission as staged in the manage dialog. `checked` IS "the role holds this",
 * so ticking stages a grant and unticking stages a detach; `heldScope` is what the server
 * currently stores (null when the role doesn't hold it) and is what `scope` is diffed against.
 */
type ScopeCode = (typeof SCOPES)[number];
interface StagedGrant {
  code: string;
  name: string;
  module: string;
  checked: boolean;
  scope: ScopeCode;
  heldScope: ScopeCode | null;
}
const staged = ref<StagedGrant[]>([]);
const bulkScope = ref<ScopeCode>('DEPARTMENT');

/** Seed the staged model from the catalog + the role's current grants. */
function seedStaged(role: AdminRole) {
  const heldByCode = new Map(role.permissions.map((g) => [g.code, g.scope as ScopeCode]));
  staged.value = rbac.permissions.map((p) => {
    const heldScope = heldByCode.get(p.code) ?? null;
    return {
      code: p.code,
      name: p.name,
      module: p.module ?? OTHER_MODULE,
      checked: heldScope !== null,
      scope: heldScope ?? 'DEPARTMENT',
      heldScope,
    };
  });
}

// Staged rows filtered by text and grouped by module, for the manage dialog.
const manageGroups = computed(() => {
  const q = manageFilter.value.trim().toLowerCase();
  const filtered = q
    ? staged.value.filter((row) => `${row.code} ${row.name}`.toLowerCase().includes(q))
    : staged.value;
  return groupByModule<StagedGrant>(filtered, (row) => row.module);
});

/**
 * What the commit would change. A checked row that isn't held is an add; a checked row held at
 * a different scope is a re-scope (the server UPDATEs it in place — (role_id, permission_id) is
 * unique); an unchecked row that IS held is a detach. Everything else is already in place.
 */
const stagedDiff = computed(() => {
  const grants: Array<{ permissionCode: string; scope: ScopeCode }> = [];
  const detach: string[] = [];
  let add = 0;
  let rescope = 0;
  for (const row of staged.value) {
    if (row.checked && row.heldScope === null) {
      grants.push({ permissionCode: row.code, scope: row.scope });
      add += 1;
    } else if (row.checked && row.heldScope !== row.scope) {
      grants.push({ permissionCode: row.code, scope: row.scope });
      rescope += 1;
    } else if (!row.checked && row.heldScope !== null) {
      detach.push(row.code);
    }
  }
  return { grants, detach, add, rescope, remove: detach.length, total: grants.length + detach.length };
});

/** Apply one scope to every checked row — the bulk control above the list. */
function applyScopeToChecked() {
  for (const row of staged.value) if (row.checked) row.scope = bulkScope.value;
}

function openManage(role: AdminRole) {
  manageFilter.value = '';
  expandedModules.value = new Set(); // collapsed by default
  bulkScope.value = 'DEPARTMENT';
  seedStaged(role);
  manageDialog.value = { open: true, roleId: role.id };
}

/**
 * Commit the whole staged edit in one request. Detaches are destructive and a diff editor puts
 * a mass-detach one click away, so any detach in the diff has to be confirmed first.
 */
async function commitGrants() {
  const roleId = manageDialog.value.roleId;
  const diff = stagedDiff.value;
  if (!roleId || !diff.total) return;
  if (diff.remove && !(await fb.confirm({ message: t('admin.rbac.bulk.confirmDetach', { count: diff.remove }) }))) {
    return;
  }
  const res = await rbac.attachPermissionsBulk({ roleId, grants: diff.grants, detach: diff.detach });
  if (!res) {
    fb.error(rbac.error);
    return;
  }
  reportBulk(res);
  // Re-seed from the reloaded role so the staged state reflects what the server actually stored.
  if (manageRole.value) seedStaged(manageRole.value);
}

/** Say what actually happened — a forgiving batch can do less than the admin asked. */
function reportBulk(res: BulkWriteResult) {
  if (!res.applied.length) {
    fb.warn(t('admin.rbac.bulk.allSkipped'));
  } else if (res.skipped.length) {
    fb.success(t('admin.rbac.bulk.partial', { applied: res.applied.length, skipped: res.skipped.length }));
  } else {
    fb.success(t('admin.rbac.bulk.applied', { count: res.applied.length }));
  }
}
function toggleModule(module: string) {
  const next = new Set(expandedModules.value);
  next.has(module) ? next.delete(module) : next.add(module);
  expandedModules.value = next;
}
// Roles checked in the assign dialog. Held outside the Form (like the acting window) and
// merged in submitAssign — see the resolver note above.
const assignRoleIds = ref<string[]>([]);
const assignRolesErr = ref('');

/**
 * The company's roles split by whether this user already holds them. `user_company_role` is
 * unique on (user_id, company_id, role_id), so a held role can't be assigned again — show it
 * as held rather than offering a selection the server would only skip.
 */
const assignRoleOptions = computed(() => {
  const held = new Set(assignDialog.value.user?.assignments.map((a) => a.roleId) ?? []);
  return rbac.roles.map((r) => ({ id: r.id, code: r.code, name: r.name, held: held.has(r.id) }));
});
const assignHasSelectable = computed(() => assignRoleOptions.value.some((r) => !r.held));

function openAssign(user: AdminUser) {
  acting.value = false;
  actingFrom.value = null;
  actingTo.value = null;
  assignWindowErr.value = '';
  assignRolesErr.value = '';
  assignRoleIds.value = [];
  assignDialog.value = { open: true, user };
}
async function submitAssign(e: FormSubmitEvent) {
  if (!e.valid) return;
  // Merge the values held outside the Form (userId context, checked roles, acting window) and
  // re-validate the COMPLETE payload against the shared schema, so valid_to >= valid_from and
  // "at least one role" are enforced client-side by the same rule the server applies.
  const payload = {
    ...e.values,
    userId: assignDialog.value.user?.id,
    roleIds: assignRoleIds.value,
    validFrom: acting.value && actingFrom.value ? toYmd(actingFrom.value) : undefined,
    validTo: acting.value && actingTo.value ? toYmd(actingTo.value) : undefined,
  };
  const parsed = bulkAssignRolesSchema.safeParse(payload);
  if (!parsed.success) {
    const issues = parsed.error.issues;
    assignRolesErr.value = issues.some((i) => i.path[0] === 'roleIds') ? t('admin.rbac.bulk.noRolesSelected') : '';
    assignWindowErr.value = issues.find((i) => i.path[0] === 'validTo')?.message ?? '';
    // Neither field owned the failure — surface it rather than failing silently.
    if (!assignRolesErr.value && !assignWindowErr.value) fb.error(t('feedback.errorFallback'));
    return;
  }
  assignRolesErr.value = '';
  assignWindowErr.value = '';
  const res = await rbac.assignBulk(parsed.data);
  if (!res) {
    fb.error(rbac.error);
    return;
  }
  assignDialog.value.open = false;
  reportBulk(res);
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

    <!-- The screen that lists grantable codes is the one place where the person who can act on a
         short catalog is already standing. Left unsaid here, the only other report is a deploy log
         nobody re-reads — which is how twelve enforced codes stayed grantable to nobody. -->
    <Message
      v-if="rbac.missingPermissionCodes.length"
      severity="warn"
      class="mb-4"
      data-testid="catalog-short"
    >
      <div class="font-medium">{{ $t('admin.rbac.catalogShort.title') }}</div>
      <p class="mt-1 mb-2 text-sm">{{ $t('admin.rbac.catalogShort.body') }}</p>
      <ul class="m-0 flex flex-wrap gap-x-4 gap-y-1 list-none p-0 font-mono text-sm">
        <li v-for="code in rbac.missingPermissionCodes" :key="code">{{ code }}</li>
      </ul>
    </Message>

    <div v-if="!rbac.error" class="card">
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
        clientPaged
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
          <PageToolbar :search="userFilters.global.value ?? ''" @update:search="userFilters.global.value = $event">
            <template #actions>
              <Button
                :label="$t('admin.rbac.newServiceAccount')"
                icon="pi pi-android"
                size="small"
                severity="secondary"
                outlined
                @click="serviceAccountDialog = true"
              />
            </template>
          </PageToolbar>
          <AppDataTable
        clientPaged
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
            <Column field="username" :header="$t('admin.rbac.columns.user')">
              <template #body="{ data }">
                <div class="flex items-center gap-2">
                  <span>{{ data.username }}</span>
                  <!-- A bot is not a person: say so, so nobody treats it as one. -->
                  <Tag
                    v-if="data.isServiceAccount"
                    :value="$t('admin.rbac.serviceAccount')"
                    severity="secondary"
                  />
                </div>
              </template>
            </Column>
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

    <!--
      New service account. Deliberately NO password field: a service account authenticates only by
      an API key, and giving it a password would hand it an interactive login it must never have.
      The role + department are collected here because the server creates the account and its first
      company assignment atomically — without a membership it could not even be issued a key.
    -->
    <Dialog v-model:visible="serviceAccountDialog" :header="$t('admin.rbac.newServiceAccount')" modal class="w-96">
      <Form
        :resolver="serviceAccountResolver"
        :initialValues="{ username: '', email: '', roleId: '', departmentId: '' }"
        class="flex flex-col gap-3"
        @submit="submitServiceAccount"
      >
        <FormField v-slot="$field" name="username" class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('admin.rbac.fields.username') }}</label>
          <InputText type="text" />
          <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}</Message>
        </FormField>
        <FormField v-slot="$field" name="email" class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('admin.rbac.fields.email') }}</label>
          <InputText type="email" />
          <small class="text-muted-color">{{ $t('admin.rbac.serviceAccountEmailHelp') }}</small>
          <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}</Message>
        </FormField>
        <FormField v-slot="$field" name="departmentId" class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('admin.rbac.fields.department') }}</label>
          <Select :options="departments" optionLabel="name" optionValue="id" :placeholder="$t('admin.rbac.fields.departmentPlaceholder')" />
          <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}</Message>
        </FormField>
        <FormField v-slot="$field" name="roleId" class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('admin.rbac.fields.role') }}</label>
          <Select :options="rbac.roles" optionLabel="name" optionValue="id" :placeholder="$t('admin.rbac.fields.rolePlaceholder')" filter />
          <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}</Message>
        </FormField>
        <small class="text-muted-color">{{ $t('admin.rbac.serviceAccountKeyHelp') }}</small>
        <div class="flex justify-end gap-2">
          <Button :label="$t('common.cancel')" text @click="serviceAccountDialog = false" />
          <Button type="submit" :label="$t('common.create')" />
        </div>
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
        <!-- Filter + bulk scope: one scope applied to every checked row -->
        <div class="flex flex-wrap items-end gap-2">
          <InputText v-model="manageFilter" :placeholder="$t('admin.rbac.filterPlaceholder')" class="flex-1" />
          <div class="flex flex-col gap-1">
            <label class="text-sm text-muted-color">{{ $t('admin.rbac.bulk.scopeForChecked') }}</label>
            <div class="flex items-center gap-2">
              <Select v-model="bulkScope" :options="scopeOptions" optionLabel="label" optionValue="value" class="w-40" />
              <Button :label="$t('admin.rbac.bulk.apply')" outlined size="small" @click="applyScopeToChecked" />
            </div>
          </div>
        </div>

        <!-- Catalog as a diff editor: checked = the role holds it. Per-module collapsible
             sections, confined to a fixed-height scroll so the dialog never grows unbounded. -->
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
              <span class="text-muted-color text-sm">{{ g.items.filter((i) => i.checked).length }} / {{ g.items.length }}</span>
            </button>
            <div v-show="expandedModules.has(g.module)" class="flex flex-col gap-1 px-3 pb-3">
              <div v-for="row in g.items" :key="row.code" class="flex items-center gap-2">
                <Checkbox v-model="row.checked" :inputId="`perm-${row.code}`" binary />
                <label :for="`perm-${row.code}`" class="flex-1 cursor-pointer text-sm">
                  <span class="font-medium">{{ row.code }}</span>
                  <span class="text-muted-color"> · {{ row.name }}</span>
                </label>
                <Select
                  v-if="row.checked"
                  v-model="row.scope"
                  :options="scopeOptions"
                  optionLabel="label"
                  optionValue="value"
                  size="small"
                  class="w-36"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Staged-change summary + one commit for the whole edit -->
        <div class="flex items-center justify-between gap-2">
          <span class="text-sm" :class="stagedDiff.total ? 'text-primary' : 'text-muted-color'">
            {{
              stagedDiff.total
                ? $t('admin.rbac.bulk.staged', {
                    add: stagedDiff.add,
                    remove: stagedDiff.remove,
                    rescope: stagedDiff.rescope,
                  })
                : $t('admin.rbac.bulk.noChanges')
            }}
          </span>
          <Button
            :label="$t('admin.rbac.bulk.save')"
            :disabled="!stagedDiff.total"
            :loading="rbac.loading"
            @click="commitGrants"
          />
        </div>
      </div>
    </Dialog>

    <!-- Assign role -->
    <Dialog v-model:visible="assignDialog.open" :header="$t('admin.rbac.assignTo', { username: assignDialog.user?.username })" modal class="w-96">
      <Form :key="assignDialog.user?.id" :resolver="assignResolver" :initialValues="{ departmentId: '', isDefault: false }" class="flex flex-col gap-3" @submit="submitAssign">
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
        <!-- Roles: checked in one pass, all created against the shared context above. -->
        <div class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('admin.rbac.bulk.rolesLabel') }}</label>
          <div class="max-h-48 overflow-y-auto rounded border border-surface-200 p-2 dark:border-surface-700">
            <div v-if="!assignHasSelectable" class="p-2 text-center text-muted-color text-sm">
              {{ $t('admin.rbac.bulk.allRolesHeld') }}
            </div>
            <div v-for="r in assignRoleOptions" :key="r.id" class="flex items-center gap-2 py-0.5">
              <Checkbox v-model="assignRoleIds" :inputId="`role-${r.id}`" :value="r.id" :disabled="r.held" />
              <label :for="`role-${r.id}`" class="flex-1 text-sm" :class="r.held ? 'text-muted-color' : 'cursor-pointer'">
                {{ r.code }}
              </label>
              <Tag v-if="r.held" :value="$t('admin.rbac.bulk.held')" severity="secondary" />
            </div>
          </div>
          <Message v-if="assignRolesErr" severity="error" size="small" variant="simple">{{ assignRolesErr }}</Message>
        </div>
        <div class="flex justify-end gap-2"><Button :label="$t('common.cancel')" text @click="assignDialog.open = false" /><Button type="submit" :label="$t('admin.rbac.assign')" :disabled="!assignHasSelectable" /></div>
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
