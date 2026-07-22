<script setup lang="ts">
import Column from 'primevue/column';
import Dialog from 'primevue/dialog';
import Tag from 'primevue/tag';
import { computed, watch } from 'vue';
import { RouterLink } from 'vue-router';
import AppDataTable from '@/components/AppDataTable.vue';
import EmptyState from '@/components/EmptyState.vue';
import { isInbound, MOVES_ON_HAND } from '../../api/inventory';
import { useInventoryStore } from '../../stores/inventory';
import { formatAmount } from '../../utils/money';
import type { StockLedgerRow, StockOnHandRow, StockTxnType } from '../../api/inventory';

const QTY_DP = 4;
const COST_DP = 2;

const props = defineProps<{ row: StockOnHandRow | null }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const store = useInventoryStore();

const open = computed({
  get: () => props.row !== null,
  set: (v: boolean) => {
    if (!v) emit('close');
  },
});

const label = computed(() =>
  props.row ? `${props.row.itemCode} — ${props.row.itemName}` : '',
);

// `immediate` so a dialog that mounts with a row already set still loads: without it the fetch
// depends on the prop *changing* after mount, which is true for the usual open-from-null path but
// silently false whenever the component is created with a row in place.
watch(
  () => props.row,
  (row) => {
    if (row) store.loadLedger(row.itemId, `${row.itemCode} — ${row.itemName}`);
  },
  { immediate: true },
);

/**
 * RESERVE and RELEASE move what is AVAILABLE, not what is on the shelf. Shown differently on
 * purpose: a reader scanning the quantity column would otherwise read them as stock arriving and
 * leaving, and then wonder why the balance never moved.
 */
function movesOnHand(txnType: StockTxnType): boolean {
  return MOVES_ON_HAND.has(txnType);
}

/** Sign the displayed quantity so direction reads at a glance; storage is always positive. */
function signedQty(row: StockLedgerRow): string {
  const magnitude = formatAmount(row.qty, QTY_DP);
  if (!movesOnHand(row.txnType)) return magnitude;
  return isInbound(row.txnType) ? `+${magnitude}` : `−${magnitude}`;
}

function severityOf(txnType: StockTxnType): string {
  if (!movesOnHand(txnType)) return 'secondary';
  return isInbound(txnType) ? 'success' : 'info';
}

function formatDate(value?: string): string {
  return value ? new Date(value).toLocaleString() : '';
}
</script>

<template>
  <Dialog
    v-model:visible="open"
    modal
    :header="$t('inventory.ledger.title')"
    class="w-full max-w-5xl"
  >
    <p class="mb-1 font-medium">{{ label }}</p>
    <p class="mb-4 text-sm text-surface-500 dark:text-surface-400">
      {{ $t('inventory.ledger.subtitle') }}
    </p>

    <AppDataTable
      :value="store.ledger"
      :total="store.ledgerTotal"
      :loading="store.loading"
      :page="store.ledgerPage"
      :rows="store.ledgerLimit"
      @page="(e: any) => store.loadLedger(store.ledgerItemId, store.ledgerItemLabel, e.page, e.limit)"
    >
      <Column :header="$t('inventory.ledger.columns.date')">
        <template #body="{ data }">{{ formatDate(data.createdAt) }}</template>
      </Column>

      <Column :header="$t('inventory.ledger.columns.type')">
        <template #body="{ data }">
          <Tag :severity="severityOf(data.txnType)" :value="$t(`inventory.types.${data.txnType}`)" />
          <div
            v-if="!movesOnHand(data.txnType)"
            class="mt-1 text-xs text-surface-500 dark:text-surface-400"
          >
            {{ $t('inventory.ledger.availabilityOnly') }}
          </div>
        </template>
      </Column>

      <Column field="warehouseCode" :header="$t('inventory.ledger.columns.warehouse')" />

      <Column :header="$t('inventory.ledger.columns.qty')" class="text-right">
        <template #body="{ data }">{{ signedQty(data) }}</template>
      </Column>

      <Column :header="$t('inventory.ledger.columns.unitCost')" class="text-right">
        <template #body="{ data }">
          {{ data.unitCost ? formatAmount(data.unitCost, COST_DP) : '—' }}
        </template>
      </Column>

      <!-- Every row links to the approval that produced it, so a surprising balance is traceable. -->
      <Column :header="$t('inventory.ledger.columns.document')">
        <template #body="{ data }">
          <RouterLink
            v-if="data.documentId"
            :to="{ name: 'document-detail', params: { id: data.documentId } }"
            class="text-primary hover:underline"
          >
            {{ data.docNo ?? data.documentId }}
          </RouterLink>
          <span v-else>—</span>
        </template>
      </Column>

      <Column :header="$t('inventory.ledger.columns.balance')" class="text-right">
        <template #body="{ data }">{{ formatAmount(data.balanceAfter, QTY_DP) }}</template>
      </Column>

      <template #empty>
        <EmptyState icon="pi pi-history" :title="$t('inventory.ledger.empty')" />
      </template>
    </AppDataTable>
  </Dialog>
</template>
