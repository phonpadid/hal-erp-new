<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Dialog from 'primevue/dialog';
import Message from 'primevue/message';
import Tag from 'primevue/tag';
import Textarea from 'primevue/textarea';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import PageHeader from '@/components/PageHeader.vue';
import { formatDate } from '@/utils/date';
import { useCurrencyFormat } from '../../composables/useCurrencyFormat';
import { useFeedback } from '../../composables/useFeedback';
import { useAuthStore } from '../../stores/auth';
import { useJournalStore } from '../../stores/journal';
import { sumAmounts } from '../../utils/money';
import type { PendingVoucher } from '../../api/journal';

/**
 * What a checker is being asked to accept.
 *
 * `GL_JV_POST` used to write the ledger on its own — the largest privilege in the system, guarded
 * by a permission rather than by an approval route. Nothing on this screen is in the ledger yet.
 *
 * The approve control is NOT hidden on a viewer's own voucher. The server refuses self-approval and
 * its refusal is the one that matters; hiding the button would make a rule look like a missing
 * feature. It is marked instead.
 */
const { t } = useI18n();
const fb = useFeedback();
const { fmtBase } = useCurrencyFormat();
const auth = useAuthStore();
const store = useJournalStore();

const canDecide = computed(() => auth.can('GL_JV_APPROVE'));
const rejectDialog = ref<{ open: boolean; voucher: PendingVoucher | null; reason: string }>({
  open: false,
  voucher: null,
  reason: '',
});

const totalOf = (v: PendingVoucher) => sumAmounts(v.lines.map((l) => l.debit));
const isMine = (v: PendingVoucher) => v.createdBy.id === auth.userId;

async function approve(v: PendingVoucher) {
  const ok = await store.approveVoucher(v.id);
  if (ok) fb.success(t('gl.voucher.approved'));
  else fb.error(store.error);
}

async function confirmReject() {
  const { voucher, reason } = rejectDialog.value;
  if (!voucher || !reason.trim()) return;
  const ok = await store.rejectVoucher(voucher.id, reason.trim());
  if (ok) {
    rejectDialog.value = { open: false, voucher: null, reason: '' };
    fb.success(t('gl.voucher.rejected'));
  } else fb.error(store.error);
}

async function withdraw(v: PendingVoucher) {
  const ok = await store.withdrawVoucher(v.id);
  if (ok) fb.success(t('gl.voucher.withdrawn'));
  else fb.error(store.error);
}

onMounted(() => store.loadPendingVouchers());
</script>

<template>
  <div>
    <PageHeader :title="$t('gl.voucher.pendingTitle')" :subtitle="$t('gl.voucher.pendingSubtitle')" />

    <ErrorState v-if="store.error && !store.pendingVouchers.length" :message="store.error" @retry="store.loadPendingVouchers()" />

    <div v-else class="card">
      <DataTable :value="store.pendingVouchers" dataKey="id" class="text-sm" :loading="store.loading">
        <Column :header="$t('gl.voucher.fields.entryDate')">
          <template #body="{ data }">{{ formatDate(data.entryDate) }}</template>
        </Column>
        <Column field="memo" :header="$t('gl.voucher.fields.memo')" />
        <Column :header="$t('gl.voucher.submittedBy')">
          <template #body="{ data }">
            <div class="flex items-center gap-2">
              <span>{{ data.createdBy.username }}</span>
              <!-- Marked, not hidden: the server refuses self-approval and says so. -->
              <Tag v-if="isMine(data)" :value="$t('gl.voucher.yours')" severity="secondary" data-testid="own-voucher" />
              <Tag v-if="data.reversesEntryId" :value="$t('gl.reversal.action')" severity="warn" />
            </div>
          </template>
        </Column>
        <Column :header="$t('gl.journal.columns.total')" headerStyle="text-align:right">
          <template #body="{ data }">
            <span class="tabular-nums" data-testid="voucher-total">{{ fmtBase(totalOf(data)) }}</span>
          </template>
        </Column>
        <Column>
          <template #body="{ data }">
            <div class="flex flex-wrap justify-end gap-2">
              <Button
                v-if="canDecide"
                :label="$t('gl.voucher.approve')"
                size="small"
                :loading="store.working"
                data-testid="approve-voucher"
                @click="approve(data)"
              />
              <Button
                v-if="canDecide"
                :label="$t('gl.voucher.reject')"
                size="small"
                severity="danger"
                text
                data-testid="open-reject"
                @click="rejectDialog = { open: true, voucher: data, reason: '' }"
              />
              <Button
                v-if="isMine(data)"
                :label="$t('gl.voucher.withdraw')"
                size="small"
                text
                data-testid="withdraw-voucher"
                @click="withdraw(data)"
              />
            </div>
          </template>
        </Column>
        <template #empty>
          <EmptyState icon="pi pi-check-circle" :title="$t('gl.voucher.pendingEmpty')" />
        </template>
      </DataTable>
    </div>

    <Dialog v-model:visible="rejectDialog.open" modal :header="$t('gl.voucher.reject')" class="w-full max-w-md">
      <div class="flex flex-col gap-3">
        <Message severity="info" size="small" variant="simple">{{ $t('gl.voucher.rejectExplain') }}</Message>
        <label class="flex flex-col gap-1 text-sm text-muted-color">
          {{ $t('gl.periods.fields.reason') }}
          <Textarea v-model="rejectDialog.reason" rows="3" autoResize />
        </label>
      </div>
      <template #footer>
        <Button :label="$t('common.cancel')" text @click="rejectDialog.open = false" />
        <Button
          :label="$t('gl.voucher.reject')"
          severity="danger"
          :disabled="!rejectDialog.reason.trim()"
          :loading="store.working"
          data-testid="confirm-reject"
          @click="confirmReject"
        />
      </template>
    </Dialog>
  </div>
</template>
