/**
 * Single rule for turning an API/Axios error into a human message. The backend returns
 * `{ message: string | string[] }` (class-validator produces arrays). Used by the
 * feedback seam and by stores that still surface an inline `error` for the page-load path.
 */
export function messageOf(e: any, fallback = 'Request failed'): string {
  if (typeof e === 'string') return e || fallback;
  const m = e?.response?.data?.message;
  if (Array.isArray(m)) return m.join(', ');
  return m ?? fallback;
}

/**
 * The machine-readable code the backend attaches to failures a caller reacts to differently — e.g.
 * `PAYMENT_SLIP_REQUIRED`, where the answer is an upload control rather than an error toast.
 * Undefined for the ordinary failures, which carry only a status-derived code that is not a
 * contract.
 */
export function codeOf(e: any): string | undefined {
  const code = e?.response?.data?.code;
  return typeof code === 'string' ? code : undefined;
}
