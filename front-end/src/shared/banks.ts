/**
 * Where a payee's money can be held — the banks, and the one wallet the company settles through.
 *
 * Code, not a table. The set of banks in a country is not per-company configuration: it changes
 * when a bank opens in Vientiane, and a `bank` table would cost a migration, an endpoint, a
 * permission code and a maintenance screen to hold ten rows whose logos already ship as static
 * assets under `public/banks/`.
 *
 * The server knows nothing about this list. Both bank fields stay what they are — a single string:
 * `bank_account.bank_name` carries a bank's NAME (it is shown as the bank on the accounts and
 * reconciliation screens), `vendor_bank_account.bank_code` carries its CODE (the uniqueness index
 * `(vendor_id, bank_code, account_no)` is built on it, and `payment_batch_line.bank_code`
 * snapshots it for the bank to read). Picking from one list is what stops `BCEL`, `bcel` and
 * `BCEL Bank` becoming three banks.
 */
export interface Bank {
  /** Short stable token. What `vendor_bank_account.bank_code` stores. */
  code: string;
  /** How the bank is normally named. What `bank_account.bank_name` stores. */
  name: string;
  /** The full legal name, for the second line of a picker option. */
  fullName: string;
  /** File under `public/banks/`. Resolved through the app's base by `bankLogoUrl`. */
  logoFile: string;
}

/**
 * One entry per logo in `public/banks/`. Add a bank by adding a PNG and a line here — the PNG
 * alone does nothing, because nothing scans the directory.
 *
 * `code` is not cosmetic. It is what `vendor_bank_account.bank_code` stores, what the uniqueness
 * index `(vendor_id, bank_code, account_no)` is built on, and what `payment_batch_line.bank_code`
 * snapshots for the receiving bank to read — so changing an existing one after accounts have been
 * recorded against it splits a vendor's accounts in two and alters a payment file. Add freely;
 * rename never.
 */
export const BANKS: readonly Bank[] = Object.freeze([
  { code: 'ACLEDA', name: 'ACLEDA Bank', fullName: 'ACLEDA Bank Lao Ltd', logoFile: 'acleda.png' },
  { code: 'BCEL', name: 'BCEL', fullName: 'Banque Pour Le Commerce Extérieur Lao Public', logoFile: 'bcel.png' },
  { code: 'BOC', name: 'Bank of China', fullName: 'Bank of China (中国银行)', logoFile: 'boc.png' },
  { code: 'ICBC', name: 'ICBC', fullName: 'Industrial and Commercial Bank of China (Lao) Ltd', logoFile: 'ICBC.png' },
  { code: 'INDOCHINA', name: 'Indochina Bank', fullName: 'Indochina Bank Ltd', logoFile: 'indochina.png' },
  { code: 'JDB', name: 'JDB Bank', fullName: 'Joint Development Bank', logoFile: 'jdb.png' },
  { code: 'KASIKORN', name: 'Kasikorn Bank', fullName: 'Kasikornthai Bank Ltd', logoFile: 'Kasikorn.png' },
  { code: 'LAOVIET', name: 'Lao-Viet Bank', fullName: 'Lao-Viet Bank Co., Ltd', logoFile: 'LAOVIET.png' },
  { code: 'LDB', name: 'Lao Development Bank', fullName: 'Lao Development Bank', logoFile: 'ldb.png' },
  { code: 'STB', name: 'ST Bank', fullName: 'ST Bank Ltd', logoFile: 'stb.png' },
  // Not a bank, and deliberately here anyway: the company settles some payables through WeChat
  // Pay, and a payee's destination has to be nameable in the one list every bank field picks from.
  // Leaving it out would not stop it being used — it would push it in as free text, which is the
  // `BCEL` / `bcel` / `BCEL Bank` problem this catalog exists to prevent.
  { code: 'WECHAT', name: 'WeChat Pay', fullName: 'WeChat Pay (Weixin Pay)', logoFile: 'wechat.png' },
] as const);

/**
 * Where a bank's logo actually lives.
 *
 * Vite rewrites a LITERAL `src="/banks/x.png"` to include the app's `base`, but not a bound `:src`
 * — and this SPA is served from `/new/`, so the bare path works in dev and 404s in production.
 */
export function bankLogoUrl(bank: Bank): string {
  return `${import.meta.env.BASE_URL}banks/${bank.logoFile}`;
}

/** Which field of a bank a form sends. `bank_account` sends the name, `vendor_bank_account` the code. */
export type BankKey = 'code' | 'name';

/** One row of a bank picker. `logo` is absent for a value the catalog does not know. */
export interface BankOptionItem {
  value: string;
  label: string;
  sublabel?: string;
  logo?: string;
}

export function findBank(key: BankKey, value: string): Bank | undefined {
  return BANKS.find((b) => b[key] === value);
}

/**
 * How a stored value reads in a LIST: the catalog's name and logo when it matches, the raw text
 * alone when it does not. No `fullName` here — a second line belongs in a picker being read one
 * option at a time, not in a table column.
 */
export function bankDisplay(key: BankKey, value?: string | null): { label: string; logo?: string } {
  const bank = value ? findBank(key, value) : undefined;
  return bank ? { label: bank.name, logo: bankLogoUrl(bank) } : { label: value ?? '—' };
}

/** Just the logo for a stored value — for a row that renders its own text. */
export function bankLogoFor(key: BankKey, value?: string | null): string | undefined {
  const bank = value ? findBank(key, value) : undefined;
  return bank ? bankLogoUrl(bank) : undefined;
}

/**
 * The catalog as picker options, keyed on the field the form sends.
 *
 * `current` is the value already stored on the record being edited. When it is non-empty and no
 * entry matches it, it is appended verbatim as a logo-less option — accounts were recorded before
 * this catalog existed, and a <Select> renders an out-of-options value as blank, so without this a
 * user opening an account to fix one digit would save it having silently changed bank. Adding a new
 * record passes no `current`, so the odd value is never offered where it could be chosen fresh.
 */
export function bankOptions(key: BankKey, current?: string): BankOptionItem[] {
  const options: BankOptionItem[] = BANKS.map((b) => ({
    value: b[key],
    label: b.name,
    sublabel: b.fullName === b.name ? undefined : b.fullName,
    logo: bankLogoUrl(b),
  }));
  // Verbatim, not trimmed: re-saving must send back exactly the string that was stored.
  if (current?.trim() && !findBank(key, current)) options.push({ value: current, label: current });
  return options;
}
