<script setup lang="ts">
import { RouterLink } from 'vue-router';
import AuthShell from './AuthShell.vue';
</script>

<template>
  <AuthShell :title="$t('auth.checkEmail.title')" icon="pi-envelope">
    <p class="text-center text-muted-color leading-relaxed">
      {{ $t('auth.checkEmail.message') }}
    </p>

    <template #footer>
      <RouterLink :to="{ name: 'login' }" class="text-primary hover:underline">
        {{ $t('auth.checkEmail.backToLogin') }}
      </RouterLink>
    </template>
  </AuthShell>
</template>
