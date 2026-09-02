export default {
  title: 'ລໍຖ້າການອະນຸມັດຂອງຂ້ອຍ',
  columns: {
    docNo: 'ເລກທີ່ເອກະສານ',
    type: 'ປະເພດ',
    requester: 'ຜູ້ສະເໜີ',
    baseTotal: 'ຍອດລວມສະກຸນຫຼັກ',
    step: 'ຂັ້ນຕອນ',
    submitted: 'ສົ່ງເມື່ອ',
    sla: 'ກຳນົດເວລາ',
  },
  empty: 'ບໍ່ມີລາຍການລໍຖ້າການອະນຸມັດຂອງທ່ານ.',
  overdue: 'ເກີນກຳນົດ',
  dueBy: 'ກຳນົດ',
} as const;
