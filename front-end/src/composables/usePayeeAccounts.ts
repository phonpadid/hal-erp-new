import { computed, ref, watch, type Ref } from 'vue';
import { masterDataApi, type VendorBankAccount } from '../api/masterData';

/** What a payee account label is drawn from; `currency` is the ISO code the API serializes it as. */
export interface PayeeAccountLike {
  bankCode: string;
  accountNo: string;
  accountName: string;
  currency?: string | { code?: string } | null;
}

/**
 * How a payee account reads wherever it is shown: `BCEL · 1651218657309 (USD) — Xone Sengphosy`.
 *
 * The currency sits right after the number, not at the end: one payee often holds a LAK and a USD
 * account at the same bank under the same name, and the currency is the only thing telling them
 * apart — at the end it was cut off in the closed picker. An account with no currency recorded
 * reads as before.
 */
export function payeeAccountLabel(a: PayeeAccountLike): string {
  const currency = typeof a.currency === 'string' ? a.currency : a.currency?.code;
  // The account number is text: as a number its leading zeros vanish and it becomes a different
  // account.
  return `${a.bankCode} · ${a.accountNo}${currency ? ` (${currency})` : ''} — ${a.accountName}`;
}

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
      .map((a) => ({ label: payeeAccountLabel(a), value: a.id })),
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
