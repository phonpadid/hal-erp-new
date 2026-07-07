<script setup lang="ts">
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Tag from 'primevue/tag';
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import TableSkeleton from '@/components/TableSkeleton.vue';
import { formatDate } from '@/utils/date';
import { useJournalStore } from '../stores/journal';
import type { JournalEntry } from '../api/journal';

const store = useJournalStore();
const router = useRouter();
const expanded = ref<Record<string, boolean> | JournalEntry[]>([]);

// Server-side paging: DataTable emits 0-based page + rows; the store fetches 1-based.
function onPage(e: { page: number; rows: number }) {
  store.loadEntries(e.page + 1, e.rows);
}

// Entry total (base currency) = Σ debit — equals Σ credit for a balanced entry. Kept as a
// decimal string (money rule) via reduce over string addition on the minor unit.
function entryTotal(entry: JournalEntry): string {
  const cents = entry.lines.reduce((sum, l) => sum + Math.round(Number(l.debit) * 100), 0);
  return (cents / 100).toFixed(2);
}

onMounted(() => store.loadEntries());
</script>

<template>
  <div>
    <PageHeader :title="$t('gl.journal.title')" />

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
  </div>
</template>
