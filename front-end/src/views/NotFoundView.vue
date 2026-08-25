<script setup lang="ts">
/**
 * An address that matches no route.
 *
 * Distinct from the refusal view on purpose: the shell used to send both to the home page, so a
 * reader could not tell "this page is not for you" from "there is no such page" — and, since a
 * permission with no catalog row also landed here, could not tell either from "nobody can open
 * this at all".
 */
import Button from 'primevue/button';
import { useRouter } from 'vue-router';
import EmptyState from '@/components/EmptyState.vue';

const router = useRouter();
</script>

<template>
  <div data-testid="not-found">
    <EmptyState
      icon="pi pi-compass"
      :title="$t('shell.notFound.title')"
      :message="$t('shell.notFound.body')"
    >
      <template #action>
        <Button :label="$t('shell.forbidden.home')" outlined @click="router.push({ name: 'home' })" />
      </template>
    </EmptyState>
  </div>
</template>
