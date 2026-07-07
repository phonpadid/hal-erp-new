export default {
  title: 'ພ້ອມຈ່າຍ',
  columns: {
    docNo: 'ເລກທີ່ເອກະສານ',
    vendor: 'ຜູ້ຂາຍ',
    amount: 'ມູນຄ່າ',
    gl: 'ບັນຊີ GL',
    action: 'ການກະທຳ',
  },
  empty: 'ບໍ່ມີລາຍການພ້ອມຈ່າຍ.',
  record: {
    action: 'ບັນທຶກການຈ່າຍ',
    actualRate: 'ອັດຕາແລກປ່ຽນຈິງ',
    confirm: 'ບັນທຶກ',
    done: 'ບັນທຶກການຈ່າຍແລ້ວ',
    baseActual: 'ຍອດສະກຸນຫຼັກທີ່ຈ່າຍ',
    fx: 'ຜົນຕ່າງອັດຕາ',
    wht: 'ອາກອນ WHT',
    noWht: 'ບໍ່ມີ WHT',
    whtAmount: 'WHT ທີ່ຫัກ',
    netPaid: 'ຈ່າຍສຸດທິໃຫ້ຜູ້ຂາຍ',
    kind: {
      GAIN: 'ກຳໄລ',
      LOSS: 'ຂາດທຶນ',
      NONE: 'ບໍ່ມີຜົນຕ່າງ',
    },
  },
} as const;
