<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import ProgressBar from 'primevue/progressbar';
import SelectButton from 'primevue/selectbutton';
import TreeTable from 'primevue/treetable';
import Tag from 'primevue/tag';
import Select from 'primevue/select';
import { computed, onMounted, ref } from 'vue';
import { BUDGET_STATUSES } from '@erp/shared';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import { useSearchTerm } from '@/composables/useSearchTerm';
import PageToolbar from '@/components/PageToolbar.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import AppDataTable from '@/components/AppDataTable.vue';
import { useBudgetsStore } from '../../stores/budgets';
import { useFeedback } from '../../composables/useFeedback';
import { useLayoutStore } from '@/layouts/store/layout.store';
import type { BudgetSummary } from '../../api/budgets';
import { formatAmount } from '../../utils/money';

const { t } = useI18n();
const router = useRouter();
const budgets = useBudgetsStore();
const fb = useFeedback();

/**
 * Raise a plan for a `DRAFT` budget that no plan carries.
 *
 * Offered from the list as well as from the budget's own page, because the list is where a person
 * notices that a line they proposed never went anywhere. Routes to the plan, which is the thing
 * they then have to submit.
 */
/**
 * Marking a plan node as carrying shared budget.
 *
 * The tooltip states how many budgets the mark would cover before it is made: a mark on a
 * department root shares that whole department's money, a mark on one category shares only that
 * category, and the difference is invisible unless the screen says so.
 */
const markingNodeId = ref('');
async function toggleShared(nodeId: string, isShared: boolean) {
  markingNodeId.value = nodeId;
  try {
    await budgets.setNodeShared(nodeId, isShared);
    fb.success(t(isShared ? 'budgets.plan.markedShared' : 'budgets.plan.unmarkedShared'));
  } catch (e) {
    fb.error(e, t('budgets.plan.markSharedFailed'));
  } finally {
    markingNodeId.value = '';
  }
}

const reproposingId = ref('');
async function repropose(budgetId: string) {
  reproposingId.value = budgetId;
  try {
    const { documentId } = await budgets.reproposeBudget(budgetId);
    fb.success(t('budgets.plan.reproposed'));
    await router.push({ name: 'document-detail', params: { id: documentId } });
  } catch (e) {
    fb.error(e, t('budgets.plan.reproposeFailed'));
  } finally {
    reproposingId.value = '';
  }
}

/**
 * The search term, answered by the SERVER across the whole department's plan.
 *
 * `AppDataTable` runs in `lazy` mode, where PrimeVue delegates filtering to the server and ignores
 * `filters` / `globalFilterFields` — the bindings this replaces. They were decoration, and a
 * client-side filter would have been wrong regardless: the client holds one page, so it would have
 * searched a fraction of the set while looking like it searched all of it.
 */
/**
 * The two dimensions a reader narrows this list by, answered by the SERVER.
 *
 * The table has shown a department column and a status column all along; neither could be used to
 * narrow anything, so readers asked the search box to do it — and a department's name typed into
 * search matches budgets whose own NAME contains it, not budgets belonging to it.
 *
 * Server-side for the same reason the term is: 496 budgets page on the server, so filtering the
 * loaded page would narrow 20 of them while looking like it narrowed all of them.
 */
const departmentOptions = computed(() => [
  ...budgets.filterDepartments.map((d) => ({ label: `${d.deptCode} — ${d.name}`, value: d.id })),
]);

/**
 * Every declared status, not the ones the data happens to hold today.
 *
 * Offering only what is present would make the control's shape depend on the data — CLOSED
 * appearing the day a fiscal year closes, which is exactly when a reader is looking for it and has
 * never seen it before.
 */
const statusOptions = computed(() =>
  BUDGET_STATUSES.map((v) => ({ label: t(`budgets.list.status.${v}`), value: v })),
);

/** Shown only while something is narrowing: a count beside a whole list is noise. */
const showingOf = computed(() =>
  budgets.narrowing
    ? t('budgets.list.showingOf', { shown: budgets.total, total: budgets.totalUnfiltered })
    : '',
);

const { term, onSearch } = useSearchTerm((t) => budgets.narrow({ search: t }));

/** Clear every narrowing, including the search box's own text, which the store cannot reach. */
async function clearNarrowing() {
  term.value = '';
  await budgets.clearNarrowing();
}

// Format money to the budget's company base-currency decimal_places (money rule), not a
// hardcoded 2 — correct for 0-decimal (JPY) and 3-decimal (KWD) currencies.
const decimalsOf = (row: BudgetSummary) => row.fiscalYear?.company?.baseCurrency?.decimalPlaces ?? 2;

/**
 * Rows flattened out of the store's groups, each tagged with the group it belongs to so the table
 * can render a subheader. Ordering follows the groups, which is what DataTable's row grouping
 * requires; the ungoverned bucket sorts last because the store appends it.
 */
const rows = computed(() =>
  budgets.groupedBudgets.flatMap((g) =>
    // `__n` numbers the row within its own group. A count that runs through a heading it is not
    // part of belongs to a flat list; here it counts the rows the heading introduces.
    g.budgets.map((b, i) => ({ ...b, __groupKey: g.key, __group: g, __n: i + 1 })),
  ),
);

// The header's figures come from the control point, which covers the WHOLE governed set — including
// budgets on other pages. Nothing here adds up the visible children.
const groupOf = (row: any) => row.__group;

// Grouped or flat. Grouping helps someone reading a category; it is in the way of someone looking
// for one budget by name. The choice lives in the store so it survives leaving and returning.
const groupOptions = computed(() => [
  { label: t('budgets.list.grouped'), value: 'points' as const },
  // The plan's own shape. It answers a different question from the control-point grouping —
  // "does this match the book we approved?" rather than "what will refuse me first?" — so it is a
  // third mode rather than a replacement for either.
  { label: t('budgets.list.tree'), value: 'tree' as const },
  { label: t('budgets.list.flat'), value: 'flat' as const },
]);

// One currency for the tree: its rows are sums across budgets, so there is no single row to take
// decimals from. The company base currency is what every amount in the list is already in.
const treeDecimals = computed(
  () => budgets.list[0]?.fiscalYear?.company?.baseCurrency?.decimalPlaces ?? 2,
);

/**
 * Columns the table renders: the seven declared below plus the `#` column AppDataTable injects.
 *
 * PrimeVue hardcodes the row-group header cell to `columnsLength - 1`, which leaves the last column
 * with no cell at all — and a browser does not paint a row's background where no cell exists, so
 * the header band stopped short of the table's right edge. Overriding the colspan is the only way
 * to close it. A spec asserts this equals the real column count, so adding a column fails a test
 * instead of quietly going ragged again.
 */
const TOTAL_COLUMNS = 9;

const isOverdrawn = (available?: string) => available !== undefined && Number(available) < 0;

/**
 * How full a group is, as a percentage of its ceiling. Derived for DISPLAY only — the amounts
 * themselves stay strings; this never feeds a decision, the server's ladder does that.
 * A zero ceiling means anything spent is already past it.
 */
function usedPctOf(group: any): number {
  const cp = group.controlPoint;
  if (!cp) return 0;
  const ceiling = Number(cp.ceiling);
  const used = Number(cp.used);
  if (!ceiling) return used > 0 ? 100 : 0;
  return Math.round((used / ceiling) * 1000) / 10;
}

// Same thresholds the utilization report uses, so "amber means nearly full" reads the same
// wherever a user meets it.
/**
 * The value handed to ProgressBar. Floored just above zero because PrimeVue skips the label
 * entirely at `value === 0`, which would blank the figures on a group nothing has been spent from.
 * The true percentage is what the text and `aria-valuenow` report.
 */
const fillValue = (group: any) => Math.max(Math.min(usedPctOf(group), 100), 0.0001);

// Same thresholds the utilization report uses, so "amber means nearly full" reads the same
// wherever a user meets it.
const utilColor = (pct: number) => (pct > 100 ? 'red' : pct >= 80 ? 'yellow' : 'green');

// The app's own definition of the theme — `layoutConfig.darkTheme` is what toggles the `.dark`
// class PrimeVue's darkModeSelector watches. Reading the store rather than the DOM class keeps
// this reactive and cannot disagree with an explicit user toggle, which a media query could.
const { layoutConfig } = useLayoutStore();

/**
 * How strongly the utilisation fill is mixed into the row.
 *
 * One value cannot serve both themes. The fill hues are light colours: at 22% they separate
 * clearly from a dark row (measured `rgb(30, 41, 59)`) and blend into a light one (measured
 * `rgb(241, 245, 249)`), where the fill ends up barely distinguishable from its own track. Only
 * the strength changes — the hue still comes from `utilColor` and the colour is still mixed from
 * a token, so there is no second palette and nothing hardcoded.
 */
const fillMixPercent = computed(() => (layoutConfig.darkTheme ? 22 : 45));

const fillColor = (pct: number) =>
  `color-mix(in srgb, var(--p-${utilColor(pct)}-500) ${fillMixPercent.value}%, transparent)`;

onMounted(async () => {
  // Both halves of the list, and the department options for its filter — once, here, rather than
  // per keystroke or per page: the option set changes only when a budget is created in a
  // department that had none.
  await Promise.all([
    budgets.loadList(),
    budgets.loadControlPoints(),
    budgets.loadFilterDepartments(),
  ]);
});

/**
 * Switching to the tree reloads unpaginated, because a category's figure is the sum of the budgets
 * beneath it and a sum over one page is a wrong number. Switching away restores normal paging.
 */
async function onModeChange(mode: 'points' | 'tree' | 'flat') {
  const wasTree = budgets.listMode === 'tree';
  budgets.setListMode(mode);
  if (mode === 'tree') await budgets.loadTree();
  else if (wasTree) await budgets.loadList(1, 20);
}
</script>

<template>
  <div>
    <PageHeader :title="$t('budgets.list.title')" />

    <!-- No search field while the tree is shown. The tree is a TreeTable fed by its own full
         load, not the paged list this term narrows, so a box here would filter nothing — the very
         defect this screen was fixed for. A control wired to nothing is not offered. -->
    <PageToolbar :search="budgets.listMode === 'tree' ? undefined : term" @update:search="onSearch">
      <!-- Hidden in tree mode alongside the search box, and for the same reason: the tree is fed
           by its own full load, which these do not narrow. -->
      <template v-if="budgets.listMode !== 'tree'" #filters>
        <Select
          :modelValue="budgets.departmentId || null"
          :options="departmentOptions"
          optionLabel="label"
          optionValue="value"
          showClear
          size="small"
          class="w-56"
          :placeholder="$t('budgets.list.filterDepartment')"
          :aria-label="$t('budgets.list.filterDepartment')"
          @update:modelValue="budgets.narrow({ departmentId: $event ?? '' })"
        />
        <Select
          :modelValue="budgets.status || null"
          :options="statusOptions"
          optionLabel="label"
          optionValue="value"
          showClear
          size="small"
          class="w-40"
          :placeholder="$t('budgets.list.filterStatus')"
          :aria-label="$t('budgets.list.filterStatus')"
          @update:modelValue="budgets.narrow({ status: $event ?? '' })"
        />
        <!-- What the filters are hiding. A filter, unlike a term, can be set and scrolled past. -->
        <span v-if="showingOf" class="text-sm text-muted-color">{{ showingOf }}</span>
      </template>
      <template #actions>
        <SelectButton
          :modelValue="budgets.listMode"
          :options="groupOptions"
          optionLabel="label"
          optionValue="value"
          :allowEmpty="false"
          size="small"
          :aria-label="$t('budgets.list.groupingLabel')"
          @update:modelValue="onModeChange"
        />
        <Button
          v-can="'BUDGET_MANAGE'"
          :label="$t('budgets.form.createTitle')"
          icon="pi pi-plus"
          size="small"
          @click="router.push({ name: 'budget-new' })"
        />
      </template>
    </PageToolbar>

    <ErrorState v-if="budgets.error" :message="budgets.error" @retry="budgets.loadList()" />

    <!-- The plan, as it was written: department → category → line. A node row is structure and
         holds no money of its own; the figure against it is the total of what lies beneath. -->
    <div v-else-if="budgets.listMode === 'tree'" class="card">
      <Message severity="secondary" variant="simple" size="small" icon="pi pi-info-circle" class="mb-3">
        {{ $t('budgets.list.treeHint') }}
      </Message>
      <TreeTable :value="budgets.budgetTree" :loading="budgets.loading" scrollable scrollHeight="500px">
        <Column field="code" :header="$t('budgets.list.nodeColumn')" expander bodyClass="font-medium tabular-nums" />
        <Column field="name" :header="$t('common.name')">
          <template #body="{ node }">
            <span :class="node.data.kind === 'node' ? 'text-muted-color' : ''">{{ node.data.name || $t('common.none') }}</span>
            <!-- A budget that is not money — a DRAFT awaiting the approval that would put it in
                 force, a REJECTED one a plan refused. It stays on screen rather than vanishing: a
                 department head whose plan was withdrawn must be able to see what became of the
                 line they proposed. The mark says the amount is outside every total above it, so
                 the zero it leaves in its ancestors is explained rather than merely noticed. -->
            <Tag
              v-if="node.data.counted === false"
              severity="secondary"
              :value="$t('budgets.status.' + node.data.status)"
              :title="$t('budgets.list.notCountedHint')"
              data-testid="not-counted"
            />
          </template>
        </Column>
        <Column :header="$t('common.total')" bodyClass="text-right! tabular-nums" headerClass="justify-end">
          <template #body="{ node }">
            <!-- Σ marks a TOTAL, so a category cannot be read as an amount somebody allocated. -->
            <span
              :class="node.data.kind === 'node' ? 'text-muted-color' : ''"
              :title="node.data.kind === 'node' ? $t('budgets.list.categoryTotal') : undefined"
            >
              {{ formatAmount(node.data.amountTotal, treeDecimals) }}
              <span v-if="node.data.kind === 'node'" class="ml-1 text-xs">Σ</span>
            </span>
          </template>
        </Column>
        <Column :header="$t('budgets.list.available')" bodyClass="text-right! tabular-nums" headerClass="justify-end">
          <template #body="{ node }">
            <span
              :class="[
                isOverdrawn(node.data.available) ? 'text-red-600 dark:text-red-400 font-semibold' : '',
                node.data.kind === 'node' ? 'text-muted-color' : '',
              ]"
              :title="node.data.kind === 'node' ? $t('budgets.list.categoryTotal') : undefined"
            >
              {{ formatAmount(node.data.available, treeDecimals) }}
              <span v-if="node.data.kind === 'node'" class="ml-1 text-xs">Σ</span>
            </span>
          </template>
        </Column>
        <!-- Which places in the plan carry money the whole company draws on. Marked HERE because
             this is the only screen that renders the plan as a tree, so the reach of a mark — the
             whole subtree beneath it — is visible at the moment it is decided. -->
        <Column :header="$t('budgets.plan.sharedColumn')" style="width:16rem">
          <template #body="{ node }">
            <div class="flex items-center gap-2">
              <!-- Inherited: the mark is not here, so neither is the control. Saying where it IS
                   sends the reader to the node they can actually un-mark. -->
              <Tag
                v-if="node.data.sharedByAncestor"
                severity="info"
                :value="$t('budgets.plan.sharedByAncestor')"
              />
              <template v-else-if="node.data.nodeId">
                <Tag v-if="node.data.isShared" severity="info" :value="$t('budgets.plan.shared')" />
                <Button
                  v-can="'BUDGET_MANAGE'"
                  :label="node.data.isShared ? $t('budgets.plan.unmarkShared') : $t('budgets.plan.markShared')"
                  :title="$t('budgets.plan.markSharedReach', { count: node.data.budgetCount ?? 0 })"
                  size="small"
                  text
                  :severity="node.data.isShared ? 'secondary' : 'info'"
                  :loading="markingNodeId === node.data.nodeId"
                  data-testid="mark-shared"
                  @click="toggleShared(node.data.nodeId, !node.data.isShared)"
                />
              </template>
            </div>
          </template>
        </Column>
      </TreeTable>
      <EmptyState v-if="!budgets.loading && !budgets.budgetTree.length" :title="$t('budgets.list.empty')" />
    </div>

    <div v-else class="card">
      <AppDataTable
        :value="rows"
        :total="budgets.total"
        :loading="budgets.loading"
        :page="budgets.page"
        :rows="budgets.limit"
        :rowHover="true"
        rowGroupMode="subheader"
        groupRowsBy="__groupKey"
        :numberOf="(row: any) => row.__n"
        scrollHeight="500px"
        :pt="{
          rowGroupHeaderCell: { colspan: TOTAL_COLUMNS },
          // Marks the header row so flat mode's single bucket can be collapsed away entirely
          // instead of leaving an empty band.
          rowGroupHeader: budgets.listGrouped ? {} : { 'data-flat-group': '' },
        }"
        @page="(e: { page: number; limit: number }) => budgets.loadList(e.page, e.limit)"
        @refresh="budgets.loadList()"
        @row-click="(e: any) => router.push({ name: 'budget-detail', params: { id: e.data.id } })"
      >
        <Column field="budgetName" :header="$t('common.name')"><template #body="{ data }">{{ data.budgetName ?? data.node?.name ?? $t('common.none') }}</template></Column>
        <!-- The plan code, which is the budget's identity and what a department head checks their
             own plan against. It comes from the NODE: the money's place in the plan, not an
             account — several budgets legitimately share one account. -->
        <Column field="node.code" :header="$t('budgets.list.code')" bodyClass="font-medium tabular-nums">
          <template #body="{ data }">{{ data.node?.code ?? $t('common.none') }}</template>
        </Column>
        <!-- The GL is optional now: a budget whose spending posts to several accounts records none. -->
        <Column field="glAccount" :header="$t('budgets.list.gl')">
          <template #body="{ data }">{{ data.glAccount ?? $t('common.none') }}</template>
        </Column>
        <Column :header="$t('budgets.list.fiscalYear')"><template #body="{ data }">{{ data.fiscalYear?.year ?? $t('common.none') }}</template></Column>
        <Column :header="$t('budgets.list.department')"><template #body="{ data }">{{ data.department?.name ?? $t('common.none') }}</template></Column>
        <!-- Status sits with the other descriptive columns, before the money. Everything from here
             right is amounts, so the table ends in one unbroken money block — and because the group
             header spans the whole row, its own figures then land against the same right edge as
             the children's, instead of stopping a column short. -->
        <Column :header="$t('common.status')">
          <template #body="{ data }">
            <div class="flex flex-wrap items-center gap-2">
              <Tag :value="$t('budgets.status.' + data.status)" :severity="data.status === 'ACTIVE' ? 'success' : 'secondary'" />
              <!-- A DRAFT no plan carries. It reads identically to one awaiting an approver, and
                   only this one has anything the reader can do: nothing is coming to approve it.
                   The server answers `stranded` per page, so the row is not guessing. -->
              <Button
                v-if="data.stranded"
                v-can="'BUDGET_MANAGE'"
                :label="$t('budgets.plan.repropose')"
                icon="pi pi-send"
                size="small"
                severity="warn"
                text
                :loading="reproposingId === data.id"
                data-testid="repropose"
                @click.stop="repropose(data.id)"
              />
            </div>
          </template>
        </Column>
        <!-- Money right-aligned with tabular figures so digits line up down the column and two
             budgets can be compared at a glance — the house pattern from ReadyToPayView and
             SettlementsView. -->
        <Column :header="$t('common.total')" bodyClass="text-right! tabular-nums" headerClass="justify-end">
          <template #body="{ data }">
            <!-- Every row here is an appropriation and holds its own money. Categories are
                 `budget_node` rows and never appear in this table, so no figure on it is a
                 rollup — the subtree totals live on the group header and in the tree view. -->
            <span>{{ formatAmount(data.amountTotal, decimalsOf(data)) }}</span>
          </template>
        </Column>
        <Column :header="$t('budgets.list.available')" bodyClass="text-right! tabular-nums" headerClass="justify-end">
          <template #body="{ data }">
            <!-- A line spent past its own amount is the number the whole screen is about; it must
                 not read the same as a healthy one. -->
            <span :class="isOverdrawn(data.available) ? 'text-red-600 dark:text-red-400 font-semibold' : ''">
              {{ formatAmount(data.available, decimalsOf(data)) }}
            </span>
          </template>
        </Column>
        <!-- The group header is a CONTROL POINT, not a budget: no status chip, no link to a
             budget detail, not selectable. It holds no money of its own — rendering it as another
             budget line would put back the parent/child confusion the data model avoids. -->
        <template #groupheader="{ data }">
          <!-- Flat mode renders the same rows with no heading; the single bucket has no control
               point to describe. -->
          <div v-if="budgets.listGrouped" class="flex items-center justify-between gap-4 py-1">
            <div v-if="groupOf(data).ungoverned" class="flex items-center gap-2 text-red-600 dark:text-red-400 font-semibold">
              <i class="pi pi-exclamation-triangle" />
              <span>{{ $t('budgets.groups.ungoverned') }}</span>
              <span class="font-normal text-sm text-muted-color">{{ $t('budgets.groups.ungovernedHint') }}</span>
            </div>
            <!-- Not in force, so ungoverned by design and not a fault: DRAFT and REJECTED never
                 had coverage (it is established at activation), and CLOSED no longer needs it —
                 a ceiling on an appropriation nobody can draw from governs nothing.
                 Deliberately not the red fault heading above, and
                 deliberately carrying no ceiling or available: no control point governs them, and
                 showing a figure here would invent one. -->
            <div
              v-else-if="groupOf(data).budgetStatus"
              class="flex items-center gap-2 text-muted-color font-semibold"
            >
              <i class="pi pi-clock" />
              <span>{{ $t(`budgets.status.${groupOf(data).budgetStatus}`) }}</span>
              <span class="font-normal text-sm">
                {{ $t('budgets.groups.notInForceHint') }}
              </span>
            </div>
            <template v-else>
              <RouterLink
                class="text-primary no-underline hover:underline font-semibold flex-1 min-w-0 truncate"
                :to="{ name: 'control-point-detail', params: { id: groupOf(data).controlPoint.id } }"
              >
                {{ groupOf(data).controlPoint.budgetNodeCode }} ·
                {{ groupOf(data).controlPoint.budgetNodeName }}
                <span class="font-normal text-muted-color">
                  / {{ groupOf(data).controlPoint.departmentNodeCode }}
                </span>
            
              </RouterLink>
              <!-- One block to read instead of four: the figures sit INSIDE the bar, so how full
                   and how much are the same glance.

                   Two pass-throughs make that safe. PrimeVue puts the label inside
                   `.p-progressbar-value`, which is `position: absolute; overflow: hidden`, so the
                   text is clipped to the filled width — 20px at 6%. Making the value `static` hands
                   the positioning back to `.p-progressbar` (already `position: relative`), so the
                   label can span the whole track at any percentage.

                   The value is also floored just above zero because the label is skipped entirely
                   when `value === 0` (progressbar/index.mjs), which would blank the figures on every
                   untouched group. `aria-valuenow` is set back to the true percentage so the
                   accessible value stays honest. -->
              <ProgressBar
                :value="fillValue(groupOf(data))"
                class="w-96 h-7 shrink-0 -mr-2"
                :pt="{
                  root: {
                    'aria-valuenow': usedPctOf(groupOf(data)),
                    // The component's own track is lighter than the row and washed the figures
                    // out, so this is a fainter one mixed from the text colour — it adapts to the
                    // theme and stays well under the figures' contrast. The track matters: without
                    // it a 0% group shows nothing at all, and at 91.2% there is no visible 100%
                    // mark to read the remaining slice against.
                    style: {
                      background: 'color-mix(in srgb, var(--p-text-color) 8%, transparent)',
                    },
                  },
                  value: {
                    style: {
                      position: 'static',
                      overflow: 'visible',
                      // Translucency has to live in the COLOUR, not in `opacity`: the label is a
                      // child of this element, so an opacity here would fade the figures with it —
                      // which is exactly what it did, to 18% white on a dark row.
                      background: fillColor(usedPctOf(groupOf(data))),
                    },
                  },
                  // Padded both ends so the figures are not flush against the track's rounded edge.
                    // The bar is pulled 8px right by the same amount, so the figures still land on
                    // the children's column edge instead of drifting left of it.
                    label: { class: 'absolute inset-0 flex items-center justify-end gap-3 px-2 whitespace-nowrap' },
                }"
              >
                <span
                  class="text-sm font-semibold tabular-nums w-14 text-right shrink-0"
                  :style="{ color: `var(--p-${utilColor(usedPctOf(groupOf(data)))}-600)` }"
                >{{ usedPctOf(groupOf(data)) }}%</span>
                <span class="text-sm text-muted-color shrink-0">{{ $t('budgets.groups.wholeGroup') }}</span>
                <!-- Fixed slot: without it a short pair like "200,000 / 200,000" pulls the figures
                     right and a long one pushes it left, and the column goes ragged again. -->
                <span class="text-color font-semibold tabular-nums shrink-0 w-64 text-right">
                  {{ formatAmount(groupOf(data).controlPoint.available, decimalsOf(data)) }}
                  <span class="font-normal text-muted-color">
                    / {{ formatAmount(groupOf(data).controlPoint.ceiling, decimalsOf(data)) }}
                  </span>
                </span>
              </ProgressBar>
            </template>
          </div>
        </template>
        <template #empty>
          <!-- "your filters excluded everything" is a different message from "there are no
               budgets", and a reader who cannot tell them apart concludes the data is missing. -->
          <EmptyState
            v-if="budgets.narrowing"
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
          <EmptyState v-else icon="pi pi-wallet" :title="$t('budgets.list.empty')" />
        </template>
      </AppDataTable>
    </div>
  </div>
</template>

<style scoped>
/* The grouping has to be legible without reading the colour: a tinted header band with children
 * indented under it. Without this a child row looks identical to an ungrouped one — which is how
 * the hierarchy got lost in the source spreadsheet in the first place.
 *
 * Semantic PrimeVue tokens, not surface-100/800 pairs: these already flip with the theme, so there
 * is no second rule to keep in sync and no way for light and dark to drift apart. */
:deep(.p-datatable-tbody > tr.p-datatable-row-group-header) {
  background: var(--p-content-hover-background);
  border-top: 1px solid var(--p-content-border-color);
}

/* Flat mode still emits one row-group header row for its single bucket. `v-if` empties its
 * content but the <tr> remains, leaving a blank tinted band above the first budget — so the row
 * itself is collapsed here rather than merely blanked. */
:deep(tr[data-flat-group]) {
  display: none;
}

/* Children sit under their group header. */
:deep(.p-datatable-tbody > tr:not(.p-datatable-row-group-header) > td:first-child) {
  padding-left: 1.75rem;
}
</style>
