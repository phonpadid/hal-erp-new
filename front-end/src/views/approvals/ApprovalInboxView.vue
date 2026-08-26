<script setup lang="ts">
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
import ReviewApprovalDialog from '@/components/documents/ReviewApprovalDialog.vue';
import { useApprovalsStore } from '../../stores/approvals';
import { useCurrencyFormat } from '../../composables/useCurrencyFormat';
import { formatDate } from '../../utils/date';
import type { PendingApproval } from '../../api/approvals';

const router = useRouter();
const approvals = useApprovalsStore();
const { fmtBase } = useCurrencyFormat();

/**
 * The search term, answered by the SERVER across the whole pending set.
 *
 * This used to bind PrimeVue's client-side `filters` / `globalFilterFields`. `AppDataTable` runs
 * the table in `lazy` mode, where PrimeVue delegates filtering to the server and ignores those
 * bindings entirely — nothing handled the filter event, so the box was decoration. And a
 * client-side filter would have been wrong anyway: in lazy mode the client holds one page, so it
 * would have searched a fraction of the queue while looking like it searched all of it.
 */
const search = ref('');
function onSearch(term: string) {
  search.value = term;
  // Back to page 1: the term changes which documents exist, so the old offset means nothing.
  approvals.loadPending(1, approvals.limit, term);
}

// Act on a row without leaving the inbox. Every inbox row is pending this user, so the
// shared dialog's `canAct` fetch will confirm eligibility and the server re-enforces act().
const reviewOpen = ref(false);
const reviewDoc = ref<{ id: string; docNo: string }>({ id: '', docNo: '' });
function openReview(row: PendingApproval) {
  reviewDoc.value = { id: row.id, docNo: row.docNo };
  reviewOpen.value = true;
}

onMounted(() => approvals.loadPending());
</script>

<template>
  <div>
    <PageHeader :title="$t('approvals.title')" />

    <PageToolbar :search="search" @update:search="onSearch" />

    <ErrorState v-if="approvals.error" :message="approvals.error" @retry="approvals.loadPending()" />

    <div v-else class="card">
      <AppDataTable
        :value="approvals.pending"
        :total="approvals.total"
        :loading="approvals.loading"
        :page="approvals.page"
        :rows="approvals.limit"
        :rowHover="true"
        @page="(e: { page: number; limit: number }) => approvals.loadPending(e.page, e.limit)"
        @refresh="approvals.loadPending()"
        @row-click="(e: any) => router.push({ name: 'document-detail', params: { id: e.data.id } })"
      >
        <Column field="docNo" :header="$t('approvals.columns.docNo')" />
        <Column :header="$t('approvals.columns.type')"><template #body="{ data }">{{ data.documentType?.name }}</template></Column>
        <Column field="requesterName" :header="$t('approvals.columns.requester')" />
        <Column :header="$t('approvals.columns.baseTotal')"><template #body="{ data }">{{ data.baseTotalAmount != null ? fmtBase(data.baseTotalAmount) : '—' }}</template></Column>
        <Column field="currentStepNo" :header="$t('approvals.columns.step')" />
        <Column :header="$t('approvals.columns.submitted')"><template #body="{ data }">{{ formatDate(data.submittedAt) }}</template></Column>
        <Column :header="$t('approvals.columns.sla')">
          <template #body="{ data }">
            <Tag v-if="data.overdue" severity="danger" :value="$t('approvals.overdue')" />
            <span v-else-if="data.slaDueAt" class="text-muted-color text-sm">{{ formatDate(data.slaDueAt) }}</span>
            <span v-else class="text-muted-color text-sm">—</span>
          </template>
        </Column>
        <Column :header="$t('common.actions')" style="width: 7rem">
          <template #body="{ data }">
            <Button
              :label="$t('documents.detail.approve')"
              icon="pi pi-check-circle"
              size="small"
              severity="success"
              outlined
              @click.stop="openReview(data)"
            />
          </template>
        </Column>
        <template #empty>
          <EmptyState icon="pi pi-check-circle" :title="$t('approvals.empty')" />
        </template>
      </AppDataTable>
    </div>

    <!-- Approve-from-inbox modal: submitted reason/details + total amount, with approve /
         reject / return, without leaving the inbox. -->
    <ReviewApprovalDialog
      v-model:visible="reviewOpen"
      :doc-id="reviewDoc.id"
      :doc-no="reviewDoc.docNo"
      @acted="approvals.loadPending()"
    />
  </div>
</template>
