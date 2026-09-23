<script setup lang="ts">
import { departmentSchema } from '@erp/shared';
import { Form, FormField } from '@primevue/forms';
import { zodResolver } from '@primevue/forms/resolvers/zod';
import Button from 'primevue/button';
import Column from 'primevue/column';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Tag from 'primevue/tag';
import TreeTable from 'primevue/treetable';
import TreeSelect from 'primevue/treeselect';
import { FilterMatchMode } from '@primevue/core/api';
import { computed, onMounted, ref } from 'vue';
import type { TreeNode } from 'primevue/treenode';
import { useI18n } from 'vue-i18n';
import { useFeedback } from '../../../composables/useFeedback';
import PageHeader from '@/components/PageHeader.vue';
import PageToolbar from '@/components/PageToolbar.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import { useAuthStore } from '../../../stores/auth';
import { useOrgStore } from '../../../stores/org';
import type { FormSubmitEvent } from '@primevue/forms';
import type { Department } from '../../../api/org';

const auth = useAuthStore();
const org = useOrgStore();
const fb = useFeedback();
const { t } = useI18n();
const can = (c: string) => auth.can(c);

const deptDialog = ref<{ open: boolean; edit?: Department }>({ open: false });
// TreeSelect single-selection model: `{ [departmentId]: true }`, or empty for "no parent".
const deptParentSel = ref<Record<string, boolean>>({});
const selectedParentId = computed<string | undefined>(() => Object.keys(deptParentSel.value ?? {})[0]);
const deptFilters = ref({ global: { value: null as string | null, matchMode: FilterMatchMode.CONTAINS } });

/** A department's parent id, or undefined for a root. */
function parentIdOf(d: Department): string | undefined {
  return d.parentDept?.id ?? undefined;
}
/** Children grouped by parent id, across the active company's departments. */
function childrenByParent(depts: Department[]): Map<string | undefined, Department[]> {
  const ids = new Set(depts.map((d) => d.id));
  const byParent = new Map<string | undefined, Department[]>();
  for (const d of depts) {
    // A parent that isn't in the current company's list (absent/cross-company) is treated as a root.
    const pid = parentIdOf(d);
    const key = pid && ids.has(pid) ? pid : undefined;
    const arr = byParent.get(key) ?? [];
    arr.push(d);
    byParent.set(key, arr);
  }
  return byParent;
}
const byCode = (a: Department, b: Department) => a.deptCode.localeCompare(b.deptCode);

// Active company's departments narrowed by the search box; ancestors of a match are kept so the
// tree stays connected and matches remain visible under their parents.
const visibleDepartments = computed<Department[]>(() => {
  const q = (deptFilters.value.global.value ?? '').trim().toLowerCase();
  if (!q) return org.departments;
  const byId = new Map(org.departments.map((d) => [d.id, d]));
  const keep = new Set<string>();
  for (const d of org.departments) {
    if (d.deptCode.toLowerCase().includes(q) || d.name.toLowerCase().includes(q)) {
      keep.add(d.id);
      let pid = parentIdOf(d);
      while (pid && byId.has(pid) && !keep.has(pid)) {
        keep.add(pid);
        pid = parentIdOf(byId.get(pid)!);
      }
    }
  }
  return org.departments.filter((d) => keep.has(d.id));
});

// Flat department list → PrimeVue TreeTable nodes (roots first, siblings ordered by code).
const departmentTree = computed<TreeNode[]>(() => {
  const byParent = childrenByParent(visibleDepartments.value);
  const make = (d: Department): TreeNode => ({
    key: d.id,
    data: d,
    children: (byParent.get(d.id) ?? []).sort(byCode).map(make),
  });
  return (byParent.get(undefined) ?? []).sort(byCode).map(make);
});

// Running ordinal (#) per row, following the tree's display order (pre-order: a parent, then its
// children). Keyed by node id so the "#" column can look it up in the body slot.
const ordinals = computed<Map<string, number>>(() => {
  const map = new Map<string, number>();
  let i = 0;
  const walk = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      map.set(String(n.key), ++i);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(departmentTree.value);
  return map;
});

/** All descendant ids of `id` within the active company's departments. */
function descendantIds(id: string): Set<string> {
  const byParent = childrenByParent(org.departments);
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    for (const c of byParent.get(stack.pop()!) ?? []) {
      if (!out.has(c.id)) {
        out.add(c.id);
        stack.push(c.id);
      }
    }
  }
  return out;
}

// Parent-picker tree: the full hierarchy minus the edited department and its descendants,
// mirroring the server's cycle rejection as a UX guard.
const parentTreeOptions = computed<TreeNode[]>(() => {
  const editId = deptDialog.value.edit?.id;
  const excluded = editId ? new Set<string>([editId, ...descendantIds(editId)]) : new Set<string>();
  const byParent = childrenByParent(org.departments);
  const make = (d: Department): TreeNode => ({
    key: d.id,
    label: d.name,
    children: (byParent.get(d.id) ?? []).filter((c) => !excluded.has(c.id)).sort(byCode).map(make),
  });
  return (byParent.get(undefined) ?? []).filter((d) => !excluded.has(d.id)).sort(byCode).map(make);
});

function openDept(edit?: Department) {
  const pid = edit ? parentIdOf(edit) : undefined;
  deptParentSel.value = pid ? { [pid]: true } : {};
  deptDialog.value = { open: true, edit };
}

async function submitDept(e: FormSubmitEvent) {
  if (!e.valid) return;
  const editing = !!deptDialog.value.edit;
  // Parent is managed by the TreeSelect outside the form. On edit, an empty selection clears the
  // parent (null); on create, it is simply omitted so the department becomes a root. `deptCode` is
  // immutable — disabled in the form but still submitted — and the update DTO (whitelist) rejects
  // it, so omit it from the update payload.
  // A blank abbreviation is "none", sent as null so the server clears it rather than storing ''.
  const values = { ...e.values, shortName: String(e.values.shortName ?? '').trim() || null };
  const updatable: Record<string, unknown> = { ...values, parentDeptId: selectedParentId.value ?? null };
  delete updatable.deptCode;
  const ok = editing
    ? await org.updateDepartment(deptDialog.value.edit!.id, updatable)
    : await org.createDepartment({ ...values, parentDeptId: selectedParentId.value });
  if (ok) {
    deptDialog.value.open = false;
    fb.success(t(editing ? 'feedback.updated' : 'feedback.created'));
  } else fb.error(org.error);
}

onMounted(() => org.loadDepartments());
</script>

<template>
  <div>
    <PageHeader :title="$t('admin.org.tabs.departments')" />
    <PageToolbar :search="deptFilters.global.value ?? ''" @update:search="deptFilters.global.value = $event">
      <template #actions>
        <Button v-if="can('DEPARTMENT_MANAGE')" :label="$t('admin.org.newDepartment')" icon="pi pi-plus" size="small" @click="openDept()" />
      </template>
    </PageToolbar>
    <ErrorState v-if="org.error" :message="org.error" @retry="org.loadDepartments()" />
    <div v-else class="card">
      <TreeTable :value="departmentTree" :loading="org.loading">
        <Column header="#" style="width: 4rem"><template #body="{ node }"><span class="text-muted-color">{{ ordinals.get(String(node.key)) }}</span></template></Column>
        <Column field="deptCode" :header="$t('common.code')" expander />
        <Column :header="$t('admin.org.fields.shortName')"><template #body="{ node }"><span v-if="node.data.shortName">{{ node.data.shortName }}</span><span v-else class="text-muted-color">—</span></template></Column>
        <Column field="name" :header="$t('common.name')" />
        <Column field="costCenter" :header="$t('admin.org.columns.costCenter')" />
        <Column :header="$t('admin.org.columns.active')"><template #body="{ node }"><Tag :value="node.data.isActive ? $t('common.yes') : $t('common.no')" :severity="node.data.isActive ? 'success' : 'secondary'" /></template></Column>
        <Column header=""><template #body="{ node }"><Button v-if="can('DEPARTMENT_MANAGE')" icon="pi pi-pencil" text size="small" @click="openDept(node.data)" /></template></Column>
        <template #empty>
          <EmptyState icon="pi pi-sitemap" :title="$t('admin.org.empty.departments')" />
        </template>
      </TreeTable>
    </div>

    <Dialog v-model:visible="deptDialog.open" :header="deptDialog.edit ? $t('admin.org.editDepartment') : $t('admin.org.newDepartment')" modal class="w-96">
      <Form
        :key="deptDialog.edit?.id ?? 'new'"
        :resolver="zodResolver(departmentSchema)"
        :initialValues="deptDialog.edit
          ? { deptCode: deptDialog.edit.deptCode, name: deptDialog.edit.name, shortName: deptDialog.edit.shortName ?? '', costCenter: deptDialog.edit.costCenter ?? '' }
          : { deptCode: '', name: '', shortName: '', costCenter: '' }"
        class="flex flex-col gap-3"
        @submit="submitDept"
      >
        <FormField v-slot="$f" name="deptCode" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('common.code') }}</label><InputText type="text" :disabled="!!deptDialog.edit" /><Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message></FormField>
        <FormField v-slot="$f" name="name" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('common.name') }}</label><InputText type="text" /><Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message></FormField>
        <!-- The abbreviation stamped in the department position of a paper document number (1034/ຈຊຈ/ບຫ); blank means the code is used. -->
        <FormField v-slot="$f" name="shortName" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('admin.org.fields.shortName') }}</label><InputText type="text" maxlength="20" :invalid="$f?.invalid" /><span class="text-xs text-muted-color">{{ $t('admin.org.fields.shortNameHint') }}</span><Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message></FormField>
        <div class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('admin.org.fields.parent') }}</label><TreeSelect v-model="deptParentSel" :options="parentTreeOptions" selectionMode="single" showClear :placeholder="$t('admin.org.fields.parentPlaceholder')" /></div>
        <FormField name="costCenter" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('admin.org.fields.costCenter') }}</label><InputText type="text" /></FormField>
        <div class="flex justify-end gap-2"><Button :label="$t('common.cancel')" text @click="deptDialog.open = false" /><Button type="submit" :label="$t('common.save')" /></div>
      </Form>
    </Dialog>
  </div>
</template>
