<script setup lang="ts">
import Button from 'primevue/button';
import Message from 'primevue/message';
import ProgressSpinner from 'primevue/progressspinner';
import { onMounted, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { api } from '../../api/client';
import AuthShell from './AuthShell.vue';

const route = useRoute();
const router = useRouter();
const token = (route.query.token as string) ?? '';

// checking → confirming the token · success → verified · invalid → missing/expired/used
const state = ref<'checking' | 'success' | 'invalid'>('checking');

onMounted(async () => {
  if (!token) {
    state.value = 'invalid';
    return;
  }
  try {
    await api.post('/auth/verify-email', { token });
    state.value = 'success';
  } catch {
    state.value = 'invalid';
  }
});
</script>

<template>
  <AuthShell
    :title="state === 'invalid' ? $t('auth.verifyEmail.invalidTitle') : $t('auth.verifyEmail.title')"
    :subtitle="state === 'success' ? $t('auth.verifyEmail.subtitle') : undefined"
    icon="pi-envelope"
  >
    <!-- confirming the token -->
    <div v-if="state === 'checking'" class="flex justify-center py-6">
      <ProgressSpinner style="width: 2.5rem; height: 2.5rem" strokeWidth="4" />
    </div>

    <!-- invalid / expired / already used -->
    <div v-else-if="state === 'invalid'" class="flex flex-col gap-4">
      <Message severity="warn" variant="simple">{{ $t('auth.verifyEmail.invalidMessage') }}</Message>
      <Button :label="$t('auth.verifyEmail.backToLogin')" outlined fluid @click="router.push({ name: 'login' })" />
    </div>

    <!-- success -->
    <div v-else class="flex flex-col gap-4">
      <Message severity="success" variant="simple">{{ $t('auth.verifyEmail.successMessage') }}</Message>
      <Button :label="$t('auth.verifyEmail.continue')" fluid @click="router.push({ name: 'login' })" />
    </div>

    <template #footer>
      <RouterLink :to="{ name: 'login' }" class="text-primary hover:underline">
        {{ $t('auth.verifyEmail.backToLogin') }}
      </RouterLink>
    </template>
  </AuthShell>
</template>
