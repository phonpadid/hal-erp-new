import { computed, ref, watch, type Ref } from 'vue';
import { masterDataApi, type VendorBankAccount } from '../api/masterData';

/**
 * The payee bank account for a document: which of the vendor's accounts the money is transferred to.
 *
 * Chosen on the document rather than at payment time so the destination travels the same approval
 * steps as the amount — the approvers who approve the spend also approve where it goes, and nobody
 * can redirect it afterwards. The server enforces all of this at submit; this only shapes the
 * picker.
 */
export function usePayeeAccounts(vendorId: Ref<string>, enabled: Ref<boolean>) {
  const accounts = ref<VendorBankAccount[]>([]);
  const selectedId = ref<string>('');

  /**
   * Only ACTIVE accounts are selectable. A deactivated one stays readable — an approved document or
   * an exported batch naming it must still be legible — but must never be chosen again.
   */
  const options = computed(() =>
    accounts.value
      .filter((a) => a.isActive)
      .map((a) => ({
        // The account number is text: as a number its leading zeros vanish and it becomes a
        // different account.
        label: `${a.bankCode} · ${a.accountNo} — ${a.accountName}`,
        value: a.id,
      })),
  );

  /**
   * Load the vendor's accounts and preselect its primary.
   *
   * Always clears first: an account of the previous vendor would fail the server's submit gate, and
   * carrying it silently would mean a payee nobody chose. A load failure leaves the picker empty
   * rather than breaking the form — the server stays authoritative either way.
   */
  async function load(): Promise<void> {
    selectedId.value = '';
    accounts.value = [];
    if (!vendorId.value || !enabled.value) return;
    try {
      accounts.value = await masterDataApi.vendorBankAccounts.list(vendorId.value);
      selectedId.value = accounts.value.find((a) => a.isPrimary && a.isActive)?.id ?? '';
    } catch {
      accounts.value = [];
    }
  }

  watch(vendorId, load);

  return { accounts, selectedId, options, load };
}
