<script setup lang="ts">
/**
 * The finance settlements queue: documents that accrue their expense at approval, are fully
 * approved, and have no settlement recorded yet. Recording a settlement here writes
 * `document_settlement` — this is NOT Ready-to-Pay (that flow records a `payment` with FX for
 * CUT_BUDGET disbursements). The banner and labels keep the two apart so finance does not settle
 * an accruing document through the payment flow.
 */
import { FilterMatchMode } from '@primevue/core/api';
import Button from 'primevue/button';
import Column from 'primevue/column';
import Message from 'primevue/message';
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import PageToolbar from '@/components/PageToolbar.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import AppDataTable from '@/components/AppDataTable.vue';
import RecordSettlementDialog from '@/components/settlements/RecordSettlementDialog.vue';
import { useSettlementsStore } from '../../stores/settlements';
import { useAuthStore } from '../../stores/auth';
import { useCurrencyFormat } from '../../composables/useCurrencyFormat';
import type { UnsettledDocument } from '../../api/settlements';

const router = useRouter();
const settlements = useSettlementsStore();
const auth = useAuthStore();
// Queue amounts are base-currency totals (what accrued to the budget), so they format to base.
const { fmtBase, baseCode } = useCurrencyFormat();
const filters = ref({ global: { value: null as string | null, matchMode: FilterMatchMode.CONTAINS } });

const canManage = () => auth.can('PAYMENT_MANAGE');

const dialog = ref<{ open: boolean; doc?: UnsettledDocument }>({ open: false });
function openRecord(doc: UnsettledDocument) {
  dialog.value = { open: true, doc };
}

function onRowClick(e: { data: UnsettledDocument }) {
  router.push({ name: 'document-detail', params: { id: e.data.id } });
}

onMounted(() => settlements.loadUnsettled());
</script>

<template>
  <div>
    <PageHeader :title="$t('settlements.title')" :subtitle="$t('settlements.subtitle')" />

    <!-- Not Ready-to-Pay: say so where finance would otherwise reach for the payment flow. -->
    <Message severity="info" variant="simple" size="small" class="mb-3" data-testid="settlement-vs-payment">
      {{ $t('settlements.distinctFromPayment') }}
    </Message>

    <PageToolbar :search="filters.global.value ?? ''" @update:search="filters.global.value = $event" />

    <ErrorState v-if="settlements.error" :message="settlements.error" @retry="settlements.loadUnsettled()" />

    <div v-else class="card">
      <AppDataTable
        :value="settlements.unsettled"
        :total="settlements.unsettled.length"
        :loading="settlements.loading"
        :rowHover="true"
        :filters="filters"
        :globalFilterFields="['docNo', 'department']"
        dataKey="id"
        @refresh="settlements.loadUnsettled()"
        @row-click="onRowClick"
      >
        <Column field="docNo" :header="$t('settlements.columns.docNo')" />
        <Column :header="$t('settlements.columns.department')">
          <template #body="{ data }">{{ data.department || '—' }}</template>
        </Column>
        <Column
          field="totalAmount"
          :header="$t('settlements.columns.amount')"
          headerClass="[&>div]:justify-end"
          bodyClass="text-right! tabular-nums"
        >
          <template #body="{ data }">
            <span v-if="data.totalAmount">{{ fmtBase(data.totalAmount) }} <span class="text-muted-color">{{ baseCode() }}</span></span>
            <span v-else class="text-muted-color">—</span>
          </template>
        </Column>
        <Column :header="$t('settlements.columns.approvedAt')">
          <template #body="{ data }">{{ data.approvedAt ? $d(new Date(data.approvedAt), 'short') : '—' }}</template>
        </Column>
        <Column v-if="canManage()" :header="$t('settlements.columns.action')">
          <template #body="{ data }">
            <Button :label="$t('settlements.record.action')" size="small" text data-testid="open-record" @click.stop="openRecord(data)" />
          </template>
        </Column>
        <template #empty>
          <EmptyState icon="pi pi-check-circle" :title="$t('settlements.empty')" />
        </template>
      </AppDataTable>
    </div>

    <RecordSettlementDialog
      v-if="dialog.doc"
      v-model:visible="dialog.open"
      :documentId="dialog.doc.id"
      :docNo="dialog.doc.docNo"
      @recorded="settlements.loadUnsettled()"
    />
  </div>
</template>
