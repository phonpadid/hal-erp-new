<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Tag from 'primevue/tag';
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import PageHeader from '@/components/PageHeader.vue';
import { formatDate } from '@/utils/date';
import { useFeedback } from '../../composables/useFeedback';
import { useAuthStore } from '../../stores/auth';
import { useJournalStore } from '../../stores/journal';
import type { UndeliveredPosting } from '../../api/journal';

/**
 * What the ledger owes itself and has not delivered.
 *
 * This is the screen a blocked period close points at: the close is refused while anything here is
 * outstanding, and until this existed the refusal named an obstacle nobody could clear.
 */
const { t } = useI18n();
const fb = useFeedback();
const auth = useAuthStore();
const store = useJournalStore();

/**
 * Mirrors `MAX_ATTEMPTS` in `back/src/modules/gl/gl-posting-sweeper.service.ts`. Duplicated because
 * no endpoint reports the sweeper's bound; an attempt count without it is a number with no scale.
 */
const MAX_ATTEMPTS = 5;

const canRetry = computed(() => auth.can('GL_POST_RETRY'));

/**
 * Only a FAILED posting can be re-queued — the server refuses every other status, and PENDING is
 * queued rather than stalled. A control on a PENDING row could only fail.
 */
const canRequeue = (row: UndeliveredPosting) => canRetry.value && row.status === 'FAILED';

function onPage(e: { page: number; rows: number }) {
  store.loadUndelivered(e.page + 1, e.rows);
}

async function requeue(row: UndeliveredPosting) {
  const ok = await store.requeue(row.id);
  if (ok) fb.success(t('gl.undelivered.requeued'));
  else fb.error(store.error);
}

onMounted(() => store.loadUndelivered());
</script>

<template>
  <div>
    <PageHeader :title="$t('gl.undelivered.title')" :subtitle="$t('gl.undelivered.subtitle')" />

    <ErrorState v-if="store.error && !store.undelivered.length" :message="store.error" @retry="store.loadUndelivered()" />

    <div v-else class="card">
      <DataTable
        :value="store.undelivered"
        dataKey="id"
        class="text-sm"
        lazy
        paginator
        :rows="store.undeliveredLimit"
        :totalRecords="store.undeliveredTotal"
        :first="(store.undeliveredPage - 1) * store.undeliveredLimit"
        :loading="store.loading"
        @page="onPage"
      >
        <Column :header="$t('gl.undelivered.columns.source')">
          <template #body="{ data }">
            <div class="flex items-center gap-2">
              <Tag :value="data.sourceType" severity="secondary" />
              <span v-if="data.sourceDocNo" class="font-medium">{{ data.sourceDocNo }}</span>
            </div>
          </template>
        </Column>
        <Column :header="$t('gl.undelivered.columns.status')">
          <template #body="{ data }">
            <Tag
              :value="$t(`gl.undelivered.status.${data.status}`)"
              :severity="data.status === 'FAILED' ? 'danger' : 'warn'"
            />
          </template>
        </Column>
        <Column :header="$t('gl.undelivered.columns.attempts')">
          <!-- Against the bound that stopped it: `3` alone does not say "this gave up". -->
          <template #body="{ data }">
            <span class="tabular-nums" data-testid="attempts">{{ data.attempts }} / {{ MAX_ATTEMPTS }}</span>
          </template>
        </Column>
        <Column :header="$t('gl.undelivered.columns.lastAttempt')">
          <template #body="{ data }">{{ data.lastAttemptAt ? formatDate(data.lastAttemptAt) : '—' }}</template>
        </Column>
        <Column :header="$t('gl.undelivered.columns.lastError')">
          <template #body="{ data }">
            <span class="text-muted-color">{{ data.lastError ?? '—' }}</span>
          </template>
        </Column>
        <Column>
          <template #body="{ data }">
            <div class="flex justify-end">
              <Button
                v-if="canRequeue(data)"
                :label="$t('gl.undelivered.requeue')"
                size="small"
                :loading="store.working"
                data-testid="requeue"
                @click="requeue(data)"
              />
            </div>
          </template>
        </Column>
        <template #empty>
          <EmptyState icon="pi pi-check-circle" :title="$t('gl.undelivered.empty')" />
        </template>
      </DataTable>
    </div>
  </div>
</template>
