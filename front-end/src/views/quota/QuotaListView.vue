<script setup lang="ts">
import Column from 'primevue/column';
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import { useSearchTerm } from '@/composables/useSearchTerm';
import PageToolbar from '@/components/PageToolbar.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import AppDataTable from '@/components/AppDataTable.vue';
import { useQuotaStore } from '../../stores/quota';
import { formatAmount } from '../../utils/money';

const router = useRouter();
const quota = useQuotaStore();

/**
 * The search term, answered by the SERVER across the whole quota register.
 *
 * `AppDataTable` runs in `lazy` mode, where PrimeVue delegates filtering to the server and ignores
 * `filters` / `globalFilterFields` — the bindings this replaces. They were decoration, and a
 * client-side filter would have been wrong regardless: the client holds one page, so it would have
 * searched a fraction of the set while looking like it searched all of it.
 */
const { term, onSearch } = useSearchTerm((t) => quota.loadList(1, quota.limit, t));

onMounted(() => quota.loadList());
</script>

<template>
  <div>
    <PageHeader :title="$t('quota.list.title')" :subtitle="$t('quota.list.subtitle')" />

    <PageToolbar :search="term" @update:search="onSearch" />

    <ErrorState v-if="quota.error" :message="quota.error" @retry="quota.loadList()" />

    <div v-else class="card">
      <AppDataTable
        :value="quota.list"
        :total="quota.total"
        :loading="quota.loading"
        :page="quota.page"
        :rows="quota.limit"
        :rowHover="true"
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
