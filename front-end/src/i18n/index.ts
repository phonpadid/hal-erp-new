import { createI18n } from 'vue-i18n';
import en from './locales/en';
import la from './locales/la';
import { datetimeFormats, numberFormats } from './formats';

/**
 * App-wide i18n. Catalogs are namespaced per feature area (see ./locales/<locale>/).
 * `la` (Lao) is the default; `en` is the fallback so a missing key never renders blank.
 * The active locale is part of the per-user setting and is auto-saved by the layout store.
 */
export const i18n = createI18n({
  legacy: false,
  locale: 'la',
  fallbackLocale: 'en',
  // both catalogs are key-complete (enforced by i18n.parity.spec.ts)
  messages: { en, la },
  datetimeFormats: datetimeFormats as never,
  numberFormats: numberFormats as never,
});
