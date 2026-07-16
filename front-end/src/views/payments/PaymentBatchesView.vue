<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import Tag from 'primevue/tag';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import AppDataTable from '@/components/AppDataTable.vue';
import { paymentBatchesApi, type PaymentBatch, type PaymentBatchStatus } from '../../api/payments';
import { useAuthStore } from '../../stores/auth';

/**
 * Payment runs.
 *
 * The stalled flag is the point of this page: an EXPORTED batch holds its payables out of the
 * ready-to-pay queue, so if nobody uploads the bank's result those payables go unpaid with no error
 * anywhere. Nothing else surfaces that.
 */
const router = useRouter();
const { t } = useI18n();
const auth = useAuthStore();

const batches = ref<PaymentBatch[]>([]);
const loading = ref(true);
const failed = ref(false);

const canView = computed(() => auth.can('PAYMENT_BATCH_VIEW'));

/** Hours an EXPORTED batch may sit unimported before it is worth flagging. */
const STALL_HOURS = 24;

const SEVERITY: Record<PaymentBatchStatus, string> = {
  DRAFT: 'secondary',
  EXPORTED: 'info',
  COMPLETED: 'success',
  PARTIAL: 'warn',
  CANCELLED: 'contrast',
};

function ageHours(b: PaymentBatch): number | null {
  const from = b.exportedAt ?? b.createdAt;
  if (!from) return null;
  return (Date.now() - new Date(from).getTime()) / 3_600_000;
}

/** An exported batch nobody has imported a result for — its payables are stuck out of the queue. */
function isStalled(b: PaymentBatch): boolean {
  if (b.status !== 'EXPORTED') return false;
  const age = ageHours(b);
  return age !== null && age > STALL_HOURS;
}

function ageLabel(b: PaymentBatch): string {
  const age = ageHours(b);
  if (age === null) return '—';
  if (age < 1) return t('payments.batches.ageMinutes', { n: Math.max(1, Math.round(age * 60)) });
  if (age < 24) return t('payments.batches.ageHours', { n: Math.round(age) });
  return t('payments.batches.ageDays', { n: Math.round(age / 24) });
}

async function load() {
  loading.value = true;
  failed.value = false;
  try {
    batches.value = await paymentBatchesApi.list();
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="flex flex-col gap-4">
    <PageHeader :title="$t('payments.batches.title')" :subtitle="$t('payments.batches.subtitle')" />

    <ErrorState v-if="failed" @retry="load" />
    <EmptyState
      v-else-if="!loading && !batches.length"
      icon="pi pi-inbox"
      :title="$t('payments.batches.empty')"
    />
    <AppDataTable
      v-else-if="canView"
      :value="batches"
      :loading="loading"
      dataKey="id"
      data-testid="batch-table"
      @row-click="(e: { data: PaymentBatch }) => router.push({ name: 'payment-batch-detail', params: { id: e.data.id } })"
    >
      <Column field="status" :header="$t('payments.batches.status')">
        <template #body="{ data }">
          <div class="flex items-center gap-2">
            <Tag :value="$t(`payments.batches.statuses.${data.status}`)" :severity="SEVERITY[data.status as PaymentBatchStatus]" />
            <!-- Its payables are held out of the queue and nothing else would say so. -->
            <Tag
              v-if="isStalled(data)"
              v-tooltip.top="$t('payments.batches.stalledHint')"
              :value="$t('payments.batches.stalled')"
              severity="danger"
              data-testid="stalled-flag"
            />
          </div>
        </template>
      </Column>
      <Column field="createdAt" :header="$t('payments.batches.age')">
        <template #body="{ data }">
          <span class="text-sm text-muted-color">{{ ageLabel(data) }}</span>
        </template>
      </Column>
      <Column field="payDate" :header="$t('payments.batches.payDate')">
        <template #body="{ data }">
          <span class="text-sm">{{ data.payDate ?? '—' }}</span>
        </template>
      </Column>
      <Column field="format" :header="$t('payments.batches.format')" />
      <Column class="w-24">
        <template #body="{ data }">
          <Button
            icon="pi pi-arrow-right"
            text
            rounded
            :aria-label="$t('common.view')"
            @click="router.push({ name: 'payment-batch-detail', params: { id: data.id } })"
          />
        </template>
      </Column>
    </AppDataTable>
  </div>
</template>
