<script setup lang="ts">
import { Form, FormField } from '@primevue/forms';
import { zodResolver } from '@primevue/forms/resolvers/zod';
import Button from 'primevue/button';
import Message from 'primevue/message';
import Password from 'primevue/password';
import ProgressSpinner from 'primevue/progressspinner';
import { onMounted, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { api } from '../../api/client';
import AuthShell from './AuthShell.vue';
import type { FormSubmitEvent } from '@primevue/forms';
import { resetPasswordFormSchema } from '@erp/shared';

const route = useRoute();
const router = useRouter();
const token = (route.query.token as string) ?? '';

// checking → verifying the token · valid → show form · invalid → expired/used/missing
const state = ref<'checking' | 'valid' | 'invalid'>('checking');
const serverError = ref(false);
const busy = ref(false);

const resolver = zodResolver(resetPasswordFormSchema);
const initialValues = ref({ newPassword: '', confirmPassword: '' });

onMounted(async () => {
  if (!token) {
    state.value = 'invalid';
    return;
  }
  try {
    const { data } = await api.get<{ valid: boolean }>(
      `/auth/password/reset/${encodeURIComponent(token)}`,
    );
    state.value = data.valid ? 'valid' : 'invalid';
  } catch {
    state.value = 'invalid';
  }
});

async function onSubmit(e: FormSubmitEvent) {
  if (!e.valid) return;
  serverError.value = false;
  busy.value = true;
  try {
    await api.post('/auth/password/reset', {
      token,
      newPassword: e.values.newPassword,
    });
    await router.push({ name: 'login' });
  } catch {
    serverError.value = true;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AuthShell
    :title="state === 'invalid' ? $t('auth.resetPassword.invalidTitle') : $t('auth.resetPassword.title')"
    :subtitle="state === 'valid' ? $t('auth.resetPassword.subtitle') : undefined"
    icon="pi-lock"
  >
    <!-- verifying the token -->
    <div v-if="state === 'checking'" class="flex justify-center py-6">
      <ProgressSpinner style="width: 2.5rem; height: 2.5rem" strokeWidth="4" />
    </div>

    <!-- invalid / expired / already used -->
    <div v-else-if="state === 'invalid'" class="flex flex-col gap-4">
      <Message severity="warn" variant="simple">{{ $t('auth.resetPassword.invalidMessage') }}</Message>
      <Button
        :label="$t('auth.resetPassword.requestNew')"
        outlined
        fluid
        @click="router.push({ name: 'forgot-password' })"
      />
    </div>

    <!-- valid: choose a new password -->
    <Form
      v-else
      :resolver="resolver"
      :initialValues="initialValues"
      class="flex flex-col gap-5"
      @submit="onSubmit"
    >
      <FormField v-slot="$field" name="newPassword" class="flex flex-col gap-2">
        <label for="newPassword" class="text-sm font-medium text-color">
          {{ $t('auth.resetPassword.newPassword') }}
        </label>
        <Password input-id="newPassword" :feedback="false" toggle-mask fluid autocomplete="new-password" />
        <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">
          {{ $field.error?.message }}
        </Message>
      </FormField>

      <FormField v-slot="$field" name="confirmPassword" class="flex flex-col gap-2">
        <label for="confirmPassword" class="text-sm font-medium text-color">
          {{ $t('auth.resetPassword.confirmPassword') }}
        </label>
        <Password input-id="confirmPassword" :feedback="false" toggle-mask fluid autocomplete="new-password" />
        <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">
          {{ $field.error?.message }}
        </Message>
      </FormField>

      <Message v-if="serverError" severity="error" variant="simple">
        {{ $t('auth.resetPassword.error') }}
      </Message>

      <Button
        type="submit"
        :label="$t('auth.resetPassword.submit')"
        :loading="busy"
        class="mt-1"
        fluid
      />
    </Form>

    <template #footer>
      <RouterLink :to="{ name: 'login' }" class="text-primary hover:underline">
        {{ $t('auth.resetPassword.backToLogin') }}
      </RouterLink>
    </template>
  </AuthShell>
</template>
