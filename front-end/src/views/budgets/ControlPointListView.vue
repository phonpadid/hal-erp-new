<script setup lang="ts">
/**
 * The control points that decide whether spending is allowed.
 *
 * A control point has no `budget` row of its own — a parent is a rollup, not an envelope — so
 * without this screen the only way to see a category's remaining ceiling is to open one of the
 * budgets beneath it and read the panel there.
 */
import Button from 'primevue/button';
import Column from 'primevue/column';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import PageToolbar from '@/components/PageToolbar.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import AppDataTable from '@/components/AppDataTable.vue';
import { useBudgetsStore } from '../../stores/budgets';
import { formatAmount } from '../../utils/money';

const { t } = useI18n();
const router = useRouter();
const budgets = useBudgetsStore();

/**
 * Everything narrowing this list, applied on the CLIENT — correctly, because the client holds
 * every row.
 *
 * `BudgetControlPointService.list` does not page: it returns every point, because each row's
 * ceiling/used/available is resolved for the whole set in a fixed number of queries and paging
 * would put that N+1 back. So filtering here IS filtering the whole set, which is what
 * `web-ui-quality` asks — the budget list filters on the server for the mirror-image reason.
 *
 * All three narrowings live in one computed rather than leaving the term to PrimeVue's own
 * `filters`, so the count below can state what ALL of them are hiding rather than two of three.
 */
const term = ref('');
const departmentNodeId = ref<string | null>(null);
const active = ref<boolean | null>(null);

const narrowed = computed(() => {
  const q = term.value.trim().toLowerCase();
  return budgets.controlPointList.filter((row) => {
    if (departmentNodeId.value && row.departmentNodeId !== departmentNodeId.value) return false;
    if (active.value !== null && row.isActive !== active.value) return false;
    if (!q) return true;
    // The same four fields the dead `globalFilterFields` binding named — what a reader reads on
    // the row, not every field the row happens to carry.
    return [row.budgetNodeCode, row.budgetNodeName, row.departmentNodeCode, row.departmentNodeName]
      .some((v) => (v ?? '').toLowerCase().includes(q));
  });
});

const narrowing = computed(() => Boolean(term.value || departmentNodeId.value || active.value !== null));

/** The department nodes present, derived from the loaded rows — the client holds them all. */
const departmentOptions = computed(() => {
  const byId = new Map<string, { label: string; value: string }>();
  for (const row of budgets.controlPointList) {
    if (!byId.has(row.departmentNodeId)) {
      byId.set(row.departmentNodeId, {
        label: `${row.departmentNodeCode} — ${row.departmentNodeName}`,
        value: row.departmentNodeId,
      });
    }
  }
  return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
});

const statusOptions = computed(() => [
  { label: t('budgets.status.ACTIVE'), value: true },
  { label: t('budgets.status.INACTIVE'), value: false },
]);

/** Shown only while something is narrowing: a count beside a whole list is noise. */
const showingOf = computed(() =>
  narrowing.value
    ? t('budgets.list.showingOf', {
        shown: narrowed.value.length,
        total: budgets.controlPointList.length,
      })
    : '',
);

function clearNarrowing() {
  term.value = '';
  departmentNodeId.value = null;
  active.value = null;
}

// The company base currency, taken from any loaded budget — control points carry no currency of
// their own because they hold no money of their own.
const decimals = computed<number>(
  () => budgets.list[0]?.fiscalYear?.company?.baseCurrency?.decimalPlaces ?? 2,
);

/** A ladder as a compact string: "90% warn · 100% block". */
const ladderOf = (row: { tolerance: { at: number; action: string }[] }) =>
  [...row.tolerance]
    .sort((a, b) => a.at - b.at)
    .map((r) => `${r.at}% ${r.action.toLowerCase()}`)
    .join(' · ');

onMounted(async () => {
  // The budget list comes along for the currency; the control points are the screen.
  // No fiscal year is passed: the server scopes to the year covering today.
  await Promise.all([budgets.loadControlPoints(), budgets.list.length ? Promise.resolve() : budgets.loadList()]);
});
</script>

<template>
  <div>
    <PageHeader :title="$t('budgets.controlPointList.title')" :subtitle="$t('budgets.controlPointList.subtitle')" />

    <PageToolbar :search="term" @update:search="term = $event">
      <template #filters>
        <Select
          :modelValue="departmentNodeId"
          :options="departmentOptions"
          optionLabel="label"
          optionValue="value"
          showClear
          size="small"
          class="w-56"
          :placeholder="$t('budgets.controlPointList.departmentNode')"
          :aria-label="$t('budgets.controlPointList.departmentNode')"
          @update:modelValue="departmentNodeId = $event ?? null"
        />
        <Select
          :modelValue="active"
          :options="statusOptions"
          optionLabel="label"
          optionValue="value"
          showClear
          size="small"
          class="w-40"
          :placeholder="$t('common.status')"
          :aria-label="$t('common.status')"
          @update:modelValue="active = $event ?? null"
        />
        <!-- What the filters are hiding. A filter, unlike a term, can be set and scrolled past. -->
        <span v-if="showingOf" class="text-sm text-muted-color">{{ showingOf }}</span>
      </template>
    </PageToolbar>

    <ErrorState v-if="budgets.error" :message="budgets.error" @retry="budgets.loadControlPoints()" />

    <div v-else class="card">
      <!-- `clientPaged`: every control point is already loaded, so PrimeVue pages and filters the
           rows it was given. `rows` is deliberately left at the component default — this used to
           bind the array's own length, which was how a `lazy` table said "one page, show them
           all". Off `lazy` that means a page of 474, an empty rows-per-page control (no such
           option), and no pager at all. -->
      <AppDataTable
        clientPaged
        :value="narrowed"
        :total="narrowed.length"
        :loading="budgets.controlPointsLoading"
        :page="1"
        :rowHover="true"
        @refresh="budgets.loadControlPoints()"
        @row-click="(e: any) => router.push({ name: 'control-point-detail', params: { id: e.data.id } })"
      >
        <Column field="budgetNodeCode" :header="$t('budgets.controlPointList.budgetNode')">
          <template #body="{ data }">{{ data.budgetNodeCode }} · {{ data.budgetNodeName }}</template>
        </Column>
        <Column field="departmentNodeCode" :header="$t('budgets.controlPointList.departmentNode')">
          <template #body="{ data }">{{ data.departmentNodeCode }} · {{ data.departmentNodeName }}</template>
        </Column>
        <Column :header="$t('budgets.controlPointList.ladder')">
          <template #body="{ data }">{{ ladderOf(data) }}</template>
        </Column>
        <Column :header="$t('budgets.controlPointList.ceiling')">
          <template #body="{ data }">{{ formatAmount(data.ceiling, decimals) }}</template>
        </Column>
        <Column :header="$t('budgets.controlPointList.used')">
          <template #body="{ data }">{{ formatAmount(data.used, decimals) }}</template>
        </Column>
        <Column :header="$t('budgets.controlPointList.available')">
          <template #body="{ data }">{{ formatAmount(data.available, decimals) }}</template>
        </Column>
        <Column :header="$t('budgets.controlPointList.governs')">
          <template #body="{ data }">{{ data.governedBudgetIds.length }}</template>
        </Column>
        <Column :header="$t('common.status')">
          <template #body="{ data }">
            <Tag
              :value="$t('budgets.status.' + (data.isActive ? 'ACTIVE' : 'INACTIVE'))"
              :severity="data.isActive ? 'success' : 'secondary'"
            />
          </template>
        </Column>
        <template #empty>
          <!-- "your filters excluded everything" is a different message from "no control point
               exists" — and here the second one carries a warning worth not raising falsely:
               every active budget must be governed by one. -->
          <EmptyState
            v-if="narrowing"
            icon="pi pi-filter-slash"
            :title="$t('budgets.list.emptyFiltered')"
          >
            <template #action>
              <Button
                :label="$t('budgets.list.clearFilters')"
                icon="pi pi-filter-slash"
                size="small"
                severity="secondary"
                @click="clearNarrowing"
              />
            </template>
          </EmptyState>
          <EmptyState
            v-else
            icon="pi pi-sliders-h"
            :title="$t('budgets.controlPointList.empty')"
            :message="$t('budgets.controlPointList.emptyHint')"
          />
        </template>
      </AppDataTable>
    </div>
  </div>
</template>
