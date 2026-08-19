<script setup lang="ts">
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFeedback } from '../../composables/useFeedback';
import { docConfigApi, type DocType, type RefPairing, type RefPairings } from '../../api/docConfig';

// Manage a document type's reference-chain pairings (document_type_ref): the successors it may
// create and the predecessors it may be created from. Both endpoints must be types of the active
// company; the picker offers only active-company types (from the already-scoped list) and never
// the type itself. Reachability is route-gated by DOC_CONFIG_MANAGE, matching the server guard.
const props = defineProps<{ documentType: DocType; allTypes: DocType[] }>();

const { t } = useI18n();
const fb = useFeedback();

const pairings = ref<RefPairings>({ successors: [], predecessors: [] });
const departments = ref<Array<{ id: string; name: string }>>([]);
const loading = ref(false);
const busy = ref(false);
const newSuccessorId = ref<string | null>(null);
const newSuccessorAuto = ref(false);
const newSuccessorDeptId = ref<string | null>(null);
const newPredecessorId = ref<string | null>(null);

async function load() {
  loading.value = true;
  try {
    pairings.value = await docConfigApi.refPairings(props.documentType.id);
  } catch {
    fb.error(t('feedback.error'));
  } finally {
    loading.value = false;
  }
}

// The successor-department picker offers the active company's departments (the endpoint is
// already company-scoped). Failing to load them must not break pairing management, which works
// fine without a department — empty just means the source document's own department.
async function loadDepartments() {
  try {
    departments.value = await docConfigApi.departments();
  } catch {
    departments.value = [];
  }
}
loadDepartments();

const departmentOptions = computed(() =>
  departments.value.map((d) => ({ label: d.name, value: d.id })),
);
function departmentName(id: string | null): string | null {
  return departments.value.find((d) => d.id === id)?.name ?? null;
}

watch(() => props.documentType.id, load, { immediate: true });

// `auto_create` is read in exactly one place: the create-successor branch of the post-action
// dispatcher. A predecessor with any other post-action — or none — never reaches the line that
// reads the flag, so the switch saves and nothing ever happens. That costs nobody anything, which
// is why the server does not refuse it; but this screen is the only place anyone would find out.
const autoCreateInert = computed(() => props.documentType.postAction !== 'CREATE_SUCCESSOR');

// Options exclude the type itself and any type already paired in that direction.
function optionsExcluding(usedIds: Set<string>) {
  return props.allTypes
    .filter((dt) => dt.id !== props.documentType.id && !usedIds.has(dt.id))
    .map((dt) => ({ label: `${dt.code} — ${dt.name}`, value: dt.id }));
}
const successorOptions = computed(() =>
  optionsExcluding(new Set(pairings.value.successors.map((p) => p.successorTypeId))),
);
const predecessorOptions = computed(() =>
  optionsExcluding(new Set(pairings.value.predecessors.map((p) => p.predecessorTypeId))),
);

async function add(predecessorTypeId: string, successorTypeId: string, autoCreate = false) {
  busy.value = true;
  try {
    // The department is only meaningful for auto-create — a manual create-from takes the creating
    // user's department — so the key is omitted rather than sent empty.
    const successorDepartmentId = autoCreate ? newSuccessorDeptId.value : null;
    await docConfigApi.addRefPairing({
      predecessorTypeId,
      successorTypeId,
      autoCreate,
      ...(successorDepartmentId ? { successorDepartmentId } : {}),
    });
    newSuccessorId.value = null;
    newSuccessorAuto.value = false;
    newSuccessorDeptId.value = null;
    newPredecessorId.value = null;
    await load();
    fb.success(t('feedback.created'));
  } catch (e: unknown) {
    // 409 = duplicate pairing; anything else is a generic failure.
    const status = (e as { response?: { status?: number } })?.response?.status;
    fb.error(status === 409 ? t('admin.docConfig.refChain.duplicate') : t('feedback.error'));
  } finally {
    busy.value = false;
  }
}

// Toggle whether the CREATE_SUCCESSOR post-action auto-creates this successor on approval.
// Turning auto-create off also clears the successor department: the field has no meaning for a
// manual create-from, and leaving a stale value behind would silently apply if it were turned
// back on later.
async function toggleAuto(p: RefPairing) {
  busy.value = true;
  try {
    const autoCreate = !p.autoCreate;
    await docConfigApi.updateRefPairing(p.id, {
      autoCreate,
      ...(autoCreate ? {} : { successorDepartmentId: null }),
    });
    await load();
    fb.success(t('feedback.done'));
  } catch {
    fb.error(t('feedback.error'));
  } finally {
    busy.value = false;
  }
}

/**
 * Point an existing auto-create pairing's successor at a department, or clear it.
 *
 * Only affects successors created AFTER this: the obligation resolves and stores its department
 * when the predecessor's approval commits, so an approval already granted keeps the destination
 * its approvers saw.
 */
async function setSuccessorDepartment(p: RefPairing, departmentId: string | null) {
  busy.value = true;
  try {
    await docConfigApi.updateRefPairing(p.id, { autoCreate: p.autoCreate, successorDepartmentId: departmentId });
    await load();
    fb.success(t('feedback.done'));
  } catch {
    fb.error(t('feedback.error'));
  } finally {
    busy.value = false;
  }
}

async function remove(p: RefPairing) {
  busy.value = true;
  try {
    await docConfigApi.removeRefPairing(p.id);
    await load();
    fb.success(t('feedback.done'));
  } catch {
    fb.error(t('feedback.error'));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- Direction map: orients the user on which way the chain flows (predecessor → this → successor). -->
    <div class="flex items-center justify-center gap-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/40 px-3 py-3">
      <span class="rounded-md bg-surface-100 dark:bg-surface-700 px-2.5 py-1 text-xs text-muted-color">{{ $t('admin.docConfig.refChain.flowIn') }}</span>
      <i class="pi pi-arrow-right text-xs text-muted-color" />
      <span class="rounded-md bg-primary/10 px-3 py-1 text-sm font-semibold text-primary ring-1 ring-primary/30">{{ documentType.code }}</span>
      <i class="pi pi-arrow-right text-xs text-muted-color" />
      <span class="rounded-md bg-surface-100 dark:bg-surface-700 px-2.5 py-1 text-xs text-muted-color">{{ $t('admin.docConfig.refChain.flowOut') }}</span>
    </div>

    <!-- Successors: types created FROM this one (this type is the predecessor). -->
    <section class="flex flex-col gap-3">
      <div class="flex items-start gap-2">
        <i class="pi pi-arrow-right-from-bracket mt-0.5 text-muted-color" />
        <div>
          <div class="text-sm font-medium">{{ $t('admin.docConfig.refChain.successors') }}</div>
          <div class="text-xs text-muted-color">{{ $t('admin.docConfig.refChain.successorHint') }}</div>
        </div>
      </div>
      <!-- Auto-create only runs from the create-successor post-action. Said here rather than
           refused on save: the flag is harmless, the post-action is editable, and pairing two
           types before deciding one auto-creates is a reasonable order to work in. -->
      <div
        v-if="autoCreateInert"
        class="flex items-start gap-2 rounded-md border border-dashed border-surface-300 px-3 py-2 text-xs text-muted-color dark:border-surface-700"
        data-testid="auto-create-inert"
      >
        <i class="pi pi-info-circle mt-0.5 shrink-0" />
        <span>{{ $t('admin.docConfig.refChain.autoCreateInert', { code: documentType.code }) }}</span>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <Tag v-for="p in pairings.successors" :key="p.id" :severity="p.autoCreate ? 'success' : 'info'" class="flex items-center gap-1">
          {{ p.successorCode }}
          <!-- Where an auto-created successor lands. Shown only for auto-create pairings: a manual
               create-from takes the department of whoever does the creating. -->
          <span
            v-if="p.autoCreate"
            class="ml-1 flex items-center gap-1 text-xs opacity-90"
            data-testid="successor-dept-label"
          >
            <i class="pi pi-arrow-right text-[10px]" />
            {{ departmentName(p.successorDepartmentId) ?? $t('admin.docConfig.refChain.successorDeptSameAsSource') }}
          </span>
          <Button
            icon="pi pi-bolt"
            text rounded size="small"
            :severity="p.autoCreate ? 'success' : 'secondary'"
            :class="{ 'opacity-40': !p.autoCreate }"
            :disabled="busy"
            v-tooltip.top="p.autoCreate ? $t('admin.docConfig.refChain.autoCreateOn') : $t('admin.docConfig.refChain.autoCreateOff')"
            :aria-label="$t('admin.docConfig.refChain.autoCreate')"
            @click="toggleAuto(p)"
          />
          <Button icon="pi pi-times" text rounded size="small" :disabled="busy" :aria-label="$t('common.delete')" @click="remove(p)" />
        </Tag>
        <div v-if="!loading && !pairings.successors.length" class="flex items-center gap-2 rounded-md border border-dashed border-surface-300 px-3 py-2 text-xs text-muted-color dark:border-surface-700">
          <i class="pi pi-info-circle" />{{ $t('admin.docConfig.refChain.emptySuccessors') }}
        </div>
      </div>
      <!-- Re-point an existing auto-create pairing. Only later approvals are affected: the
           obligation stamps its department when the approval commits. -->
      <div
        v-for="p in pairings.successors.filter((s) => s.autoCreate)"
        :key="`dept-${p.id}`"
        class="flex items-center gap-2 pl-1 text-xs"
        data-testid="successor-dept-row"
      >
        <span class="shrink-0 text-muted-color">{{ $t('admin.docConfig.refChain.successorDeptFor', { code: p.successorCode }) }}</span>
        <Select
          :modelValue="p.successorDepartmentId"
          :options="departmentOptions"
          optionLabel="label"
          optionValue="value"
          showClear
          size="small"
          :disabled="busy"
          :placeholder="$t('admin.docConfig.refChain.successorDeptSameAsSource')"
          :aria-label="$t('admin.docConfig.refChain.successorDept')"
          class="min-w-0 flex-1"
          @update:modelValue="(v: string | null) => setSuccessorDepartment(p, v ?? null)"
        />
      </div>
      <div class="flex flex-col gap-2 rounded-md bg-surface-50 p-3 dark:bg-surface-800/40">
        <div class="flex items-center gap-2">
          <Select v-model="newSuccessorId" :options="successorOptions" optionLabel="label" optionValue="value" filter showClear :placeholder="$t('admin.docConfig.refChain.pick')" class="min-w-0 flex-1" />
          <Button :label="$t('admin.docConfig.refChain.addSuccessor')" icon="pi pi-plus" size="small" outlined class="shrink-0 whitespace-nowrap" :disabled="!newSuccessorId || busy" @click="add(documentType.id, newSuccessorId!, newSuccessorAuto)" />
        </div>
        <label class="flex items-start gap-2 text-xs text-muted-color">
          <Checkbox v-model="newSuccessorAuto" :binary="true" class="mt-0.5" />
          <span>
            <span class="font-medium text-color">{{ $t('admin.docConfig.refChain.autoCreate') }}</span>
            <span class="block">{{ $t('admin.docConfig.refChain.autoCreateHint') }}</span>
          </span>
        </label>
        <!-- Hidden until auto-create is on: it has no effect on a manual create-from. -->
        <div v-if="newSuccessorAuto" class="flex flex-col gap-1 pl-6" data-testid="new-successor-dept">
          <Select
            v-model="newSuccessorDeptId"
            :options="departmentOptions"
            optionLabel="label"
            optionValue="value"
            showClear
            size="small"
            :placeholder="$t('admin.docConfig.refChain.successorDeptSameAsSource')"
            :aria-label="$t('admin.docConfig.refChain.successorDept')"
            class="min-w-0"
          />
          <span class="text-xs text-muted-color">{{ $t('admin.docConfig.refChain.successorDeptHint') }}</span>
        </div>
      </div>
    </section>

    <!-- Predecessors: types this one is created FROM (this type is the successor). -->
    <section class="flex flex-col gap-3">
      <div class="flex items-start gap-2">
        <i class="pi pi-arrow-right-to-bracket mt-0.5 text-muted-color" />
        <div>
          <div class="text-sm font-medium">{{ $t('admin.docConfig.refChain.predecessors') }}</div>
          <div class="text-xs text-muted-color">{{ $t('admin.docConfig.refChain.predecessorHint') }}</div>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <Tag v-for="p in pairings.predecessors" :key="p.id" class="flex items-center gap-1">
          {{ p.predecessorCode }}
          <Button icon="pi pi-times" text rounded size="small" :disabled="busy" :aria-label="$t('common.delete')" @click="remove(p)" />
        </Tag>
        <div v-if="!loading && !pairings.predecessors.length" class="flex items-center gap-2 rounded-md border border-dashed border-surface-300 px-3 py-2 text-xs text-muted-color dark:border-surface-700">
          <i class="pi pi-info-circle" />{{ $t('admin.docConfig.refChain.emptyPredecessors') }}
        </div>
      </div>
      <div class="flex items-center gap-2 rounded-md bg-surface-50 p-3 dark:bg-surface-800/40">
        <Select v-model="newPredecessorId" :options="predecessorOptions" optionLabel="label" optionValue="value" filter showClear :placeholder="$t('admin.docConfig.refChain.pick')" class="min-w-0 flex-1" />
        <Button :label="$t('admin.docConfig.refChain.addPredecessor')" icon="pi pi-plus" size="small" outlined class="shrink-0 whitespace-nowrap" :disabled="!newPredecessorId || busy" @click="add(newPredecessorId!, documentType.id)" />
      </div>
    </section>
  </div>
</template>
