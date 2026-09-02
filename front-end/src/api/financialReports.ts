import { api } from './client';

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';

export interface TrialBalanceAccount {
  accountId: string;
  code: string;
  name: string;
  accountType: AccountType;
  debit: string;
  credit: string;
  balance: string;
}
export interface TrialBalance {
  from?: string;
  to?: string;
  accounts: TrialBalanceAccount[];
  totalDebit: string;
  totalCredit: string;
  balanced: boolean;
}

export interface StatementRow {
  accountId: string;
  code: string;
  name: string;
  accountType: AccountType;
  amount: string;
}
export interface IncomeStatement {
  from?: string;
  to?: string;
  revenue: StatementRow[];
  expense: StatementRow[];
  revenueTotal: string;
  expenseTotal: string;
  netIncome: string;
}
export interface BalanceSheet {
  asOf?: string;
  assets: StatementRow[];
  liabilities: StatementRow[];
  equity: StatementRow[];
  assetsTotal: string;
  liabilitiesTotal: string;
  equityTotal: string;
  /** The CURRENT period's result (revenue − expense). Outside `equityTotal`, added to the total. */
  retainedEarnings: string;
  /**
   * What closed fiscal years rolled into the equity account. A balance, read from the account —
   * so it is ALREADY inside `equityTotal` and must never be added again. The two fields carry the
   * same name and opposite arithmetic; only this comment says which is which.
   */
  retainedEarningsBroughtForward: string;
  liabilitiesEquityTotal: string;
  balanced: boolean;
}

export interface LedgerLine {
  lineId: string;
  entryId: string;
  entryDate: string;
  sourceType: string;
  sourceId: string;
  sourceDocNo?: string | null;
  memo?: string | null;
  debit: string;
  credit: string;
  runningBalance: string;
}
export interface AccountLedger {
  accountId: string;
  account?: { id: string; code: string; name: string; accountType: AccountType } | null;
  lines: LedgerLine[];
  balance: string;
}

const range = (from?: string, to?: string) => ({ params: { from, to } });

export const financialReportsApi = {
  trialBalance: (from?: string, to?: string) =>
    api.get<TrialBalance>('/financial/trial-balance', range(from, to)).then((r) => r.data),
  incomeStatement: (from?: string, to?: string) =>
    api.get<IncomeStatement>('/financial/income-statement', range(from, to)).then((r) => r.data),
  balanceSheet: (asOf?: string) =>
    api.get<BalanceSheet>('/financial/balance-sheet', { params: { asOf } }).then((r) => r.data),
  accountLedger: (accountId: string, from?: string, to?: string) =>
    api.get<AccountLedger>(`/financial/ledger/${accountId}`, range(from, to)).then((r) => r.data),
};
