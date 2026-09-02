<script setup lang="ts">
/**
 * A navigation the shell would not allow, and the permission code it wanted.
 *
 * Its own address rather than a toast over the home page, because of how a refusal is usually
 * met: someone opens a link a colleague sent. A toast is gone on the next navigation and absent
 * on a reload; an address can be reloaded, screenshotted, and pasted into a message to an
 * administrator with the code still on it.
 *
 * Naming the code is the point. A message that says only "you do not have permission" returns the
 * reader to guessing between four different situations — a permission they lack, a permission
 * nobody can hold because the catalog has no row for it, a retired page, and a typo.
 */
import Button from 'primevue/button';
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import EmptyState from '@/components/EmptyState.vue';

const route = useRoute();
const router = useRouter();

const code = computed(() => {
  const q = route.query.code;
  return typeof q === 'string' ? q : '';
});
</script>

<template>
  <div data-testid="forbidden">
    <EmptyState
      icon="pi pi-lock"
      :title="$t('shell.forbidden.title')"
      :message="$t('shell.forbidden.body')"
    >
      <template #action>
        <div class="flex flex-col items-center gap-3">
          <code v-if="code" class="rounded bg-surface-100 px-2 py-1 text-sm dark:bg-surface-800" data-testid="forbidden-code">{{ code }}</code>
          <Button :label="$t('shell.forbidden.home')" outlined @click="router.push({ name: 'home' })" />
        </div>
      </template>
    </EmptyState>
  </div>
</template>
