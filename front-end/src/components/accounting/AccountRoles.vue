<script setup lang="ts">
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Message from 'primevue/message';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ErrorState from '@/components/ErrorState.vue';
import { useFeedback } from '../../composables/useFeedback';
import { useAuthStore } from '../../stores/auth';
import { accountRolesApi, type AccountRoleMapping } from '../../api/accountRoles';
import { accountsApi, type SelectableAccount } from '../../api/accounts';

/**
 * Which account plays each system role: the clearing account, input VAT, FX gain and loss.
 *
 * Shown ON the chart-of-accounts screen, not on one of its own. A role mapping is a fact ABOUT the
 * chart — which of these accounts is the clearing account — so it belongs beside the accounts it
 * names, under the same permission, rather than as a second place in the menu to remember.
 *
 * The general ledger resolves these by role, and until now nothing in the product could record one —
 * a company could build its whole chart of accounts here and still have every payment posting fail,
 * with the reason visible only on the undelivered-postings screen nobody visits until the ledger has
 * been empty for months.
 *
 * Roles this company's own configuration needs are marked, and the rest are left quiet. A checklist
 * that asks for fourteen accounts nobody needs is one people learn to skim.
 */
const { t } = useI18n();
const fb = useFeedback();
const auth = useAuthStore();
const canManage = computed(() => auth.can('COA_MANAGE'));

const roles = ref<AccountRoleMapping[]>([]);
const accounts = ref<SelectableAccount[]>([]);
const loading = ref(true);
const error = ref('');
const saving = ref<string | null>(null);

/** Required and pointing at nothing — the rows that will fail a posting today. */
const missing = computed(() => roles.value.filter((r) => r.required && !r.account));

async function load() {
  loading.value = true;
  error.value = '';
  try {
    roles.value = await accountRolesApi.list();
    // Active and postable only: the server refuses anything else, and offering it would teach
    // people that the screen lies.
    if (canManage.value) accounts.value = await accountsApi.selectable();
  } catch (e) {
    error.value = t('gl.accountRoles.loadFailed');
  } finally {
    loading.value = false;
  }
}

async function choose(role: AccountRoleMapping, accountId: string | null) {
  if (!accountId || accountId === role.account?.id) return;
  saving.value = role.role;
  try {
    const updated = await accountRolesApi.set(role.role, accountId);
    // Replace from the SERVER's answer, not from what was picked: the row then shows what is
    // stored rather than what was clicked.
    roles.value = roles.value.map((r) => (r.role === updated.role ? updated : r));
    fb.success(t('gl.accountRoles.saved'));
  } catch (e) {
    fb.error(e, t('gl.accountRoles.saveFailed'));
  } finally {
    saving.value = null;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="mb-3">
      <h2 class="text-lg font-semibold text-color">{{ $t('gl.accountRoles.title') }}</h2>
      <p class="text-sm text-muted-color">{{ $t('gl.accountRoles.subtitle') }}</p>
    </div>

    <ErrorState v-if="error && !roles.length" :message="error" @retry="load()" />

    <template v-else>
      <!-- Said once, loudly, before the table: this is the state in which nothing posts. -->
      <Message
        v-if="missing.length"
        severity="warn"
        class="mb-3"
        data-testid="roles-missing-banner"
      >
        {{ $t('gl.accountRoles.missingWarning', { count: missing.length }) }}
      </Message>

      <div class="card">
        <DataTable :value="roles" dataKey="role" class="text-sm" :loading="loading">
          <Column :header="$t('gl.accountRoles.columns.role')" style="min-width:16rem">
            <template #body="{ data }">
              <div class="flex flex-col gap-1">
                <span class="font-medium text-color">{{ data.role }}</span>
                <!-- The purpose, because `GRNI` names nothing to whoever must choose for it. -->
                <span class="text-xs text-muted-color">{{ data.purpose }}</span>
              </div>
            </template>
          </Column>

          <Column :header="$t('gl.accountRoles.columns.needed')" style="width:9rem">
            <template #body="{ data }">
              <Tag
                v-if="data.required && !data.account"
                severity="danger"
                :value="$t('gl.accountRoles.missing')"
                data-testid="role-missing"
              />
              <Tag
                v-else-if="data.required"
                severity="success"
                :value="$t('gl.accountRoles.required')"
                data-testid="role-required"
              />
              <span v-else class="text-xs text-muted-color" data-testid="role-not-required">
                {{ $t('gl.accountRoles.notRequired') }}
              </span>
            </template>
          </Column>

          <Column :header="$t('gl.accountRoles.columns.account')" style="min-width:18rem">
            <template #body="{ data }">
              <Select
                v-if="canManage"
                :modelValue="data.account?.id ?? null"
                :options="accounts"
                optionLabel="code"
                optionValue="id"
                :placeholder="$t('gl.accountRoles.choose')"
                :loading="saving === data.role"
                filter
                class="w-full"
                :data-testid="`role-select-${data.role}`"
                @update:modelValue="(v: string) => choose(data, v)"
              >
                <template #value>
                  <span v-if="data.account">{{ data.account.code }} · {{ data.account.name }}</span>
                  <span v-else class="text-muted-color">{{ $t('gl.accountRoles.choose') }}</span>
                </template>
                <template #option="{ option }">{{ option.code }} · {{ option.name }}</template>
              </Select>
              <!-- Readable without COA_MANAGE, and offering nothing to change. -->
              <span v-else-if="data.account" data-testid="role-account">
                {{ data.account.code }} · {{ data.account.name }}
              </span>
              <span v-else class="text-muted-color">—</span>
            </template>
          </Column>
        </DataTable>
      </div>

      <!-- Where the accounts themselves come from. This screen records which of them plays which
           part; it deliberately does not create any. -->
      <p class="mt-3 text-xs text-muted-color">{{ $t('gl.accountRoles.accountsHint') }}</p>
    </template>
  </div>
</template>
