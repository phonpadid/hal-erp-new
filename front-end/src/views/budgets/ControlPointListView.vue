<script setup lang="ts">
/**
 * The control points that decide whether spending is allowed.
 *
 * A control point has no `budget` row of its own — a parent is a rollup, not an envelope — so
 * without this screen the only way to see a category's remaining ceiling is to open one of the
 * budgets beneath it and read the panel there.
 */
import Column from 'primevue/column';
import Tag from 'primevue/tag';
import { computed, onMounted, ref } from 'vue';
import { FilterMatchMode } from '@primevue/core/api';
import { useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import PageToolbar from '@/components/PageToolbar.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import AppDataTable from '@/components/AppDataTable.vue';
import { useBudgetsStore } from '../../stores/budgets';
import { formatAmount } from '../../utils/money';

const router = useRouter();
const budgets = useBudgetsStore();

const filters = ref({ global: { value: null as string | null, matchMode: FilterMatchMode.CONTAINS } });

// The company base currency, taken from any loaded budget — control points carry no currency of
// their own because they hold no money of their own.
const decimals = computed<number>(
  () => budgets.list[0]?.fiscalYear?.company?.baseCurrency?.decimalPlaces ?? 2,
);

/** A ladder as a compact string: "90% warn · 100% block". */
const ladderOf = (row: { tolerance: { at: number; action: string }[] }) =>
  [...row.tolerance]
    .sort((a, b) => a.at - b.at)
    .map((r) => `${r.at}% ${r.action.toLowerCase()}`)
    .join(' · ');

onMounted(async () => {
  // The budget list comes along for the currency; the control points are the screen.
  // No fiscal year is passed: the server scopes to the year covering today.
  await Promise.all([budgets.loadControlPoints(), budgets.list.length ? Promise.resolve() : budgets.loadList()]);
});
</script>

<template>
  <div>
    <PageHeader :title="$t('budgets.controlPointList.title')" :subtitle="$t('budgets.controlPointList.subtitle')" />

    <PageToolbar :search="filters.global.value ?? ''" @update:search="filters.global.value = $event" />

    <ErrorState v-if="budgets.error" :message="budgets.error" @retry="budgets.loadControlPoints()" />

    <div v-else class="card">
      <AppDataTable
        :value="budgets.controlPointList"
        :total="budgets.controlPointList.length"
        :loading="budgets.controlPointsLoading"
        :page="1"
        :rows="budgets.controlPointList.length || 20"
        :rowHover="true"
        :filters="filters"
        :globalFilterFields="['budgetNodeCode', 'budgetNodeName', 'departmentNodeCode', 'departmentNodeName']"
        @refresh="budgets.loadControlPoints()"
        @row-click="(e: any) => router.push({ name: 'control-point-detail', params: { id: e.data.id } })"
      >
        <Column field="budgetNodeCode" :header="$t('budgets.controlPointList.budgetNode')">
          <template #body="{ data }">{{ data.budgetNodeCode }} · {{ data.budgetNodeName }}</template>
        </Column>
        <Column field="departmentNodeCode" :header="$t('budgets.controlPointList.departmentNode')">
          <template #body="{ data }">{{ data.departmentNodeCode }} · {{ data.departmentNodeName }}</template>
        </Column>
        <Column :header="$t('budgets.controlPointList.ladder')">
          <template #body="{ data }">{{ ladderOf(data) }}</template>
        </Column>
        <Column :header="$t('budgets.controlPointList.ceiling')">
          <template #body="{ data }">{{ formatAmount(data.ceiling, decimals) }}</template>
        </Column>
        <Column :header="$t('budgets.controlPointList.used')">
          <template #body="{ data }">{{ formatAmount(data.used, decimals) }}</template>
        </Column>
        <Column :header="$t('budgets.controlPointList.available')">
          <template #body="{ data }">{{ formatAmount(data.available, decimals) }}</template>
        </Column>
        <Column :header="$t('budgets.controlPointList.governs')">
          <template #body="{ data }">{{ data.governedBudgetIds.length }}</template>
        </Column>
        <Column :header="$t('common.status')">
          <template #body="{ data }">
            <Tag
              :value="$t('budgets.status.' + (data.isActive ? 'ACTIVE' : 'INACTIVE'))"
              :severity="data.isActive ? 'success' : 'secondary'"
            />
          </template>
        </Column>
        <template #empty>
          <EmptyState
            icon="pi pi-sliders-h"
            :title="$t('budgets.controlPointList.empty')"
            :message="$t('budgets.controlPointList.emptyHint')"
          />
        </template>
      </AppDataTable>
    </div>
  </div>
</template>
