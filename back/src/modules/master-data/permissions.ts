/** Permission CODES for the master-data capability. */
export const MasterDataPermissions = {
  MASTER_VIEW: 'MASTER_VIEW',
  MASTER_MANAGE: 'MASTER_MANAGE',
  // Deliberately separate from MASTER_MANAGE: changing a vendor's payee bank account needs no
  // approval, leaves no document, and pays out on the next run — the classic ERP fraud vector.
  // Whoever may edit a vendor's phone number must not thereby be able to redirect its money.
  VENDOR_BANK_MANAGE: 'VENDOR_BANK_MANAGE',
} as const;
