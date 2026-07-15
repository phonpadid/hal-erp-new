<script setup lang="ts">
/**
 * Quota-reservation editor for the Create Document wizard — shown only for a `requires_quota`
 * document type. The requester picks a quota and a quantity; there is no beneficiary picker,
 * because the server resolves a personal (entitlement-scoped) quota's beneficiary to the requester
 * themselves (self-only). The quota options come from the requester-facing `/quotas/selectable`
 * read (authorized by DOC_CREATE), so a requester without QUOTA_VIEW can still build reservations.
 *
 * Quantity is a string end to end — <InputNumber> is bridged through string conversion at the edge
 * and never stored as a number. The advisory `remaining` shown here is guidance only; the server
 * recomputes the authoritative remaining under lock at submit and stays the source of truth.
 */
import Button from 'primevue/button';
import InputNumber from 'primevue/inputnumber';
import Select from 'primevue/select';
import Message from 'primevue/message';
import { computed } from 'vue';
import type { SelectableQuota } from '../../api/quotas';

export interface ReservationRow {
  quotaId: string;
  qty: string;
}

const props = defineProps<{
  /** Quotas the requester may reserve against (from /quotas/selectable). */
  quotas: SelectableQuota[];
  /** Whether the step has been attempted, so inline errors show only after a blocked advance. */
  attempted?: boolean;
}>();

const rows = defineModel<ReservationRow[]>({ required: true });

const quotaById = computed(() => new Map(props.quotas.map((q) => [q.id, q])));

/** A reservation is valid once it names a quota and carries a positive quantity. */
function rowInvalid(r: ReservationRow): boolean {
  return !r.quotaId || r.qty === '' || Number(r.qty) <= 0 || Number.isNaN(Number(r.qty));
}

/** Human label for the quota picker: type plus unit (e.g. "ANNUAL_LEAVE (day)"). */
function quotaLabel(q: SelectableQuota): string {
  return `${q.quotaType} (${q.unit})`;
}

// InputNumber speaks number; bridge at the edge so the stored value stays a string.
function numOrNull(s: string): number | null {
  return s === '' || s == null ? null : Number(s);
}
function setQty(r: ReservationRow, v: number | null) {
  r.qty = v == null ? '' : String(v);
}

function addRow() {
  rows.value.push({ quotaId: '', qty: '1' });
}
function removeRow(i: number) {
  rows.value.splice(i, 1);
}

defineExpose({ addRow });
</script>

<template>
  <div>
    <div class="mb-3 flex items-center justify-between">
      <h2 class="font-semibold text-color">{{ $t('documents.create.quota.title') }}</h2>
      <Button v-if="rows.length" :label="$t('documents.create.quota.add')" icon="pi pi-plus" size="small" text @click="addRow" />
    </div>
    <p class="mb-3 text-xs text-muted-color">{{ $t('documents.create.quota.hint') }}</p>

    <!-- Empty state: invite the first reservation rather than showing a bare blank step. -->
    <div v-if="!rows.length" class="rounded-lg border border-dashed border-surface-300 p-8 text-center dark:border-surface-700">
      <i class="pi pi-ticket text-2xl text-muted-color" />
      <p class="mt-2 text-sm text-muted-color">{{ $t('documents.create.quota.empty') }}</p>
      <Button class="mt-3" :label="$t('documents.create.quota.addFirst')" icon="pi pi-plus" size="small" @click="addRow" />
    </div>

    <div v-else class="flex flex-col gap-3">
      <div
        v-for="(row, i) in rows"
        :key="i"
        class="rounded-xl border p-4 transition-colors"
        :class="attempted && rowInvalid(row) ? 'border-red-300 bg-red-50 dark:border-red-800/60 dark:bg-red-950/30' : 'border-surface-300 dark:border-surface-700'"
      >
        <div class="mb-3 flex items-center justify-between">
          <span class="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-surface-200 px-2 text-xs font-semibold text-muted-color dark:bg-surface-700">
            {{ i + 1 }}
          </span>
          <Button icon="pi pi-trash" text severity="danger" size="small" :aria-label="$t('common.delete')" @click="removeRow(i)" />
        </div>

        <div class="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          <div>
            <label class="mb-1 block text-xs font-medium text-muted-color">
              {{ $t('documents.create.quota.quota') }}<span class="text-red-500"> *</span>
            </label>
            <Select
              v-model="row.quotaId"
              :options="quotas"
              :optionLabel="quotaLabel"
              optionValue="id"
              :placeholder="$t('documents.create.quota.quotaPlaceholder')"
              :invalid="(attempted && !row.quotaId) || undefined"
              :aria-required="true"
              filter
              fluid
            />
          </div>

          <div>
            <label class="mb-1 block text-xs font-medium text-muted-color">
              {{ $t('documents.create.quota.qty') }}<span class="text-red-500"> *</span>
            </label>
            <InputNumber
              :model-value="numOrNull(row.qty)"
              :min="0"
              :min-fraction-digits="0"
              :max-fraction-digits="2"
              :invalid="(attempted && rowInvalid(row)) || undefined"
              fluid
              @update:model-value="(v) => setQty(row, v as number | null)"
            />
          </div>
        </div>

        <!-- Advisory remaining + self-beneficiary note for the chosen quota. -->
        <div v-if="quotaById.get(row.quotaId)" class="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span class="inline-flex items-center gap-1 rounded-md bg-surface-200 px-2 py-0.5 font-medium dark:bg-surface-700">
            <span class="text-muted-color">{{ $t('documents.create.quota.remaining') }}</span>
            <span class="text-color">{{ quotaById.get(row.quotaId)!.remaining }} {{ quotaById.get(row.quotaId)!.unit }}</span>
          </span>
          <span v-if="quotaById.get(row.quotaId)!.personal" class="inline-flex items-center gap-1 text-muted-color">
            <i class="pi pi-user text-[0.7rem]" /> {{ $t('documents.create.quota.appliesToYou') }}
          </span>
        </div>

        <Message v-if="attempted && rowInvalid(row)" severity="error" size="small" variant="simple" class="mt-2">
          {{ $t('documents.create.quota.invalid') }}
        </Message>
      </div>
    </div>
  </div>
</template>
