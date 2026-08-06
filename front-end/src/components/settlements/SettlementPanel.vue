<script setup lang="ts">
/**
 * A document's settlement, on its detail page. Mounted only for a fully approved document whose
 * type accrues at approval. Reads `GET /documents/:id/settlement`: a 200 shows how it was settled,
 * a 404 is the normal "approved, awaiting settlement" state — not an error. A PAYMENT_MANAGE user
 * can record the settlement from here (the same dialog the queue uses); once settled, the record
 * action is gone (the server keeps a settlement immutable and single).
 */
import Button from 'primevue/button';
import { onMounted, ref } from 'vue';
import RecordSettlementDialog from './RecordSettlementDialog.vue';
import { settlementsApi, type DocumentSettlement } from '../../api/settlements';
import { useAuthStore } from '../../stores/auth';

const props = defineProps<{ documentId: string; docNo?: string }>();

const auth = useAuthStore();

const settlement = ref<DocumentSettlement | null>(null);
const loading = ref(true);
const dialogOpen = ref(false);

const canManage = () => auth.can('PAYMENT_MANAGE');

async function load() {
  loading.value = true;
  try {
    settlement.value = await settlementsApi.read(props.documentId);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="settlement-panel">
    <div class="flex items-center gap-2">
      <i class="pi pi-money-bill text-muted-color text-sm" />
      <span class="text-sm font-medium text-color">{{ $t('settlements.panel.title') }}</span>
    </div>

    <div v-if="loading" class="text-xs text-muted-color">{{ $t('common.loading') }}</div>

    <template v-else>
      <!-- Settled: how and when. -->
      <div v-if="settlement" class="flex flex-col gap-1 text-sm" data-testid="settlement-recorded">
        <div>
          {{ $t('settlements.panel.type') }}:
          <span class="font-medium">{{ $t('settlements.types.' + settlement.settlementType, settlement.settlementType) }}</span>
        </div>
        <div>{{ $t('settlements.panel.settledAt') }}: <span class="tabular-nums">{{ $d(new Date(settlement.settledAt), 'short') }}</span></div>
        <div v-if="settlement.reference">{{ $t('settlements.panel.reference') }}: {{ settlement.reference }}</div>
      </div>

      <!-- Approved but not yet settled — a normal state, not an error. -->
      <div v-else class="flex flex-col gap-2" data-testid="settlement-awaiting">
        <span class="text-sm text-muted-color">{{ $t('settlements.panel.awaiting') }}</span>
        <Button
          v-if="canManage()"
          :label="$t('settlements.record.action')"
          icon="pi pi-money-bill"
          size="small"
          class="self-start"
          data-testid="panel-record"
          @click="dialogOpen = true"
        />
      </div>
    </template>

    <RecordSettlementDialog
      v-model:visible="dialogOpen"
      :documentId="documentId"
      :docNo="docNo"
      @recorded="load"
    />
  </div>
</template>
