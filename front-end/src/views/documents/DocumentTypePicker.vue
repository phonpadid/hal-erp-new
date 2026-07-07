<script setup lang="ts">
/**
 * Document-type selection as a card radiogroup (icon + name + category description),
 * replacing a bare dropdown. Keyboard-operable via native <button role="radio"> semantics;
 * the selected card exposes aria-checked. Icon and description derive from the type's
 * `category` (config-over-code) — CreatableType carries no per-type icon/description.
 * In edit mode the type is fixed and the cards render read-only.
 */
import Skeleton from 'primevue/skeleton';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { CreatableType } from '../../api/documents';

const props = defineProps<{
  types: CreatableType[];
  disabled?: boolean;
  loading?: boolean;
}>();

const selectedId = defineModel<string>({ required: true });
const { t } = useI18n();

const ICONS: Record<string, string> = {
  PROCUREMENT: 'pi-shopping-cart',
  FINANCE: 'pi-wallet',
  HR: 'pi-users',
  ADMIN: 'pi-briefcase',
  IT: 'pi-desktop',
};
const KNOWN = new Set(['PROCUREMENT', 'FINANCE', 'HR', 'ADMIN', 'IT']);

const iconFor = (category: string) => `pi ${ICONS[category] ?? 'pi-file'}`;
const descFor = (category: string) =>
  t(`documents.create.category.${KNOWN.has(category) ? category : 'OTHER'}`);

const cards = computed(() =>
  props.types.map((ty) => ({ ty, icon: iconFor(ty.category), desc: descFor(ty.category) })),
);

function select(id: string) {
  if (!props.disabled) selectedId.value = id;
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <span class="text-sm text-muted-color">{{ $t('documents.create.typeStepHint') }}</span>

    <!-- Loading: skeleton cards rather than an empty control. -->
    <div v-if="loading" class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Skeleton v-for="n in 3" :key="n" height="5.5rem" class="rounded-lg" />
    </div>

    <div v-else role="radiogroup" :aria-label="$t('documents.create.typeGroupLabel')" class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <button
        v-for="{ ty, icon, desc } in cards"
        :key="ty.id"
        type="button"
        role="radio"
        :aria-checked="selectedId === ty.id"
        :disabled="disabled && selectedId !== ty.id"
        class="flex items-start gap-3 rounded-lg border p-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        :class="selectedId === ty.id
          ? 'border-primary bg-primary-50 dark:bg-primary-400/10'
          : 'border-surface-200 hover:border-primary-300 dark:border-surface-700'"
        @click="select(ty.id)"
      >
        <i :class="icon" class="mt-0.5 text-xl" :style="{ color: selectedId === ty.id ? 'var(--p-primary-color)' : 'var(--p-text-muted-color)' }" />
        <span class="flex min-w-0 flex-col">
          <span class="font-medium text-color">{{ ty.name }}</span>
          <span class="text-xs text-muted-color">{{ desc }}</span>
        </span>
        <i v-if="selectedId === ty.id" class="pi pi-check-circle ml-auto text-primary" />
      </button>
    </div>
  </div>
</template>
