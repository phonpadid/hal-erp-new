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
