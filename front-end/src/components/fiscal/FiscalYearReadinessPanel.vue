<script setup lang="ts">
/**
 * What the next fiscal year still lacks, one line per item, each with the screen that fixes it.
 * Nothing prepares a year on its own; this is where the people who prepare it see the gap a month
 * ahead instead of hearing about it from a requester on the first working day of January.
 */
import Button from 'primevue/button';
import Tag from 'primevue/tag';
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFiscalYearReadiness } from './useFiscalYearReadiness';

const emit = defineEmits<{ createYear: [year: number] }>();
const { t } = useI18n();
const { data, canRead, load } = useFiscalYearReadiness();

interface Item {
  key: string;
  label: string;
  ok: boolean;
  optional?: boolean;
  detail?: string;
  to?: { name: string };
  action?: () => void;
}

const items = computed<Item[]>(() => {
  const r = data.value;
  if (!r) return [];
  const y = r.target.year;
  return [
    {
      key: 'fiscalYear',
      label: t('admin.org.readiness.fiscalYear', { year: y }),
      ok: r.target.exists && r.target.status === 'OPEN',
      action: () => emit('createYear', y),
    },
    {
      key: 'budgets',
      label: t('admin.org.readiness.budgets', { year: y, count: r.target.activeBudgets }),
      ok: r.target.activeBudgets > 0,
      to: { name: 'budgets' },
    },
    {
      key: 'quota',
      label: t('admin.org.readiness.quota', { year: y }),
      ok: r.target.missingEntitlements === 0,
      detail: r.target.missingEntitlements
        ? t('admin.org.readiness.quotaMissing', { count: r.target.missingEntitlements })
        : undefined,
      to: { name: 'quota-admin' },
    },
    {
      key: 'budgetRate',
      label: t('admin.org.readiness.budgetRate', { year: y }),
      ok: r.target.hasBudgetRate,
      optional: true,
      to: { name: 'currency-admin' },
    },
  ];
});

onMounted(() => void load());
defineExpose({ load });
</script>

<template>
  <section
    v-if="canRead && data"
    class="card mb-4 flex flex-col gap-3"
    data-testid="fy-readiness"
  >
    <div class="flex flex-wrap items-center gap-3">
      <i class="pi pi-calendar-times text-xl text-muted-color" />
      <h2 class="m-0 text-lg font-semibold text-color">
        {{ $t('admin.org.readiness.title', { year: data.target.year }) }}
      </h2>
      <Tag
        :value="data.ready ? $t('admin.org.readiness.ready') : $t('admin.org.readiness.notReady')"
        :severity="data.ready ? 'success' : 'warn'"
      />
      <span v-if="data.daysLeft !== null && !data.blockedNow" class="text-sm text-muted-color">
        {{ $t('admin.org.readiness.daysLeft', { days: data.daysLeft }) }}
      </span>
    </div>

    <ul class="m-0 flex list-none flex-col gap-2 p-0">
      <li
        v-for="item in items"
        :key="item.key"
        class="flex flex-wrap items-center gap-2 text-sm"
        :data-testid="`fy-readiness-${item.key}`"
        :data-ok="item.ok ? 'true' : 'false'"
      >
        <i
          class="pi"
          :class="item.ok
            ? 'pi-check-circle text-green-600 dark:text-green-400'
            : item.optional ? 'pi-circle text-muted-color' : 'pi-times-circle text-red-600 dark:text-red-400'"
        />
        <span class="text-color">{{ item.label }}</span>
        <span v-if="item.detail" class="text-muted-color">· {{ item.detail }}</span>
        <template v-if="!item.ok">
          <Button
            v-if="item.action"
            :label="$t('admin.org.readiness.open')"
            text
            size="small"
            @click="item.action()"
          />
          <RouterLink v-else-if="item.to" :to="item.to" class="text-primary">
            {{ $t('admin.org.readiness.open') }}
          </RouterLink>
        </template>
      </li>
    </ul>
  </section>
</template>
