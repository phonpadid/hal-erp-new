<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import DatePicker from 'primevue/datepicker';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Tag from 'primevue/tag';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import TableSkeleton from '@/components/TableSkeleton.vue';
import { formatDate } from '@/utils/date';
import { useCurrencyFormat } from '../composables/useCurrencyFormat';
import { useFeedback } from '../composables/useFeedback';
import { useAuthStore } from '../stores/auth';
import { useJournalStore } from '../stores/journal';
import { sumAmounts } from '../utils/money';
import type { JournalEntry } from '../api/journal';

const { t } = useI18n();
const { fmtBase } = useCurrencyFormat();
const fb = useFeedback();
const auth = useAuthStore();
const store = useJournalStore();
const router = useRouter();
const expanded = ref<Record<string, boolean> | JournalEntry[]>([]);

/**
 * Posting a voucher and reversing an entry share one code: a reversal is a voucher whose lines were
 * computed for you, and splitting them would imply a difference in privilege that is not there.
 */
const canPost = computed(() => auth.can('GL_JV_POST'));

const reverseDialog = ref<{ open: boolean; entry: JournalEntry | null; entryDate: Date | null; memo: string }>({
  open: false,
  entry: null,
  entryDate: null,
  memo: '',
});

// Server-side paging: DataTable emits 0-based page + rows; the store fetches 1-based.
function onPage(e: { page: number; rows: number }) {
  store.loadEntries(e.page + 1, e.rows);
}

// Entry total (base currency) = Σ debit — equals Σ credit for a balanced entry. Summed as decimal
// strings through `sumAmounts`; money never goes through a JS number. `sumAmounts` returns a bare
// decimal ('100000' for 100000.00), so the display goes through `fmtBase` — which also uses the
// base currency's own decimal_places rather than assuming two.
function entryTotal(entry: JournalEntry): string {
  return fmtBase(sumAmounts(entry.lines.map((l) => l.debit)));
}

function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function openReverse(entry: JournalEntry) {
  // Date left empty: empty MEANS today, which is the default the dialog explains.
  reverseDialog.value = { open: true, entry, entryDate: null, memo: '' };
}

async function confirmReverse() {
  const { entry, entryDate, memo } = reverseDialog.value;
  if (!entry) return;
  const ok = await store.reverse(entry.id, {
    entryDate: entryDate ? toIsoDate(entryDate) : undefined,
    memo: memo.trim() || undefined,
  });
  if (ok) {
    reverseDialog.value = { open: false, entry: null, entryDate: null, memo: '' };
    fb.success(t('gl.reversal.done'));
  } else {
    // "Already reversed" names the reversing entry. Left on screen with the dialog open.
    fb.error(store.error);
  }
}

onMounted(() => store.loadEntries());
</script>

<template>
  <div>
    <PageHeader :title="$t('gl.journal.title')">
      <template #actions>
        <Button
          v-if="canPost"
          :label="$t('gl.voucher.title')"
          icon="pi pi-plus"
          data-testid="new-voucher"
          @click="router.push({ name: 'journal-voucher' })"
        />
      </template>
    </PageHeader>

    <ErrorState v-if="store.error" :message="store.error" @retry="store.loadEntries()" />

    <div v-else class="card">
      <TableSkeleton v-if="store.loading && !store.entries.length" :columns="5" />
      <DataTable
        v-else
        v-model:expandedRows="expanded"
        :value="store.entries"
        dataKey="id"
        class="text-sm"
        lazy
        paginator
        :rows="store.limit"
        :totalRecords="store.total"
        :first="(store.page - 1) * store.limit"
        :loading="store.loading"
        @page="onPage"
      >
        <Column expander headerStyle="width:3rem" />
        <Column :header="$t('gl.journal.columns.date')"><template #body="{ data }">{{ formatDate(data.entryDate) }}</template></Column>
        <Column :header="$t('gl.journal.columns.source')">
          <template #body="{ data }">
            <div class="flex items-center gap-2">
              <Tag :value="data.sourceType" severity="secondary" />
              <a
                v-if="data.sourceDocNo"
                class="cursor-pointer text-primary"
                @click="router.push({ name: 'document-detail', params: { id: data.sourceId } })"
              >{{ data.sourceDocNo }}</a>
            </div>
          </template>
        </Column>
        <Column field="memo" :header="$t('gl.journal.columns.memo')" />
        <Column :header="$t('gl.journal.columns.total')" headerStyle="text-align:right">
          <template #body="{ data }"><span class="tabular-nums">{{ entryTotal(data) }}</span></template>
        </Column>
        <Column>
          <template #body="{ data }">
            <!--
              Offered on EVERY row, not only on manual vouchers: a wrong automatic posting is the
              likelier thing to correct, and corrections are reversing entries rather than edits.
            -->
            <div class="flex justify-end">
              <Button
                v-if="canPost"
                :label="$t('gl.reversal.action')"
                size="small"
                severity="warn"
                text
                data-testid="reverse-entry"
                @click="openReverse(data)"
              />
            </div>
          </template>
        </Column>

        <template #expansion="{ data }">
          <div class="p-3">
            <DataTable :value="data.lines" dataKey="id" class="text-sm">
              <Column :header="$t('gl.journal.columns.account')">
                <template #body="{ data: line }">
                  <span class="font-medium">{{ line.account?.code }}</span>
                  <span class="text-muted-color"> — {{ line.account?.name }}</span>
                </template>
              </Column>
              <Column :header="$t('gl.journal.columns.debit')" headerStyle="text-align:right">
                <template #body="{ data: line }">
                  <span class="tabular-nums text-green-600 dark:text-green-400">{{ Number(line.debit) ? line.debit : '' }}</span>
                </template>
              </Column>
              <Column :header="$t('gl.journal.columns.credit')" headerStyle="text-align:right">
                <template #body="{ data: line }">
                  <span class="tabular-nums text-red-600 dark:text-red-400">{{ Number(line.credit) ? line.credit : '' }}</span>
                </template>
              </Column>
            </DataTable>
          </div>
        </template>

        <template #empty>
          <EmptyState icon="pi pi-book" :title="$t('gl.journal.empty')" />
        </template>
      </DataTable>
    </div>

    <!-- Reversing: two inputs, and two facts that surprise people -->
    <Dialog
      v-model:visible="reverseDialog.open"
      modal
      :header="$t('gl.reversal.title')"
      class="w-full max-w-md"
    >
      <div class="flex flex-col gap-3">
        <Message severity="info" size="small" variant="simple" data-testid="reversal-notes">
          {{ $t('gl.reversal.datedToday') }} {{ $t('gl.reversal.onceOnly') }}
        </Message>
        <label class="flex flex-col gap-1 text-sm text-muted-color">
          {{ $t('gl.reversal.fields.entryDate') }}
          <DatePicker v-model="reverseDialog.entryDate" dateFormat="yy-mm-dd" showIcon showClear />
        </label>
        <label class="flex flex-col gap-1 text-sm text-muted-color">
          {{ $t('gl.reversal.fields.memo') }}
          <InputText v-model="reverseDialog.memo" />
        </label>
      </div>
      <template #footer>
        <Button :label="$t('common.cancel')" text @click="reverseDialog.open = false" />
        <Button
          :label="$t('gl.reversal.action')"
          severity="warn"
          :loading="store.working"
          data-testid="confirm-reverse"
          @click="confirmReverse"
        />
      </template>
    </Dialog>
  </div>
</template>
