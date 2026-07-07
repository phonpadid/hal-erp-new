<script setup lang="ts">
import { FilterMatchMode } from '@primevue/core/api';
import Column from 'primevue/column';
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import PageToolbar from '@/components/PageToolbar.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import AppDataTable from '@/components/AppDataTable.vue';
import { useQuotaStore } from '../../stores/quota';
import { formatAmount } from '../../utils/money';

const router = useRouter();
const quota = useQuotaStore();

const filters = ref({ global: { value: null as string | null, matchMode: FilterMatchMode.CONTAINS } });

onMounted(() => quota.loadList());
</script>

<template>
  <div>
    <PageHeader :title="$t('quota.list.title')" :subtitle="$t('quota.list.subtitle')" />

    <PageToolbar :search="filters.global.value ?? ''" @update:search="filters.global.value = $event" />

    <ErrorState v-if="quota.error" :message="quota.error" @retry="quota.loadList()" />

    <div v-else class="card">
      <AppDataTable
        :value="quota.list"
        :total="quota.total"
        :loading="quota.loading"
        :page="quota.page"
        :rows="quota.limit"
        :rowHover="true"
        :filters="filters"
        :globalFilterFields="['quotaType', 'unit']"
        @page="(e: any) => quota.loadList(e.page, e.limit)"
        @refresh="quota.loadList()"
        @row-click="(e: any) => router.push({ name: 'quota-detail', params: { id: e.data.id } })"
      >
        <Column field="quotaType" :header="$t('quota.list.columns.type')" />
        <Column field="unit" :header="$t('quota.list.columns.unit')" />
        <Column :header="$t('quota.list.columns.department')"><template #body="{ data }">{{ data.department?.name ?? $t('common.none') }}</template></Column>
        <Column :header="$t('quota.list.columns.limit')"><template #body="{ data }">{{ formatAmount(data.limitValue) }}</template></Column>
        <Column :header="$t('quota.list.columns.poolRemaining')"><template #body="{ data }">{{ formatAmount(data.remaining) }}</template></Column>
        <Column field="resetCycle" :header="$t('quota.list.columns.reset')" />
        <template #empty>
          <EmptyState icon="pi pi-chart-pie" :title="$t('quota.list.empty')" />
        </template>
      </AppDataTable>
    </div>
  </div>
</template>
