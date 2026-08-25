<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import Column from 'primevue/column';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import ToggleButton from 'primevue/togglebutton';
import TreeTable from 'primevue/treetable';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useReportsStore } from '../../stores/reports';
import { useCurrencyFormat } from '../../composables/useCurrencyFormat';
import ReportCard from '@/components/reports/ReportCard.vue';
import StatTiles, { type StatTile } from '@/components/reports/StatTiles.vue';
import ErrorState from '@/components/ErrorState.vue';
import EmptyState from '@/components/EmptyState.vue';
import type { BudgetQuarterDepartment, QuarterFigure } from '../../api/reports';

/**
 * Budget consumption by quarter, department first with the budgets beneath.
 *
 * Two rules from the design carry the whole screen. A quarter that has not ended is marked with how
 * much of it has passed, and is compared against the SAME window of the quarter before it — whole
 * comparison reads as a collapse that is only the calendar not having caught up. And a comparison
 * with nothing on one side is written in words: `−100%` on a line that pays an annual licence is
 * correct and useless, and a blank cell reads as "still loading".
 */
const reports = useReportsStore();
const { fmtBase } = useCurrencyFormat();
const { t } = useI18n();

onMounted(() => reports.loadBudgetByQuarter());

const report = computed(() => reports.quarters);

/**
 * The two server-side filters. `web-dashboards` requires that applying one RE-RUNS the report, so
 * these are round-trips, not a narrowing of what is on screen.
 */
const chosenYearId = ref<string | null>(null);
const chosenDeptId = ref<string | null>(null);

// The year actually being reported, so the control opens on it rather than on a placeholder.
watch(
  () => report.value?.fiscalYearId,
  (id) => {
    if (id && !chosenYearId.value) chosenYearId.value = id;
  },
  // Immediate: the response may already be in the store when this screen mounts — returning to it
  // with state cached would otherwise leave the control on a placeholder while a year is reported.
  { immediate: true },
);

function reload() {
  reports.loadBudgetByQuarter({
    ...(chosenYearId.value ? { fiscalYearId: chosenYearId.value } : {}),
    ...(chosenDeptId.value ? { departmentId: chosenDeptId.value } : {}),
  });
}

/**
 * A department belongs to a fiscal year's budgets and may hold none in the year now chosen, so
 * carrying the selection across would filter the new year down to nothing and read as "no data".
 */
function onYearChange() {
  chosenDeptId.value = null;
  reload();
}

/** Both option lists come from the response, which carries them WHOLE whatever the filters are. */
const yearOptions = computed(() =>
  (report.value?.fiscalYears ?? []).map((y) => ({ label: String(y.year), value: y.id })),
);
const deptOptions = computed(() =>
  (report.value?.departmentOptions ?? []).map((d) => ({ label: d.name, value: d.id })),
);

/**
 * The two in-page narrowings. NOT round-trips: the response already answers both, and re-running
 * the read to derive them would be slower and would open a window where the tiles and the table
 * disagree.
 */
const search = ref('');
const overspentOnly = ref(false);
const matches = (haystack: string, needle: string) =>
  haystack.toLowerCase().includes(needle.toLowerCase());

/**
 * The rows actually shown.
 *
 * A department is kept when any line beneath it matches — a search for `1.101` that dropped the
 * department would drop the very row it was meant to find. A department whose OWN name matches
 * keeps every line beneath it.
 */
const shown = computed<BudgetQuarterDepartment[]>(() => {
  const q = search.value.trim();
  const all = report.value?.departments ?? [];
  // Nothing narrowing means the response, untouched. Running the filter anyway dropped every
  // department that happened to carry no lines — a row the reader never asked to lose.
  if (q === '' && !overspentOnly.value) return all;

  return all
    .map((d) => {
      const deptMatches = q === '' || matches(d.departmentName, q);
      const budgets = d.budgets.filter((b) => {
        if (overspentOnly.value && !b.overspent) return false;
        // A department whose own name matches keeps every line beneath it.
        return deptMatches || matches(b.code, q) || matches(b.budgetName, q);
      });
      return { ...d, budgets };
    })
    .filter((d) => {
      // A department is kept when a line beneath it survived — a search for `1.101` that dropped
      // the department would drop the very row it was meant to find.
      if (d.budgets.length) return true;
      // With no lines left it is kept only when it is itself the answer.
      if (!(q === '' || matches(d.departmentName, q))) return false;
      return !overspentOnly.value || d.overspent;
    });
});

const hasData = computed(() => (report.value?.departments.length ?? 0) > 0);
const hasShown = computed(() => shown.value.length > 0);

/** Departments as parents, their budgets as children. */
const nodes = computed(() =>
  shown.value.map((d) => ({
    key: d.departmentId,
    data: {
      name: d.departmentName,
      amountTotal: d.amountTotal,
      quarters: d.quarters,
      yearConsumed: d.yearConsumed,
      remaining: d.remaining,
      pct: d.yearUtilizationPct,
      remainingPct: d.remainingPct,
      overspent: d.overspent,
      // A department can read healthy while a line beneath it has overspent — that is exactly how
      // the customer's own spreadsheet hides 31.6 billion kip: every department it rolls up into
      // still shows a positive remaining. The department carries the warning so nobody has to
      // expand twenty rows to find out.
      overspentBelow: d.budgets.some((b) => b.overspent),
      isDepartment: true,
    },
    children: d.budgets.map((b) => ({
      key: b.budgetId,
      data: {
        name: `${b.code} · ${b.budgetName}`,
        amountTotal: b.amountTotal,
        quarters: b.quarters,
        yearConsumed: b.yearConsumed,
        remaining: b.remaining,
        pct: b.yearUtilizationPct,
        remainingPct: b.remainingPct,
        overspent: b.overspent,
        overspentBelow: false,
        isDepartment: false,
      },
    })),
  })),
);

const tiles = computed<StatTile[]>(() => {
  // The rows actually shown, never the whole response: a total that counts rows the table is not
  // displaying contradicts the table directly beneath it.
  const d = shown.value;
  const year = d.reduce((s, x) => s + Number(x.yearConsumed), 0);
  const over = d.filter((x) => x.overspent).length;
  const open = d[0]?.quarters.find((q) => !q.complete);
  return [
    { label: t('reports.budgetQuarter.kpiYear'), value: fmtBase(String(year)), icon: 'pi-dollar', tone: 'info' },
    {
      label: t('reports.budgetQuarter.kpiOpenQuarter'),
      value: open ? `Q${open.quarter} — ${open.elapsedDays}/${open.days}` : '—',
      icon: 'pi-hourglass',
      tone: 'primary',
    },
    { label: t('reports.budgetQuarter.kpiOverspent'), value: over, icon: 'pi-exclamation-triangle', tone: over ? 'danger' : 'success' },
  ];
});

/** The change cell: a percentage when there is one, and words when there is not. */
const changeLabel = (q: QuarterFigure): string => {
  if (q.noComparison === 'NOT_STARTED') return t('reports.budgetQuarter.notStarted');
  if (q.noComparison === 'NO_EARLIER_QUARTER') return t('reports.budgetQuarter.noEarlier');
  if (q.noComparison === 'STARTED') return t('reports.budgetQuarter.started');
  if (q.noComparison === 'STOPPED') return t('reports.budgetQuarter.stopped');
  if (q.noComparison === 'NO_ACTIVITY') return t('reports.budgetQuarter.noActivity');
  const pct = q.changePct ?? 0;
  return `${pct > 0 ? '+' : ''}${pct}%`;
};
const changeTone = (q: QuarterFigure): string =>
  q.noComparison ? 'text-muted-color' : (q.changePct ?? 0) > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400';

/**
 * Which quarters have their months open. Per quarter, not one switch for all four: twelve monthly
 * columns beside the quarter, share and year columns is a table nobody reads, and the question the
 * budget department actually asks is "which month of Q2".
 */
const openMonths = ref<Set<number>>(new Set());
const monthsOpen = (quarter: number): boolean => openMonths.value.has(quarter);
const toggleMonths = (quarter: number): void => {
  const next = new Set(openMonths.value);
  if (!next.delete(quarter)) next.add(quarter);
  openMonths.value = next;
};

/**
 * The classes every money and percentage column carries.
 *
 * The header alignment has to reach INSIDE the `th`: PrimeVue renders the label in a flex child,
 * `.p-treetable-column-header-content`, and the `th` itself is a `table-cell`, where
 * `justify-content` does nothing at all. Aligning the `th` looked right in the markup and left
 * every header hugging the left edge above right-aligned figures.
 */
const NUM_HEADER = '[&_.p-treetable-column-header-content]:justify-end whitespace-nowrap';
/**
 * Figures never wrap, and they sit against the right edge of the cell.
 *
 * The alignment has to reach inside the `td` for the same reason the header does: PrimeVue wraps
 * every body cell in `.p-treetable-body-cell-content`, a ROW flex container. Whatever the cell
 * renders becomes a flex item, which shrinks to its content and parks at the start — so
 * `text-align: right` on the `td` moved nothing, and the figures sat up to 106px short of the edge
 * while reporting `text-align: right` to anyone who only asked the computed style.
 */
const NUM_BODY =
  'text-right! tabular-nums whitespace-nowrap [&_.p-treetable-body-cell-content]:justify-end';

/** A share, or nothing. Never `0%`, which is what every reader takes for untouched. */
const pctLabel = (pct: number | null): string => (pct === null ? '—' : `${pct}%`);
</script>

<template>
  <div class="flex flex-col gap-4">
    <PageHeader :title="$t('reports.tabs.budgetQuarter')" :subtitle="report ? $t('reports.budgetQuarter.asOf', { date: report.asOf, year: report.year }) : undefined">
      <template #actions>
        <!-- Both re-run the read on the server; their options come from the response, which
             carries them whole however the filters narrow the rows. -->
        <Select
          v-model="chosenYearId"
          :options="yearOptions"
          optionLabel="label"
          optionValue="value"
          :placeholder="$t('reports.budgetQuarter.fiscalYear')"
          class="w-32"
          data-testid="year-filter"
          @change="onYearChange"
        />
        <Select
          v-model="chosenDeptId"
          :options="deptOptions"
          optionLabel="label"
          optionValue="value"
          :placeholder="$t('reports.budgetQuarter.allDepartments')"
          showClear
          class="w-56"
          data-testid="dept-filter"
          @change="reload"
        />
        <!-- These two narrow what is already loaded. No request: the response answers both. -->
        <IconField>
          <InputIcon class="pi pi-search" />
          <InputText
            v-model="search"
            :placeholder="$t('reports.budgetQuarter.search')"
            class="w-56"
            data-testid="search"
          />
        </IconField>
        <ToggleButton
          v-model="overspentOnly"
          :onLabel="$t('reports.budgetQuarter.overspentOnly')"
          :offLabel="$t('reports.budgetQuarter.overspentOnly')"
          onIcon="pi pi-exclamation-triangle"
          offIcon="pi pi-exclamation-triangle"
          data-testid="overspent-only"
        />
      </template>
    </PageHeader>
    <ErrorState v-if="reports.error" :message="reports.error" @retry="reload()" />

    <StatTiles :tiles="tiles" :loading="reports.loading" />

    <!-- Two emptinesses, said apart: a fiscal year holding no budgets sends the reader to the year
         picker, a narrowing that matched nothing sends them to the control they just used. -->
    <EmptyState v-if="!reports.loading && !hasData" icon="pi pi-calendar" :title="$t('reports.budgetQuarter.empty')" />
    <EmptyState
      v-else-if="!reports.loading && !hasShown"
      icon="pi pi-filter-slash"
      :title="$t('reports.budgetQuarter.noMatch')"
      data-testid="no-match"
    />
    <ReportCard v-else :title="$t('reports.budgetQuarter.title')">
      <!-- Scrollable so the department column can be frozen: PrimeVue only honours `frozen` on a
           scrollable table. The row is wide by design — four quarters, their months on demand and
           four year columns — and a figure whose row you can no longer name is not a figure. -->
      <TreeTable
        :value="nodes"
        :loading="reports.loading"
        scrollable
        scrollHeight="500px"
        showGridlines
        class="text-sm"
        data-testid="quarter-tree"
      >
        <Column
          field="name"
          :header="$t('reports.budgetQuarter.department')"
          expander
          frozen
          class="bg-surface-0! dark:bg-surface-900!"
          headerClass="whitespace-nowrap"
          style="min-width: 18rem; max-width: 18rem"
        >
          <!-- One line, cut with an ellipsis rather than wrapped. A wrapped name makes its row
               twice as tall as its neighbours, and the figures beside it stop lining up across the
               table. The whole name stays reachable on hover. -->
          <template #body="{ node }">
            <span
              class="block truncate"
              :class="node.data.isDepartment ? 'font-semibold' : ''"
              :title="node.data.name"
              >{{ node.data.name }}</span
            >
          </template>
        </Column>
        <!-- The warnings, in a column of their own. Sharing the name column made a long Lao label
             wrap the name it sat beside, so the one column a reader uses to find their row was the
             one the tag pushed around. -->
        <Column
          :header="$t('reports.budgetQuarter.status')"
          bodyClass="whitespace-nowrap"
          headerClass="whitespace-nowrap"
          style="min-width: 12rem"
        >
          <template #body="{ node }">
            <!-- A budget of nothing that has been spent against. Said in words: a bar at 0% is what
                 this looked like before, and 0% reads as untouched. -->
            <Tag v-if="node.data.overspent && node.data.pct === null" severity="danger" data-testid="no-budget">
              {{ $t('reports.budgetQuarter.noBudget') }}
            </Tag>
            <Tag v-else-if="node.data.overspentBelow" severity="warn" data-testid="overspent-below">
              {{ $t('reports.budgetQuarter.overspentBelow') }}
            </Tag>
            <!-- A row with nothing to warn about says so, rather than leaving a cell that reads as
                 "still loading". -->
            <span v-else class="text-muted-color" data-testid="status-none">—</span>
          </template>
        </Column>
        <Column :header="$t('reports.budgetQuarter.annual')" :bodyClass="NUM_BODY" :headerClass="NUM_HEADER">
          <template #body="{ node }">{{ fmtBase(node.data.amountTotal) }}</template>
        </Column>
        <!-- Each quarter: its three months when they are asked for, then the quarter itself —
             the order the customer's own sheet puts them in. -->
        <template v-for="i in 4" :key="i">
          <Column
            v-for="mi in monthsOpen(i) ? 3 : 0"
            :key="`q${i}m${mi}`"
            :header="$t('reports.budgetQuarter.month', { month: (i - 1) * 3 + mi })"
            :bodyClass="NUM_BODY"
            :headerClass="NUM_HEADER"
            style="min-width: 8rem"
          >
            <!-- An amount and nothing else. Every question about direction is answered by the
                 quarter that contains it; a monthly comparison would label far more than it says. -->
            <template #body="{ node }">
              <span :data-testid="`q${i}-m${mi}`" class="text-muted-color">
                {{ fmtBase(node.data.quarters[i - 1].months[mi - 1].consumed) }}
              </span>
            </template>
          </Column>
          <Column :bodyClass="NUM_BODY" :headerClass="NUM_HEADER" style="min-width: 11rem">
            <template #header>
              <span class="flex items-center gap-1">
                {{ `Q${i}` }}
                <button
                  type="button"
                  class="pi text-xs text-muted-color hover:text-color cursor-pointer"
                  :class="monthsOpen(i) ? 'pi-chevron-left' : 'pi-chevron-right'"
                  :title="$t(monthsOpen(i) ? 'reports.budgetQuarter.hideMonths' : 'reports.budgetQuarter.showMonths', { quarter: i })"
                  :aria-label="$t(monthsOpen(i) ? 'reports.budgetQuarter.hideMonths' : 'reports.budgetQuarter.showMonths', { quarter: i })"
                  :aria-expanded="monthsOpen(i)"
                  :data-testid="`q${i}-months-toggle`"
                  @click="toggleMonths(i)"
                />
              </span>
            </template>
            <template #body="{ node }">
              <div class="flex flex-col items-end whitespace-nowrap" :data-testid="`q${i}`">
                <span>{{ fmtBase(node.data.quarters[i - 1].consumed) }}</span>
                <span class="text-xs" :class="changeTone(node.data.quarters[i - 1])">
                  {{ changeLabel(node.data.quarters[i - 1]) }}
                </span>
                <!-- The quarter's share of the ANNUAL budget. `—` where there is no budget to take
                     a share of: `0%` is what every reader takes for untouched. -->
                <span class="text-xs text-muted-color" :data-testid="`q${i}-pct`">
                  {{ pctLabel(node.data.quarters[i - 1].utilizationPct) }}
                </span>
                <!-- An unfinished quarter is never presented as a whole one. -->
                <span
                  v-if="!node.data.quarters[i - 1].complete && node.data.quarters[i - 1].elapsedDays > 0"
                  class="text-xs text-muted-color"
                  :data-testid="`q${i}-partial`"
                >
                  {{ $t('reports.budgetQuarter.elapsed', { elapsed: node.data.quarters[i - 1].elapsedDays, days: node.data.quarters[i - 1].days }) }}
                </span>
              </div>
            </template>
          </Column>
        </template>
        <Column :header="$t('reports.budgetQuarter.yearConsumed')" :bodyClass="NUM_BODY" :headerClass="NUM_HEADER">
          <template #body="{ node }">
            <span data-testid="year-consumed">{{ fmtBase(node.data.yearConsumed) }}</span>
          </template>
        </Column>
        <Column :header="$t('reports.budgetQuarter.remaining')" :bodyClass="NUM_BODY" :headerClass="NUM_HEADER">
          <!-- Left negative when overspent, and coloured for it. Flooring it at zero is how the
               customer's own sheet shows every department with something still left. -->
          <template #body="{ node }">
            <span
              data-testid="remaining"
              :class="Number(node.data.remaining) < 0 ? 'text-red-600 dark:text-red-400' : ''"
            >
              {{ fmtBase(node.data.remaining) }}
            </span>
          </template>
        </Column>
        <Column :header="$t('reports.budgetQuarter.yearPct')" :bodyClass="NUM_BODY" :headerClass="NUM_HEADER">
          <template #body="{ node }">
            <span data-testid="year-pct" class="text-muted-color">{{ pctLabel(node.data.pct) }}</span>
          </template>
        </Column>
        <Column :header="$t('reports.budgetQuarter.remainingPct')" :bodyClass="NUM_BODY" :headerClass="NUM_HEADER">
          <template #body="{ node }">
            <span data-testid="remaining-pct" class="text-muted-color">
              {{ pctLabel(node.data.remainingPct) }}
            </span>
          </template>
        </Column>
      </TreeTable>
    </ReportCard>
  </div>
</template>
