<script setup lang="ts">
/**
 * Document-type selection as a card radiogroup (icon + name + category description),
 * replacing a bare dropdown. Follows the ARIA radiogroup pattern: the group is a single tab
 * stop (roving tabindex) and arrows/Home/End move the selection, which `role="radio"` alone
 * does not provide. Icon and description derive from the type's `category` (config-over-code)
 * — CreatableType carries no per-type icon/description. In edit mode the type is fixed and
 * the cards render read-only.
 */
import Message from 'primevue/message';
import Skeleton from 'primevue/skeleton';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { CreatableType } from '../../api/documents';

const props = defineProps<{
  types: CreatableType[];
  disabled?: boolean;
  loading?: boolean;
  /**
   * Type id → the permission code its authoring screen requires and this user lacks. The picker
   * learns nothing about routing or permissions; the view answers that question, this renders the
   * answer. A card here is shown disabled with the code, never hidden: a user told to raise that
   * document who cannot find the card learns only that the system is confusing, while one who sees
   * the code knows what to ask for.
   */
  unreachable?: Record<string, string>;
}>();

const selectedId = defineModel<string>({ required: true });
const { t } = useI18n();
const cardEls = ref<HTMLButtonElement[]>([]);

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

const blockedBy = (id: string) => props.unreachable?.[id];

const cards = computed(() =>
  props.types.map((ty) => ({
    ty,
    icon: iconFor(ty.category),
    desc: descFor(ty.category),
    blocked: blockedBy(ty.id),
  })),
);

function select(id: string) {
  // No path — click, Enter, Space, arrow — may choose a card whose screen would refuse this user.
  if (!props.disabled && !blockedBy(id)) selectedId.value = id;
}

const selectedIndex = computed(() => props.types.findIndex((ty) => ty.id === selectedId.value));

// Roving tabindex: the group holds one tab stop — the selected card, or the first card while
// nothing is selected yet, so Tab always lands somewhere inside the group.
function tabIndexFor(i: number): number {
  const active = selectedIndex.value;
  return (active === -1 ? 0 : active) === i ? 0 : -1;
}

// Arrow/Home/End move selection AND focus together (ARIA radiogroup semantics). Arrows wrap.
// Read-only in edit mode, where the type is fixed.
function onKeydown(e: KeyboardEvent, i: number) {
  if (props.disabled || !props.types.length) return;
  const last = props.types.length - 1;
  let next: number;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = i === last ? 0 : i + 1;
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = i === 0 ? last : i - 1;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = last;
  else return;
  e.preventDefault();
  // Focus moves onto an unreachable card even though `select` refuses it: skipping it would hide
  // the very explanation the card exists to give from keyboard and screen-reader users.
  select(props.types[next].id);
  cardEls.value[next]?.focus();
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <span class="text-sm text-muted-color">{{ $t('documents.create.typeStepHint') }}</span>

    <!-- Loading: skeleton cards rather than an empty control. -->
    <div v-if="loading" class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Skeleton v-for="n in 3" :key="n" height="5.5rem" class="rounded-lg" />
    </div>

    <!-- No creatable types (none configured, or none the user may create): say so rather than
         render an empty grid the user can't tell apart from a failed load. -->
    <Message v-else-if="!cards.length" severity="info" variant="simple" data-testid="no-types">
      {{ $t('documents.create.noTypes') }}
    </Message>

    <div v-else role="radiogroup" :aria-label="$t('documents.create.typeGroupLabel')" class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <button
        v-for="({ ty, icon, desc, blocked }, i) in cards"
        :key="ty.id"
        ref="cardEls"
        type="button"
        role="radio"
        :aria-checked="selectedId === ty.id"
        :disabled="disabled && selectedId !== ty.id"
        :aria-disabled="!!blocked || undefined"
        :tabindex="tabIndexFor(i)"
        class="flex items-start gap-3 rounded-lg border p-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        :class="blocked
          ? 'cursor-not-allowed border-surface-200 opacity-60 dark:border-surface-700'
          : selectedId === ty.id
            ? 'border-primary bg-primary-50 dark:bg-primary-400/10'
            : 'border-surface-200 hover:border-primary-300 dark:border-surface-700'"
        @click="select(ty.id)"
        @keydown="onKeydown($event, i)"
      >
        <i :class="icon" class="mt-0.5 text-xl" :style="{ color: selectedId === ty.id ? 'var(--p-primary-color)' : 'var(--p-text-muted-color)' }" />
        <span class="flex min-w-0 flex-col">
          <span class="font-medium text-color">{{ ty.name }}</span>
          <span class="text-xs text-muted-color">{{ desc }}</span>
          <!-- The code, not a paraphrase: it is what the system authorizes on and what an
               administrator can act on. -->
          <span v-if="blocked" class="text-xs text-muted-color" data-testid="type-blocked">
            {{ $t('documents.create.needsPermission', { code: blocked }) }}
          </span>
        </span>
        <i v-if="selectedId === ty.id" class="pi pi-check-circle ml-auto text-primary" />
      </button>
    </div>
  </div>
</template>
