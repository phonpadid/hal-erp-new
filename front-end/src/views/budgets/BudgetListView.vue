<script setup lang="ts">
import { FilterMatchMode } from '@primevue/core/api';
import Button from 'primevue/button';
import Column from 'primevue/column';
import Tag from 'primevue/tag';
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import PageToolbar from '@/components/PageToolbar.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import AppDataTable from '@/components/AppDataTable.vue';
import { useBudgetsStore } from '../../stores/budgets';
import type { BudgetSummary } from '../../api/budgets';
import { formatAmount } from '../../utils/money';

const router = useRouter();
const budgets = useBudgetsStore();

const filters = ref({ global: { value: null as string | null, matchMode: FilterMatchMode.CONTAINS } });

// Format money to the budget's company base-currency decimal_places (money rule), not a
// hardcoded 2 — correct for 0-decimal (JPY) and 3-decimal (KWD) currencies.
const decimalsOf = (row: BudgetSummary) => row.fiscalYear?.company?.baseCurrency?.decimalPlaces ?? 2;

onMounted(() => budgets.loadList());
</script>

<template>
  <div>
    <PageHeader :title="$t('budgets.list.title')" />

    <PageToolbar :search="filters.global.value ?? ''" @update:search="filters.global.value = $event">
      <template #actions>
        <Button
          v-can="'BUDGET_MANAGE'"
          :label="$t('budgets.form.createTitle')"
          icon="pi pi-plus"
          size="small"
          @click="router.push({ name: 'budget-new' })"
        />
      </template>
    </PageToolbar>

    <ErrorState v-if="budgets.error" :message="budgets.error" @retry="budgets.loadList()" />

    <div v-else class="card">
      <AppDataTable
        :value="budgets.list"
        :total="budgets.total"
        :loading="budgets.loading"
        :page="budgets.page"
        :rows="budgets.limit"
        :rowHover="true"
        :filters="filters"
        :globalFilterFields="['budgetName', 'glAccount']"
        @page="(e: { page: number; limit: number }) => budgets.loadList(e.page, e.limit)"
        @refresh="budgets.loadList()"
        @row-click="(e: any) => router.push({ name: 'budget-detail', params: { id: e.data.id } })"
      >
        <Column field="budgetName" :header="$t('common.name')"><template #body="{ data }">{{ data.budgetName ?? $t('common.none') }}</template></Column>
        <Column field="glAccount" :header="$t('budgets.list.gl')" />
        <Column :header="$t('budgets.list.fiscalYear')"><template #body="{ data }">{{ data.fiscalYear?.year ?? $t('common.none') }}</template></Column>
        <Column :header="$t('budgets.list.department')"><template #body="{ data }">{{ data.department?.name ?? $t('common.none') }}</template></Column>
        <Column :header="$t('common.total')"><template #body="{ data }">{{ formatAmount(data.amountTotal, decimalsOf(data)) }}</template></Column>
        <Column :header="$t('budgets.list.available')"><template #body="{ data }">{{ formatAmount(data.available, decimalsOf(data)) }}</template></Column>
        <Column :header="$t('common.status')"><template #body="{ data }"><Tag :value="$t('budgets.status.' + data.status)" :severity="data.status === 'ACTIVE' ? 'success' : 'secondary'" /></template></Column>
        <template #empty>
          <EmptyState icon="pi pi-wallet" :title="$t('budgets.list.empty')" />
        </template>
      </AppDataTable>
    </div>
  </div>
</template>
