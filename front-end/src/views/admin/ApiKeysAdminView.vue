<script setup lang="ts">
import { issueApiKeySchema } from '@erp/shared';
import { Form, FormField } from '@primevue/forms';
import { zodResolver } from '@primevue/forms/resolvers/zod';
import Button from 'primevue/button';
import Column from 'primevue/column';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFeedback } from '../../composables/useFeedback';
import PageHeader from '@/components/PageHeader.vue';
import PageToolbar from '@/components/PageToolbar.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import AppDataTable from '@/components/AppDataTable.vue';
import { useAuthStore } from '../../stores/auth';
import { useApiKeysStore } from '../../stores/apiKeys';
import type { ApiKeyView, IssuedApiKey } from '../../api/apiKeys';
import type { FormSubmitEvent } from '@primevue/forms';

const { t } = useI18n();
const fb = useFeedback();
const auth = useAuthStore();
const store = useApiKeysStore();
const can = (c: string) => auth.can(c);

const issueOpen = ref(false);
const issued = ref<IssuedApiKey | null>(null);
const revokeTarget = ref<ApiKeyView | null>(null);
const copied = ref(false);

const userOptions = computed(() =>
  store.eligibleUsers.map((u) => ({ label: u.username, value: u.id })),
);
const userName = (id: string) => store.eligibleUsers.find((u) => u.id === id)?.username ?? id;

const statusSeverity: Record<ApiKeyView['status'], string> = {
  active: 'success',
  revoked: 'danger',
  expired: 'warn',
};

function fmt(value: string | null): string {
  return value ? new Date(value).toLocaleString() : t('admin.apiKeys.never');
}

function openIssue() {
  issued.value = null;
  copied.value = false;
  store.loadEligibleUsers();
  issueOpen.value = true;
}

async function submit(e: FormSubmitEvent) {
  if (!e.valid) return;
  const result = await store.issueKey(e.values as never);
  if (result) {
    issueOpen.value = false;
    issued.value = result; // one-time reveal
    copied.value = false;
    fb.success(t('feedback.created'));
  } else {
    fb.error(store.error);
  }
}

async function copySecret() {
  if (!issued.value) return;
  await navigator.clipboard.writeText(issued.value.secret);
  copied.value = true;
}

async function confirmRevoke() {
  if (!revokeTarget.value) return;
  const ok = await store.revokeKey(revokeTarget.value.id);
  revokeTarget.value = null;
  if (ok) fb.success(t('feedback.updated'));
  else fb.error(store.error);
}

onMounted(() => store.loadKeys());
</script>

<template>
  <div>
    <PageHeader :title="$t('admin.apiKeys.title')" />
    <p class="mb-4 text-sm text-muted-color">{{ $t('admin.apiKeys.subtitle') }}</p>

    <ErrorState v-if="store.error && !store.keys.length" :message="store.error" @retry="store.loadKeys()" />

    <div v-else class="card">
      <PageToolbar>
        <template #actions>
          <Button
            v-if="can('API_KEY_MANAGE')"
            :label="$t('admin.apiKeys.newKey')"
            icon="pi pi-plus"
            size="small"
            @click="openIssue()"
          />
        </template>
      </PageToolbar>

      <AppDataTable
        :value="store.keys"
        :total="store.keys.length"
        :loading="store.loading"
        dataKey="id"
        @refresh="store.loadKeys()"
      >
        <Column field="name" :header="$t('admin.apiKeys.columns.name')" />
        <Column :header="$t('admin.apiKeys.columns.prefix')">
          <template #body="{ data }"><span class="font-mono">{{ data.prefix }}</span></template>
        </Column>
        <Column :header="$t('admin.apiKeys.columns.boundUser')">
          <template #body="{ data }">{{ userName(data.userId) }}</template>
        </Column>
        <Column :header="$t('admin.apiKeys.columns.status')">
          <template #body="{ data }">
            <Tag :value="$t(`admin.apiKeys.status.${data.status}`)" :severity="statusSeverity[data.status as ApiKeyView['status']]" />
          </template>
        </Column>
        <Column :header="$t('admin.apiKeys.columns.expires')">
          <template #body="{ data }"><span class="tabular-nums">{{ fmt(data.expiresAt) }}</span></template>
        </Column>
        <Column :header="$t('admin.apiKeys.columns.lastUsed')">
          <template #body="{ data }"><span class="tabular-nums">{{ fmt(data.lastUsedAt) }}</span></template>
        </Column>
        <Column header="">
          <template #body="{ data }">
            <Button
              v-if="can('API_KEY_MANAGE') && data.status === 'active'"
              :label="$t('admin.apiKeys.revoke.action')"
              icon="pi pi-ban"
              text
              severity="danger"
              size="small"
              @click="revokeTarget = data as ApiKeyView"
            />
          </template>
        </Column>
        <template #empty>
          <EmptyState icon="pi pi-key" :title="$t('admin.apiKeys.empty')" />
        </template>
      </AppDataTable>
    </div>

    <!-- Issue dialog -->
    <Dialog v-model:visible="issueOpen" :header="$t('admin.apiKeys.issueTitle')" modal class="w-96">
      <Form
        :resolver="zodResolver(issueApiKeySchema)"
        :initialValues="{ name: '', targetUserId: '', expiresAt: '' }"
        class="flex flex-col gap-3"
        @submit="submit"
      >
        <FormField v-slot="$f" name="name" class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('admin.apiKeys.fields.name') }}</label>
          <InputText type="text" :placeholder="$t('admin.apiKeys.fields.namePlaceholder')" />
          <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message>
        </FormField>
        <FormField v-slot="$f" name="targetUserId" class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('admin.apiKeys.fields.targetUser') }}</label>
          <Select :options="userOptions" optionLabel="label" optionValue="value" :placeholder="$t('admin.apiKeys.fields.selectUser')" filter />
          <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message>
        </FormField>
        <FormField v-slot="$f" name="expiresAt" class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('admin.apiKeys.fields.expiresAt') }}</label>
          <InputText type="date" />
          <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message>
        </FormField>
        <div class="flex justify-end gap-2">
          <Button :label="$t('common.cancel')" text @click="issueOpen = false" />
          <Button type="submit" :label="$t('admin.apiKeys.newKey')" />
        </div>
      </Form>
    </Dialog>

    <!-- One-time secret reveal -->
    <Dialog
      :visible="!!issued"
      :header="$t('admin.apiKeys.reveal.title')"
      modal
      class="w-[32rem]"
      :closable="false"
    >
      <Message severity="warn" class="mb-3">{{ $t('admin.apiKeys.reveal.warning') }}</Message>
      <div class="flex items-center gap-2">
        <InputText :modelValue="issued?.secret" readonly class="grow font-mono" />
        <Button
          :label="copied ? $t('admin.apiKeys.reveal.copied') : $t('admin.apiKeys.reveal.copy')"
          :icon="copied ? 'pi pi-check' : 'pi pi-copy'"
          size="small"
          @click="copySecret()"
        />
      </div>
      <template #footer>
        <Button :label="$t('admin.apiKeys.reveal.done')" @click="issued = null" />
      </template>
    </Dialog>

    <!-- Revoke confirm -->
    <Dialog
      :visible="!!revokeTarget"
      :header="$t('admin.apiKeys.revoke.confirmTitle')"
      modal
      class="w-96"
      @update:visible="(v: boolean) => { if (!v) revokeTarget = null; }"
    >
      <p class="text-sm">{{ $t('admin.apiKeys.revoke.confirmMessage') }}</p>
      <template #footer>
        <Button :label="$t('common.cancel')" text @click="revokeTarget = null" />
        <Button :label="$t('admin.apiKeys.revoke.action')" severity="danger" @click="confirmRevoke()" />
      </template>
    </Dialog>
  </div>
</template>
