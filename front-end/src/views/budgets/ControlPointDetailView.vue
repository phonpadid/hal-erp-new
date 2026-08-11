<script setup lang="ts">
/**
 * One control point: what it has left, and the budgets it pools.
 *
 * The governed list next to the group's available is the point of the screen — it is what makes
 * visible that a line can be far past its own amount while the ceiling that governs it still holds.
 */
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Tag from 'primevue/tag';
import { computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import DetailHeader from '@/components/DetailHeader.vue';
import SectionCard from '@/components/SectionCard.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import { useBudgetsStore } from '../../stores/budgets';
import { useBreadcrumb } from '../../composables/useBreadcrumb';
import { formatAmount } from '../../utils/money';

const route = useRoute();
const budgets = useBudgetsStore();
const id = route.params.id as string;

const cp = computed(() => budgets.currentControlPoint);
const b = computed(() => budgets.controlPointBalance);

useBreadcrumb(() =>
  cp.value ? [{ label: `${cp.value.accountNodeCode} · ${cp.value.accountNodeName}` }] : [],
);

const decimals = computed<number>(
  () => budgets.list[0]?.fiscalYear?.company?.baseCurrency?.decimalPlaces ?? 2,
);

// The budgets this point governs, resolved from the loaded budget list. Each keeps its OWN
// available — the number that can be negative while the group above is still positive.
const governed = computed(() => {
  const ids = new Set(cp.value?.governedBudgetIds ?? []);
  return budgets.list.filter((x) => ids.has(x.id));
});

// Same chain as a budget breakdown; `actual` is deliberately absent from the sum — it converts
// money the reserve already took out into money spent, so charging it again double-counts.
const rows = computed(() =>
  b.value
    ? [
        { key: 'amountTotal', value: b.value.amountTotal, sign: '' },
        { key: 'adjustIncrease', value: b.value.adjustIncrease, sign: '+' },
        { key: 'adjustDecrease', value: b.value.adjustDecrease, sign: '−' },
        { key: 'transferIn', value: b.value.transferIn, sign: '+' },
        { key: 'transferOut', value: b.value.transferOut, sign: '−' },
        { key: 'reserved', value: b.value.reserved, sign: '−' },
        { key: 'released', value: b.value.released, sign: '+' },
      ]
    : [],
);

const isOverdrawn = (available?: string) => available !== undefined && Number(available) < 0;

onMounted(() => budgets.loadControlPoint(id));
</script>

<template>
  <div>
    <ErrorState v-if="budgets.error" :message="budgets.error" @retry="budgets.loadControlPoint(id)" />

    <template v-else-if="cp">
      <DetailHeader
        :title="`${cp.accountNodeCode} · ${cp.accountNodeName}`"
        :subtitle="`${cp.departmentNodeCode} · ${cp.departmentNodeName}`"
      />

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-x-4 items-stretch">
        <SectionCard :title="$t('budgets.controlPointDetail.balanceTitle')">
          <div v-if="b">
            <div v-for="r in rows" :key="r.key" class="flex justify-between text-sm py-1">
              <span class="text-muted-color">{{ r.sign }} {{ $t('budgets.balance.' + r.key) }}</span>
              <span>{{ formatAmount(r.value, decimals) }}</span>
            </div>
            <div class="flex justify-between font-semibold border-t border-surface mt-2 pt-2">
              <span>{{ $t('budgets.balance.available') }}</span>
              <span>{{ formatAmount(b.available, decimals) }}</span>
            </div>
            <div class="flex justify-between text-xs text-muted-color mt-2 pt-2 border-t border-surface">
              <span>{{ $t('budgets.balance.actualHint') }}</span>
              <span>{{ formatAmount(b.actual, decimals) }}</span>
            </div>
          </div>
        </SectionCard>

        <SectionCard :title="$t('budgets.controlPointDetail.ladderTitle')" :subtitle="$t('budgets.controlPointDetail.ladderSubtitle')">
          <div
            v-for="rung in [...cp.tolerance].sort((x, y) => x.at - y.at)"
            :key="rung.at + rung.action"
            class="flex items-center justify-between py-2 border-b border-surface last:border-b-0"
          >
            <span class="text-sm">{{ rung.at }}%</span>
            <Tag
              :value="$t('budgets.controlPointDetail.action.' + rung.action)"
              :severity="rung.action === 'BLOCK' ? 'danger' : 'warn'"
            />
          </div>
        </SectionCard>
      </div>

      <SectionCard
        :title="$t('budgets.controlPointDetail.governedTitle')"
        :subtitle="$t('budgets.controlPointDetail.governedSubtitle')"
      >
        <DataTable :value="governed" :rowHover="true" dataKey="id">
          <Column field="budgetName" :header="$t('common.name')">
            <template #body="{ data }">
              <RouterLink
                class="text-primary no-underline hover:underline"
                :to="{ name: 'budget-detail', params: { id: data.id } }"
              >
                {{ data.budgetName ?? data.glAccount }}
              </RouterLink>
            </template>
          </Column>
          <Column field="glAccount" :header="$t('budgets.list.gl')" />
          <Column :header="$t('common.total')">
            <template #body="{ data }">{{ formatAmount(data.amountTotal, decimals) }}</template>
          </Column>
          <Column :header="$t('budgets.list.available')">
            <template #body="{ data }">
              <span :class="isOverdrawn(data.available) ? 'text-red-500 font-semibold' : ''">
                {{ formatAmount(data.available, decimals) }}
              </span>
            </template>
          </Column>
          <template #empty>
            <EmptyState
              icon="pi pi-wallet"
              :title="$t('budgets.controlPointDetail.governedEmpty')"
              :message="$t('budgets.controlPointDetail.governedEmptyHint')"
            />
          </template>
        </DataTable>
      </SectionCard>
    </template>
  </div>
</template>
