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
    },
  },
  item: {
    new: 'New item',
    edit: 'Edit item',
    empty: 'No items.',
    columns: {
      code: 'Code',
      name: 'Name',
      unit: 'Unit',
      gl: 'GL',
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
