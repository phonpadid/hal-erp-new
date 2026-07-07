// Locale-aware date and plain-number formats for vue-i18n's $d / $n.
// NOTE: money is NOT formatted here — amounts go through the currency `decimal_places`
// helper (utils/money.ts) and are never coerced to a JS number.

export const datetimeFormats = {
  en: {
    short: { year: 'numeric', month: 'short', day: 'numeric' },
    long: { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' },
  },
  la: {
    short: { year: 'numeric', month: 'short', day: 'numeric' },
    long: { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' },
  },
} as const;

export const numberFormats = {
  en: {
    decimal: { style: 'decimal', minimumFractionDigits: 0, maximumFractionDigits: 2 },
    integer: { style: 'decimal', maximumFractionDigits: 0 },
    percent: { style: 'percent', minimumFractionDigits: 0, maximumFractionDigits: 1 },
  },
  la: {
    decimal: { style: 'decimal', minimumFractionDigits: 0, maximumFractionDigits: 2 },
    integer: { style: 'decimal', maximumFractionDigits: 0 },
    percent: { style: 'percent', minimumFractionDigits: 0, maximumFractionDigits: 1 },
  },
} as const;
