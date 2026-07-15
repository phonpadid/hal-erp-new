<script setup lang="ts">
import Avatar from 'primevue/avatar';
import Button from 'primevue/button';
import DataView from 'primevue/dataview';
import SelectButton from 'primevue/selectbutton';
import Tag from 'primevue/tag';
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import PageToolbar from '@/components/PageToolbar.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import { useAuthStore } from '../../../stores/auth';
import { useOrgStore } from '../../../stores/org';
import type { Company } from '../../../api/org';

const auth = useAuthStore();
const org = useOrgStore();
const router = useRouter();
const can = (c: string) => auth.can(c);

const search = ref('');
// DataView layout: cards grid or single-column list; persisted so the choice sticks per browser.
const layout = ref<'grid' | 'list'>((localStorage.getItem('companiesLayout') as 'grid' | 'list') || 'grid');

// Client-side filter over the loaded page (code / TH name / EN name), mirroring the old table's global search.
const filteredCompanies = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return org.companies;
  return org.companies.filter((c) =>
    [c.code, c.nameTh, c.nameEn].some((v) => v?.toLowerCase().includes(q)),
  );
});

// Create/edit now live on a dedicated page (route) with illustrations — not a dialog.
function newCompany() {
  router.push({ name: 'company-new' });
}
function editCompany(c: Company) {
  router.push({ name: 'company-edit', params: { id: c.id } });
}

watch(layout, (v) => localStorage.setItem('companiesLayout', v));

function load() {
  org.loadCompanies();
  if (!org.currencies.length) org.loadCurrencies();
}
onMounted(load);
</script>

<template>
  <div>
    <PageHeader :title="$t('admin.org.tabs.companies')" />
    <PageToolbar :search="search" @update:search="search = $event">
      <template #actions>
        <Button v-if="can('COMPANY_MANAGE')" :label="$t('admin.org.newCompany')" icon="pi pi-plus" size="small" @click="newCompany" />
      </template>
    </PageToolbar>
    <ErrorState v-if="org.error" :message="org.error" @retry="org.loadCompanies()" />
    <div v-else class="card">
      <DataView
        :value="filteredCompanies"
        :layout="layout"
        dataKey="id"
        lazy
        :paginator="org.companiesTotal > org.companiesLimit"
        :rows="org.companiesLimit"
        :totalRecords="org.companiesTotal"
        :first="(org.companiesPage - 1) * org.companiesLimit"
        :loading="org.loading"
        @page="(e: any) => org.loadCompanies(e.page + 1, e.rows)"
      >
        <template #header>
          <div class="flex justify-end">
            <SelectButton v-model="layout" :options="['grid', 'list']" :allowEmpty="false" aria-label="Layout">
              <template #option="{ option }">
                <i :class="option === 'grid' ? 'pi pi-th-large' : 'pi pi-bars'" />
              </template>
            </SelectButton>
          </div>
        </template>

        <!-- Grid: one card per company -->
        <template #grid="{ items }">
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-1">
            <div
              v-for="c in (items as Company[])"
              :key="c.id"
              class="flex flex-col gap-3 rounded-xl border border-surface p-4 bg-surface-0 dark:bg-surface-900"
            >
              <div class="flex items-start gap-3">
                <Avatar :image="c.profileImageUrl ?? undefined" :icon="c.profileImageUrl ? undefined : 'pi pi-building'" shape="circle" size="large" />
                <div class="min-w-0 flex-1">
                  <div class="font-semibold truncate">{{ c.nameTh }}</div>
                  <div class="text-sm text-muted-color truncate">{{ c.nameEn || c.code }}</div>
                </div>
                <Button v-if="can('COMPANY_MANAGE')" icon="pi pi-pencil" text rounded size="small" @click="editCompany(c)" />
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <Tag :value="c.code" severity="secondary" />
                <Tag icon="pi pi-money-bill" :value="c.baseCurrency?.code ?? $t('common.none')" severity="info" />
                <Tag :value="c.isActive ? $t('common.yes') : $t('common.no')" :severity="c.isActive ? 'success' : 'secondary'" />
              </div>
            </div>
          </div>
        </template>

        <!-- List: one row per company -->
        <template #list="{ items }">
          <div class="flex flex-col">
            <div
              v-for="(c, i) in (items as Company[])"
              :key="c.id"
              class="flex items-center gap-4 p-4"
              :class="{ 'border-t border-surface': i !== 0 }"
            >
              <Avatar :image="c.profileImageUrl ?? undefined" :icon="c.profileImageUrl ? undefined : 'pi pi-building'" shape="circle" size="large" />
              <div class="min-w-0 flex-1">
                <div class="font-semibold truncate">{{ c.nameTh }}</div>
                <div class="text-sm text-muted-color truncate">{{ c.nameEn || c.code }}</div>
              </div>
              <Tag :value="c.code" severity="secondary" class="hidden sm:inline-flex" />
              <Tag icon="pi pi-money-bill" :value="c.baseCurrency?.code ?? $t('common.none')" severity="info" />
              <Tag :value="c.isActive ? $t('common.yes') : $t('common.no')" :severity="c.isActive ? 'success' : 'secondary'" />
              <Button v-if="can('COMPANY_MANAGE')" icon="pi pi-pencil" text rounded size="small" @click="editCompany(c)" />
            </div>
          </div>
        </template>

        <template #empty>
          <EmptyState icon="pi pi-building" :title="$t('admin.org.empty.companies')" />
        </template>
      </DataView>
    </div>
  </div>
</template>
