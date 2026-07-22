<script setup lang="ts">
import { FilterMatchMode } from '@primevue/core/api';
import Button from 'primevue/button';
import Column from 'primevue/column';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AppDataTable from '@/components/AppDataTable.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import PageHeader from '@/components/PageHeader.vue';
import PageToolbar from '@/components/PageToolbar.vue';
import StockLedgerDialog from './StockLedgerDialog.vue';
import { useInventoryStore } from '../../stores/inventory';
import { formatAmount } from '../../utils/money';
import type { StockOnHandRow } from '../../api/inventory';

/** Quantities are `numeric(15,4)`; costs and values are money and follow the currency. */
const QTY_DP = 4;
const COST_DP = 2;

const { t } = useI18n();
const store = useInventoryStore();

const filters = ref({ global: { value: null as string | null, matchMode: FilterMatchMode.CONTAINS } });
const ledgerFor = ref<StockOnHandRow | null>(null);

// No synthetic "all" option: PrimeVue's Select treats '' as no selection, so an option with an
// empty value renders blank rather than showing its label. `showClear` + a placeholder says the
// same thing and behaves correctly.
const warehouseOptions = computed(() =>
  store.warehouses.map((w) => ({ label: `${w.code} — ${w.name}`, value: w.id })),
);

/** Reserved is worth calling out only when something is actually held. */
function hasReservation(row: StockOnHandRow): boolean {
  return Number(row.qtyReserved) > 0;
}

onMounted(async () => {
  await Promise.all([store.loadOnHand(), store.loadWarehouses(1, 100)]);
});
</script>

<template>
  <div>
    <PageHeader :title="$t('inventory.onHand.title')" :subtitle="$t('inventory.onHand.subtitle')" />

    <PageToolbar
      :search="filters.global.value ?? ''"
      @update:search="filters.global.value = $event"
    >
      <template #filters>
        <Select
          :modelValue="store.warehouseFilter || null"
          :options="warehouseOptions"
          optionLabel="label"
          optionValue="value"
          showClear
          :placeholder="$t('inventory.onHand.filterWarehouse')"
          class="w-full sm:w-64"
          @update:modelValue="store.setWarehouseFilter($event ?? '')"
        />
      </template>
    </PageToolbar>

    <ErrorState v-if="store.error" :message="store.error" @retry="store.loadOnHand()" />

    <div v-else class="card">
      <AppDataTable
        :value="store.onHand"
        :total="store.total"
        :loading="store.loading"
        :page="store.page"
        :rows="store.limit"
        :rowHover="true"
        :filters="filters"
        :globalFilterFields="['itemCode', 'itemName', 'warehouseCode']"
        @page="(e: any) => store.loadOnHand(e.page, e.limit)"
        @refresh="store.loadOnHand()"
      >
        <Column :header="$t('inventory.onHand.columns.item')">
          <template #body="{ data }">
            <div class="font-medium">{{ data.itemCode }}</div>
            <div class="text-sm text-surface-500 dark:text-surface-400">{{ data.itemName }}</div>
          </template>
        </Column>

        <Column :header="$t('inventory.onHand.columns.warehouse')">
          <template #body="{ data }">{{ data.warehouseCode }}</template>
        </Column>

        <Column :header="$t('inventory.onHand.columns.onHand')" class="text-right">
          <template #body="{ data }">{{ formatAmount(data.qtyOnHand, QTY_DP) }}</template>
        </Column>

        <!--
          Reserved and available are shown next to on-hand, not hidden behind a detail view:
          "10 on hand of which 8 are spoken for" is the number that decides whether a requester
          can issue anything, and it is not derivable from on-hand alone.
        -->
        <Column :header="$t('inventory.onHand.columns.reserved')" class="text-right">
          <template #body="{ data }">
            <Tag
              v-if="hasReservation(data)"
              severity="warn"
              :value="formatAmount(data.qtyReserved, QTY_DP)"
              v-tooltip.top="$t('inventory.onHand.reservedHint')"
            />
            <span v-else class="text-surface-400">{{ formatAmount(data.qtyReserved, QTY_DP) }}</span>
          </template>
        </Column>

        <Column :header="$t('inventory.onHand.columns.available')" class="text-right">
          <template #body="{ data }">
            <span class="font-semibold">{{ formatAmount(data.qtyAvailable, QTY_DP) }}</span>
          </template>
        </Column>

        <Column :header="$t('inventory.onHand.columns.avgCost')" class="text-right">
          <template #body="{ data }">{{ formatAmount(data.avgCost, COST_DP) }}</template>
        </Column>

        <Column :header="$t('inventory.onHand.columns.value')" class="text-right">
          <template #body="{ data }">{{ formatAmount(data.totalValue, COST_DP) }}</template>
        </Column>

        <Column class="w-16">
          <template #body="{ data }">
            <Button
              icon="pi pi-history"
              text
              rounded
              :aria-label="$t('inventory.onHand.viewLedger')"
              v-tooltip.top="$t('inventory.onHand.viewLedger')"
              @click="ledgerFor = data"
            />
          </template>
        </Column>

        <template #empty>
          <EmptyState icon="pi pi-box" :title="$t('inventory.onHand.empty')" />
        </template>
      </AppDataTable>
    </div>

    <StockLedgerDialog
      :row="ledgerFor"
      @close="ledgerFor = null"
    />
  </div>
</template>
