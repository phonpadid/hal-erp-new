export default {
  list: {
    title: 'ໂກຕ້າ',
    subtitle: 'ກຸ່ມໂກຕ້າສຳລັບບໍລິສັດນີ້',
    columns: {
      type: 'ປະເພດ',
      unit: 'ຫົວໜ່ວຍ',
      department: 'ພະແນກ',
      limit: 'ຂີດຈຳກັດ',
      poolRemaining: 'ກຸ່ມທີ່ຍັງເຫຼືອ',
      reset: 'ຕັ້ງຄືນ',
    },
    empty: 'ບໍ່ມີໂກຕ້າສຳລັບບໍລິສັດນີ້.',
  },
  detail: {
    companyWide: 'ທົ່ວບໍລິສັດ',
    meta: '{department} · ຕັ້ງຄືນ {reset} · ຫົວໜ່ວຍ {unit}',
    pool: {
      title: 'ກຸ່ມ',
      limit: 'ຂີດຈຳກັດກຸ່ມ',
      used: '− ໃຊ້ແລ້ວ',
      remaining: 'ກຸ່ມທີ່ຍັງເຫຼືອ',
    },
    entitlements: {
      title: 'ສິດທິທີ່ໄດ້ຮັບ',
      columns: {
        employee: 'ພະນັກງານ',
        year: 'ປີ',
        entitled: 'ສິດທິທີ່ໄດ້ຮັບ',
        used: 'ໃຊ້ແລ້ວ',
        remaining: 'ຍັງເຫຼືອ',
      },
    },
    usage: {
      title: 'ບັນຊີການນຳໃຊ້',
      columns: {
        type: 'ປະເພດ',
        qty: 'ຈຳນວນ',
        employee: 'ພະນັກງານ',
        document: 'ເອກະສານ',
        at: 'ເວລາ',
      },
      empty: 'ຍັງບໍ່ມີລາຍການນຳໃຊ້.',
    },
  },
} as const;
