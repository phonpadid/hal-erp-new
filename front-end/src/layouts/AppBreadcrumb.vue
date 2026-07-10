<script setup lang="ts">
/**
 * Shared application breadcrumb, rendered once by the shell (AppLayout) above the
 * routed page. It wraps PrimeVue's Breadcrumb and derives its trail from the active
 * route + NAV metadata via buildBreadcrumbTrail; detail pages contribute their leaf
 * crumb through useBreadcrumb(). Colours come from PrimeUI theme tokens so light and
 * dark both work; labels come from i18n. Renders nothing on the Dashboard root, where
 * the trail is empty.
 */
import Breadcrumb from 'primevue/breadcrumb';
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '@/stores/auth';
import { buildBreadcrumbTrail, useDynamicCrumbs } from '@/composables/useBreadcrumb';

const route = useRoute();
const auth = useAuthStore();
const { t } = useI18n();
const dynamic = useDynamicCrumbs();

const trail = computed(() => {
  const record = route.matched[route.matched.length - 1];
  return buildBreadcrumbTrail({
    recordPath: record?.path ?? route.path,
    meta: route.meta.breadcrumb,
    can: (c) => auth.can(c),
    t,
    dynamic: dynamic.value,
  });
});
const home = computed(() => trail.value.home);
const model = computed(() => trail.value.model);
</script>

<template>
  <Breadcrumb
    v-if="model.length"
    :home="home"
    :model="model"
    :pt="{ root: { class: 'bg-surface-0 dark:bg-surface-900 border border-surface rounded-lg px-3 py-2 mb-4' } }"
    :aria-label="t('breadcrumb.aria')"
  >
    <template #item="{ item }">
      <router-link v-if="item.to" v-slot="{ href, navigate }" :to="item.to" custom>
        <a
          :href="href"
          :aria-label="item.label ? undefined : t('breadcrumb.home')"
          class="inline-flex items-center gap-1.5 text-sm text-muted-color hover:text-color transition-colors"
          @click="navigate"
        >
          <span v-if="item.icon" :class="item.icon" aria-hidden="true" />
          <span v-if="item.label">{{ item.label }}</span>
        </a>
      </router-link>
      <span
        v-else
        class="inline-flex items-center gap-1.5 text-sm"
        :class="item.current ? 'text-color font-medium' : 'text-muted-color'"
        :aria-current="item.current ? 'page' : undefined"
      >
        <span v-if="item.icon" :class="item.icon" aria-hidden="true" />
        <span v-if="item.label">{{ item.label }}</span>
      </span>
    </template>
  </Breadcrumb>
</template>
