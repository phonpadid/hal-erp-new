<script setup lang="ts">
import Button from 'primevue/button';
import Message from 'primevue/message';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const { t } = useI18n();
const router = useRouter();
const auth = useAuthStore();
const busy = ref('');
const serverError = ref('');

async function choose(companyId: string) {
  busy.value = companyId;
  serverError.value = '';
  try {
    await auth.selectCompany(companyId);
    await router.push({ name: 'home' });
  } catch {
    // A failed switch must not leave the user staring at a dead button.
    serverError.value = t('auth.selectCompany.error');
  } finally {
    busy.value = '';
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-950">
    <div class="w-full max-w-md p-8 rounded-xl border border-surface bg-surface-0 dark:bg-surface-900">
      <h1 class="text-lg font-semibold text-color mb-1">{{ $t('auth.selectCompany.title') }}</h1>
      <p class="text-sm text-muted-color mb-6">{{ $t('auth.selectCompany.subtitle') }}</p>

      <div class="flex flex-col gap-2">
        <Button
          v-for="c in auth.companies"
          :key="c.id"
          :label="`${c.nameTh} (${c.code})`"
          severity="secondary"
          outlined
          :loading="busy === c.id"
          class="justify-start"
          @click="choose(c.id)"
        />
        <p v-if="!auth.companies.length" class="text-sm text-muted-color">
          {{ $t('auth.selectCompany.empty') }}
        </p>
      </div>

      <Message v-if="serverError" severity="error" variant="simple" class="mt-4">{{ serverError }}</Message>
    </div>
  </div>
</template>
