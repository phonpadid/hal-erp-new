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
const loading = ref(false);
const busy = ref(false);
const newSuccessorId = ref<string | null>(null);
const newSuccessorAuto = ref(false);
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

watch(() => props.documentType.id, load, { immediate: true });

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
    await docConfigApi.addRefPairing({ predecessorTypeId, successorTypeId, autoCreate });
    newSuccessorId.value = null;
    newSuccessorAuto.value = false;
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
async function toggleAuto(p: RefPairing) {
  busy.value = true;
  try {
    await docConfigApi.updateRefPairing(p.id, { autoCreate: !p.autoCreate });
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
  <div class="flex flex-col gap-5">
    <!-- Successors: types created FROM this one (this type is the predecessor). -->
    <section class="flex flex-col gap-2">
      <div>
        <div class="text-sm font-medium">{{ $t('admin.docConfig.refChain.successors') }}</div>
        <div class="text-xs text-muted-color">{{ $t('admin.docConfig.refChain.successorHint') }}</div>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <Tag v-for="p in pairings.successors" :key="p.id" :severity="p.autoCreate ? 'success' : 'info'" class="flex items-center gap-1">
          {{ p.successorCode }}
          <Button
            :icon="p.autoCreate ? 'pi pi-bolt' : 'pi pi-bolt'"
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
        <span v-if="!loading && !pairings.successors.length" class="text-xs text-muted-color">{{ $t('admin.docConfig.refChain.empty') }}</span>
      </div>
      <div class="flex items-center gap-2">
        <Select v-model="newSuccessorId" :options="successorOptions" optionLabel="label" optionValue="value" filter showClear :placeholder="$t('admin.docConfig.refChain.pick')" class="w-64" />
        <label class="flex items-center gap-1 text-xs text-muted-color">
          <Checkbox v-model="newSuccessorAuto" :binary="true" />
          {{ $t('admin.docConfig.refChain.autoCreate') }}
        </label>
        <Button :label="$t('admin.docConfig.refChain.addSuccessor')" icon="pi pi-plus" size="small" :disabled="!newSuccessorId || busy" @click="add(documentType.id, newSuccessorId!, newSuccessorAuto)" />
      </div>
    </section>

    <!-- Predecessors: types this one is created FROM (this type is the successor). -->
    <section class="flex flex-col gap-2">
      <div>
        <div class="text-sm font-medium">{{ $t('admin.docConfig.refChain.predecessors') }}</div>
        <div class="text-xs text-muted-color">{{ $t('admin.docConfig.refChain.predecessorHint') }}</div>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <Tag v-for="p in pairings.predecessors" :key="p.id" class="flex items-center gap-1">
          {{ p.predecessorCode }}
          <Button icon="pi pi-times" text rounded size="small" :disabled="busy" :aria-label="$t('common.delete')" @click="remove(p)" />
        </Tag>
        <span v-if="!loading && !pairings.predecessors.length" class="text-xs text-muted-color">{{ $t('admin.docConfig.refChain.empty') }}</span>
      </div>
      <div class="flex items-center gap-2">
        <Select v-model="newPredecessorId" :options="predecessorOptions" optionLabel="label" optionValue="value" filter showClear :placeholder="$t('admin.docConfig.refChain.pick')" class="w-64" />
        <Button :label="$t('admin.docConfig.refChain.addPredecessor')" icon="pi pi-plus" size="small" :disabled="!newPredecessorId || busy" @click="add(newPredecessorId!, documentType.id)" />
      </div>
    </section>
  </div>
</template>
