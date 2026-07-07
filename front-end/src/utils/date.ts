import dayjs from 'dayjs';
import 'dayjs/locale/lo';

// The app's active UI locale is Lao; format dates through this single helper so date
// rendering is consistent across pages (web-i18n: Locale-Aware Formatting).
dayjs.locale('lo');

/** Localized date, e.g. "ຈັນ 06-07-2026". Accepts a Date or ISO string. */
export const formatDate = (date: Date | string | null | undefined): string =>
  date ? dayjs(date).format('dddd DD-MM-YYYY') : '';

/** Localized date with time, e.g. "ຈັນ 06-07-2026 10:41". Accepts a Date or ISO string. */
export const formatDateTime = (date: Date | string | null | undefined): string =>
  date ? dayjs(date).format('dddd DD-MM-YYYY HH:mm') : '';
