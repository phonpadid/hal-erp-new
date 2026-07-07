// ປ້າຍຊື່ສຳລັບຊຸດອົງປະກອບໜ້າທີ່ໃຊ້ຮ່ວມກັນ (toolbar, states, stepper, timeline).
export default {
  toolbar: {
    searchPlaceholder: 'ຄົ້ນຫາ…',
    clearFilters: 'ລ້າງຕົວກອງ',
  },
  state: {
    emptyTitle: 'ຍັງບໍ່ມີຂໍ້ມູນ',
    errorTitle: 'ມີບາງຢ່າງຜິດພາດ',
  },
  stepper: {
    next: 'ຕໍ່ໄປ',
  },
  timeline: {
    empty: 'ຍັງບໍ່ມີປະຫວັດ',
  },
} as const;
