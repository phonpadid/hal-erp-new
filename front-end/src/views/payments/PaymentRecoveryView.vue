<script setup lang="ts">
/**
 * Payments awaiting recovery: recorded early (at a step that demanded evidence), then the
 * document was rejected by a later step. Real money already left the company for each of these —
 * the budget released the reservation in full, exactly as any other rejection, so nothing else in
 * the system would surface that a real transfer still needs a manual GL reversal against it
 * (payment-recovery). Resolving requires the reference to that reversal voucher; this page never
 * posts to the GL itself.
 */
import Button from 'primevue/button';
import Column from 'primevue/column';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Tag from 'primevue/tag';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import AppDataTable from '@/components/AppDataTable.vue';
import { paymentsApi, type RecoveryPendingPayment } from '../../api/payments';
import { useAuthStore } from '../../stores/auth';
import { useCurrencyFormat } from '../../composables/useCurrencyFormat';
import { useFeedback } from '../../composables/useFeedback';
import { formatDateTime } from '../../utils/date';

const router = useRouter();
const { t } = useI18n();
const auth = useAuthStore();
const fb = useFeedback();
const { fmtBase, baseCode } = useCurrencyFormat();

const canManage = computed(() => auth.can('PAYMENT_MANAGE'));

const items = ref<RecoveryPendingPayment[]>([]);
const loading = ref(true);
const failed = ref(false);

async function load() {
  loading.value = true;
  failed.value = false;
  try {
    items.value = await paymentsApi.recovery.pending();
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
}

const resolveDialog = ref<{ open: boolean; item?: RecoveryPendingPayment; reference: string }>({
  open: false,
  reference: '',
});
function openResolve(item: RecoveryPendingPayment) {
  resolveDialog.value = { open: true, item, reference: '' };
}
const resolving = ref(false);
async function confirmResolve() {
  const item = resolveDialog.value.item;
  if (!item || !resolveDialog.value.reference.trim()) return;
  resolving.value = true;
  try {
    await paymentsApi.recovery.resolve(item.id, resolveDialog.value.reference.trim());
    resolveDialog.value.open = false;
    fb.success(t('payments.recovery.resolved'));
    await load();
  } catch (e) {
    fb.error(e, t('payments.recovery.resolveFailed'));
  } finally {
    resolving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="flex flex-col gap-4">
    <PageHeader :title="$t('payments.recovery.title')" :subtitle="$t('payments.recovery.subtitle')" />

    <ErrorState v-if="failed" :message="$t('common.loadFailed')" @retry="load" />
    <EmptyState
      v-else-if="!loading && !items.length"
      icon="pi pi-verified"
      :title="$t('payments.recovery.empty')"
    />
    <AppDataTable
      v-else
      :value="items"
      :total="items.length"
      :loading="loading"
      dataKey="id"
      data-testid="recovery-table"
      @row-click="(e: { data: RecoveryPendingPayment }) => router.push({ name: 'document-detail', params: { id: e.data.document.id } })"
    >
      <Column field="document.docNo" :header="$t('payments.recovery.docNo')" />
      <Column :header="$t('payments.recovery.amount')" headerClass="[&>div]:justify-end" bodyClass="text-right! tabular-nums">
        <template #body="{ data }">
          {{ fmtBase(data.baseActual) }} <span class="text-muted-color">{{ baseCode() }}</span>
        </template>
      </Column>
      <Column :header="$t('payments.recovery.method')">
        <template #body="{ data }">
          <Tag :value="$t(`payments.record.method.${data.method}`)" severity="secondary" />
        </template>
      </Column>
      <Column :header="$t('payments.recovery.flaggedAt')">
        <template #body="{ data }">
          <span class="text-sm text-muted-color">{{ data.recoveryFlaggedAt ? formatDateTime(data.recoveryFlaggedAt) : '—' }}</span>
        </template>
      </Column>
      <Column v-if="canManage" class="w-40">
        <template #body="{ data }">
          <Button
            :label="$t('payments.recovery.resolve')"
            size="small"
            text
            data-testid="resolve-action"
            @click.stop="openResolve(data)"
          />
        </template>
      </Column>
    </AppDataTable>

    <Dialog v-model:visible="resolveDialog.open" :header="$t('payments.recovery.resolve')" modal class="w-96">
      <div class="flex flex-col gap-3">
        <p class="text-sm text-muted-color">{{ $t('payments.recovery.resolveHint') }}</p>
        <div class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('payments.recovery.reference') }}</label>
          <InputText v-model="resolveDialog.reference" data-testid="recovery-reference" />
        </div>
      </div>
      <template #footer>
        <Button :label="$t('common.close')" text @click="resolveDialog.open = false" />
        <Button
          :label="$t('payments.recovery.resolve')"
          :disabled="!resolveDialog.reference.trim()"
          :loading="resolving"
          data-testid="confirm-resolve"
          @click="confirmResolve"
        />
      </template>
    </Dialog>
  </div>
</template>
