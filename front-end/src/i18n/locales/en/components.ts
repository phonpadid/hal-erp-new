// Shared labels for the reusable page-component kit (toolbar, states, stepper, timeline).
export default {
  toolbar: {
    searchPlaceholder: 'Search…',
    searchEnterPlaceholder: 'Search, then press Enter…',
    clearFilters: 'Clear filters',
  },
  state: {
    emptyTitle: 'Nothing here yet',
    errorTitle: 'Something went wrong',
  },
  stepper: {
    next: 'Next',
  },
  timeline: {
    empty: 'No history yet',
  },
} as const;
