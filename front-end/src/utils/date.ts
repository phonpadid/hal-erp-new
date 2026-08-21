import dayjs from 'dayjs';
import 'dayjs/locale/lo';
import 'dayjs/locale/zh-cn';
import { i18n } from '../i18n';

/**
 * Dates follow the language the reader chose, resolved at CALL time.
 *
 * This file used to run `dayjs.locale('lo')` once at import, on the reasoning that the app's locale
 * is Lao. It has three now, and the switch in the header changed every label on the page except the
 * dates — an English screen reporting `ພຸດ 19-08-2026`. Setting it per call is what makes the
 * helper follow the switch; reading `i18n.global.locale` inside the function also makes every
 * rendered date a reactive dependency of it, so a change re-renders rather than going stale.
 *
 * Only the locale changes. The pattern stays `dddd DD-MM-YYYY` in every language — a day-month-year
 * order the customer's own paperwork uses, which is not a thing to localise away.
 */
const DAYJS_LOCALES: Record<string, string> = { en: 'en', la: 'lo', zh: 'zh-cn' };

const activeLocale = (): string => {
  const ui = (i18n.global.locale as unknown as { value?: string }).value
    ?? (i18n.global.locale as unknown as string);
  return DAYJS_LOCALES[ui as string] ?? 'en';
};

/** Localized date, e.g. "Wednesday 19-08-2026" / "ພຸດ 19-08-2026". Accepts a Date or ISO string. */
export const formatDate = (date: Date | string | null | undefined): string =>
  date ? dayjs(date).locale(activeLocale()).format('dddd DD-MM-YYYY') : '';

/** Localized date with time. Accepts a Date or ISO string. */
export const formatDateTime = (date: Date | string | null | undefined): string =>
  date ? dayjs(date).locale(activeLocale()).format('dddd DD-MM-YYYY HH:mm') : '';
