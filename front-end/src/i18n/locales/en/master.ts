export default {
  title: 'Master data',
  tabs: {
    vendors: 'Vendors',
    items: 'Items',
  },
  vendor: {
    new: 'New vendor',
    edit: 'Edit vendor',
    empty: 'No vendors.',
    columns: {
      code: 'Code',
      name: 'Name',
      paymentTermDays: 'Terms (days)',
      enabled: 'Enabled here',
      bankAccount: 'Bank account',
    },
    bank: {
      manage: 'Bank accounts',
      title: 'Bank accounts — {vendor}',
      groupWide: 'Bank accounts belong to the vendor itself, so every company in the group sees the same ones.',
      none: 'No account',
      noneHint: 'This vendor has no active bank account, so a disbursement for it cannot be submitted.',
      new: 'Add account',
      edit: 'Edit account',
      account: 'Account',
      bankCode: 'Bank',
      pickBank: 'Select a bank',
      pickCurrency: 'Select a currency',
      accountNo: 'Account number',
      accountName: 'Account name',
      currency: 'Currency',
      primary: 'Primary',
      inactive: 'Inactive',
      makePrimary: 'Make primary',
      deactivate: 'Deactivate',
      deactivateBody: 'Deactivate account {accountNo}? It cannot be reactivated from here, and documents that already name it are unaffected.',
      deactivatePrimaryWarning:
        'This is the vendor’s primary account. Deactivating it leaves the vendor with none, and the next disbursement raised for it will preselect no payee.',
      duplicate: 'This vendor already has account {accountNo} at {bankCode}.',
      empty: 'No bank accounts',
      emptyHint: 'A disbursement for this vendor cannot be submitted until it has an account.',
      history: 'Change history',
      historyEmpty: 'No changes recorded.',
      actions: {
        CREATE: 'Added',
        UPDATE: 'Edited',
        SET_PRIMARY: 'Made primary',
        DEACTIVATE: 'Deactivated',
      },
    },
  },
  item: {
    new: 'New item',
    edit: 'Edit item',
    empty: 'No items.',
    budgetPlaceholder: 'Choose a budget',
    budgetFilterPlaceholder: 'Search budgets',
    // True under every scope: a department-scoped registrar is offered their own department's
    // budgets plus the shared ones, so an empty list means none of THOSE — not that the year is empty.
    budgetEmpty: 'No budget you can bind to in the open fiscal year.',
    // A plan code the open fiscal year no longer carries — a line retired at year-end. Kept
    // selectable so a bound item never reads as unbound.
    budgetOutsideYear: '{code} (not in the open year)',
    // Bound by someone who could see a budget this registrar cannot — it exists, it is simply
    // another department's. Kept selectable for the same reason.
    budgetOtherDepartment: "{name} (another department's budget)",
    // Money the company holds in common, beside the department's own.
    budgetShared: 'Shared',
    // Enabled before an item could name a budget: it holds only the account it posts to.
    budgetUnbound: 'Account {code} — no budget',
    columns: {
      code: 'Code',
      name: 'Name',
      unit: 'Unit',
      budget: 'Budget (this company)',
      enabled: 'Enabled here',
    },
  },
  fields: {
    code: 'Code',
    name: 'Name',
    unit: 'Default unit',
    gl: 'Default GL account',
    active: 'Active',
  },
} as const;
