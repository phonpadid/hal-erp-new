<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import DetailHeader from '@/components/DetailHeader.vue';
import SectionCard from '@/components/SectionCard.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import AppDataTable from '@/components/AppDataTable.vue';
import { useQuotaStore } from '../../stores/quota';
import { formatAmount } from '../../utils/money';
import { formatDate } from '@/utils/date';

const route = useRoute();
const router = useRouter();
const quota = useQuotaStore();
const { t } = useI18n();
const id = route.params.id as string;

const b = computed(() => quota.breakdown);
const unit = computed(() => b.value?.quota.unit ?? '');

const subtitle = computed(() =>
  b.value
    ? t('quota.detail.meta', {
        department: b.value.quota.departmentName ?? t('quota.detail.companyWide'),
        reset: b.value.quota.resetCycle,
        unit: b.value.quota.unit,
      })
    : '',
);

onMounted(() => quota.loadOne(id));
</script>

<template>
  <div v-if="b">
    <DetailHeader :title="b.quota.quotaType" :subtitle="subtitle">
      <template #actions>
        <Button :label="$t('common.back')" icon="pi pi-arrow-left" text @click="router.back()" />
      </template>
    </DetailHeader>

    <ErrorState v-if="quota.error" :message="quota.error" @retry="quota.loadOne(id)" />

    <SectionCard :title="$t('quota.detail.pool.remaining')">
      <div class="border border-surface rounded p-4 max-w-md">
        <div class="flex justify-between text-sm py-1"><span class="text-muted-color">{{ $t('quota.detail.pool.limit') }}</span><span>{{ formatAmount(b.pool.limit) }} {{ unit }}</span></div>
        <div class="flex justify-between text-sm py-1"><span class="text-muted-color">{{ $t('quota.detail.pool.used') }}</span><span>{{ formatAmount(b.pool.used) }} {{ unit }}</span></div>
        <div class="flex justify-between font-semibold border-t border-surface mt-2 pt-2"><span>{{ $t('quota.detail.pool.remaining') }}</span><span>{{ formatAmount(b.pool.remaining) }} {{ unit }}</span></div>
      </div>
    </SectionCard>

    <SectionCard v-if="b.entitlements.length" :title="$t('quota.detail.entitlements.title')">
      <DataTable :value="b.entitlements" dataKey="employeeId" class="text-sm">
        <Column field="employeeName" :header="$t('quota.detail.entitlements.columns.employee')" />
        <Column field="year" :header="$t('quota.detail.entitlements.columns.year')" />
        <Column :header="$t('quota.detail.entitlements.columns.entitled')"><template #body="{ data }">{{ formatAmount(data.entitled) }}</template></Column>
        <Column :header="$t('quota.detail.entitlements.columns.used')"><template #body="{ data }">{{ formatAmount(data.used) }}</template></Column>
        <Column :header="$t('quota.detail.entitlements.columns.remaining')"><template #body="{ data }">{{ formatAmount(data.remaining) }}</template></Column>
      </DataTable>
    </SectionCard>

    <SectionCard :title="$t('quota.detail.usage.title')">
      <AppDataTable
        :value="quota.usage"
        :total="quota.usageTotal"
        :loading="quota.loading"
        :page="quota.usagePage"
        :rows="quota.usageLimit"
        class="text-sm"
        @page="(e: any) => quota.loadUsage(e.page, e.limit)"
        @refresh="quota.loadUsage()"
      >
        <Column field="usageType" :header="$t('quota.detail.usage.columns.type')" />
        <Column :header="$t('quota.detail.usage.columns.qty')"><template #body="{ data }">{{ formatAmount(data.qtyUsed) }}</template></Column>
        <Column field="employeeName" :header="$t('quota.detail.usage.columns.employee')" />
        <Column :header="$t('quota.detail.usage.columns.document')">
          <template #body="{ data }">
            <a v-if="data.documentNo && data.documentId" class="text-primary cursor-pointer" @click="router.push({ name: 'document-detail', params: { id: data.documentId } })">{{ data.documentNo }}</a>
            <span v-else>{{ $t('common.none') }}</span>
          </template>
        </Column>
        <Column field="createdAt" :header="$t('quota.detail.usage.columns.at')"><template #body="{ data }">{{ formatDate(data.createdAt) }}</template></Column>
        <template #empty>
          <EmptyState icon="pi pi-clock" :title="$t('quota.detail.usage.empty')" />
        </template>
      </AppDataTable>
    </SectionCard>
  </div>
</template>
