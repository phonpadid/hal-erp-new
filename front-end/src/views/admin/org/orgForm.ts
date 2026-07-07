// Shared helpers for the organization admin pages (fiscal-year + holiday dialogs hold local
// Date models and validate against the shared Zod schema on submit — these keep that conversion
// and error-mapping identical across pages so client/server validation can't drift).

/** Local-date → 'YYYY-MM-DD' (no UTC shift). Empty string for a null date. */
export function toYmd(d: Date | null): string {
  if (!d) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** First Zod issue per top-level field, for inline messages. */
export function fieldErrors(issues: Array<{ path: Array<string | number>; message: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const k = String(i.path[0] ?? '');
    if (k && !out[k]) out[k] = i.message;
  }
  return out;
}
