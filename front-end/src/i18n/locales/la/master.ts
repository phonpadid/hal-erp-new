export default {
  title: 'ຂໍ້ມູນຫຼັກ',
  tabs: {
    vendors: 'ຜູ້ສະໜອງ',
    items: 'ລາຍການ',
  },
  vendor: {
    new: 'ເພີ່ມຜູ້ສະໜອງ',
    edit: 'ແກ້ໄຂຜູ້ສະໜອງ',
    empty: 'ບໍ່ມີຜູ້ສະໜອງ.',
    columns: {
      code: 'ລະຫັດ',
      name: 'ຊື່',
      paymentTermDays: 'ເງື່ອນໄຂ (ມື້)',
      enabled: 'ເປີດໃຊ້ທີ່ນີ້',
    },
  },
  item: {
    new: 'ເພີ່ມລາຍການ',
    edit: 'ແກ້ໄຂລາຍການ',
    empty: 'ບໍ່ມີລາຍການ.',
    columns: {
      code: 'ລະຫັດ',
      name: 'ຊື່',
      unit: 'ໜ່ວຍ',
      gl: 'ບັນຊີ GL',
      enabled: 'ເປີດໃຊ້ທີ່ນີ້',
    },
  },
  fields: {
    code: 'ລະຫັດ',
    name: 'ຊື່',
    unit: 'ໜ່ວຍເລີ່ມຕົ້ນ',
    gl: 'ບັນຊີ GL ເລີ່ມຕົ້ນ',
    active: 'ເປີດໃຊ້ງານ',
  },
} as const;
