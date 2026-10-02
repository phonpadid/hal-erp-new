import { computed, ref, watch } from 'vue';
import { orgApi, READINESS_CODES, type FiscalYearReadiness } from '../../api/org';
import { useAuthStore } from '../../stores/auth';

/**
 * The readiness read, for whoever prepares a fiscal year. Shared by the fiscal-years panel and the
 * shell banner so both say the same thing. UX only: the server gates the read on the same three
 * codes, and refuses budget documents on its own whatever this shows.
 */
export function useFiscalYearReadiness() {
  const auth = useAuthStore();
  const data = ref<FiscalYearReadiness | null>(null);
  const loading = ref(false);
  const canRead = computed(() => READINESS_CODES.some((c) => auth.can(c)));

  async function load() {
    if (!canRead.value || !auth.activeCompanyId) {
      data.value = null;
      return;
    }
    loading.value = true;
    try {
      data.value = await orgApi.fiscalYears.readiness();
    } catch {
      // A readiness hint that fails to load is not worth an error on every page.
      data.value = null;
    } finally {
      loading.value = false;
    }
  }

  // Another company has another year.
  watch(() => auth.activeCompanyId, () => void load());

  /** Inside the 30-day window and not ready, or the year has already turned unprepared. */
  const needsAttention = computed(
    () => !!data.value && (!!data.value.blockedNow || (data.value.inWindow && !data.value.ready)),
  );

  return { data, loading, canRead, needsAttention, load };
}
