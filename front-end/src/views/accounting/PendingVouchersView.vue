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
import type { PendingVoucher } from '../../api/journal';

/**
 * What the approvers are being asked to accept, and which of them is being waited for.
 *
 * A voucher rides a workflow now, so this is a filtered view of the approval inbox rather than a
 * queue of its own: it exists because a voucher's content is accounts and two sides, which the
 * generic approval card does not show. What it adds beyond the lines is the STEP — a voucher can
 * need more than one approval, and "pending" alone stopped telling an approver whether their
 * signature is the one outstanding.
 *
 * Nothing on this screen is in the ledger yet. Acting goes through the document, because the route
 * belongs to the document.
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

// The server sends the document's total, which is the sum of the debits it banded on. Summing the
// lines here again would be a second opinion about the figure the route was decided by.
const totalOf = (v: PendingVoucher) => v.total;
const isMine = (v: PendingVoucher) => v.voucher.document.createdBy?.id === auth.userId;

async function approve(v: PendingVoucher) {
  const ok = await store.actOnVoucher(v.voucher.document.id, 'APPROVE');
  if (ok) fb.success(t('gl.voucher.approved'));
  else fb.error(store.error);
}

async function confirmReject() {
  const { voucher, reason } = rejectDialog.value;
  if (!voucher || !reason.trim()) return;
  const ok = await store.actOnVoucher(voucher.voucher.document.id, 'REJECT', reason.trim());
  if (ok) {
    rejectDialog.value = { open: false, voucher: null, reason: '' };
    fb.success(t('gl.voucher.rejected'));
  } else fb.error(store.error);
}

async function cancel(v: PendingVoucher) {
  const ok = await store.cancelVoucher(v.voucher.document.id);
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
      <DataTable :value="store.pendingVouchers" dataKey="docNo" class="text-sm" :loading="store.loading">
        <Column field="docNo" :header="$t('gl.voucher.fields.docNo')" />
        <Column :header="$t('gl.voucher.fields.entryDate')">
          <template #body="{ data }">{{ formatDate(data.voucher.entryDate) }}</template>
        </Column>
        <Column :header="$t('gl.voucher.fields.memo')">
          <template #body="{ data }">{{ data.voucher.memo }}</template>
        </Column>
        <Column :header="$t('gl.voucher.submittedBy')">
          <template #body="{ data }">
            <div class="flex items-center gap-2">
              <span>{{ data.voucher.document.createdBy?.username }}</span>
              <!-- Marked, not hidden: the server refuses self-approval and says so. -->
              <Tag v-if="isMine(data)" :value="$t('gl.voucher.yours')" severity="secondary" data-testid="own-voucher" />
              <Tag v-if="data.voucher.reversesEntryId" :value="$t('gl.reversal.action')" severity="warn" />
            </div>
          </template>
        </Column>
        <!--
          Which approval is outstanding. A voucher above the configured band needs a second one, so
          a row that says only "pending" leaves both approvers guessing whose turn it is.
        -->
        <Column :header="$t('gl.voucher.step')">
          <template #body="{ data }">
            <span data-testid="voucher-step">{{ $t('gl.voucher.stepNo', { no: data.currentStepNo }) }}</span>
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
                @click="cancel(data)"
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
