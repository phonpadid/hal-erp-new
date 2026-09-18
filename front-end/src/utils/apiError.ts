import { i18n } from '../i18n';

/**
 * Single rule for turning an API/Axios error into a human message. The backend returns
 * `{ message: string | string[] }` (class-validator produces arrays). Used by the
 * feedback seam and by stores that still surface an inline `error` for the page-load path.
 *
 * A refusal written for a person may also carry `messageKey` and `params` — the sentence it is,
 * and the facts it names. When this catalog knows the key (`errors.<key>`), the sentence is rendered
 * in the interface language with those facts; otherwise the server's English `message` is shown, so
 * a key added on the server before its translation lands still says something. Because this is the
 * one seam every error passes through, a key reaches every toast and inline message at once.
 */
export function messageOf(e: any, fallback = 'Request failed'): string {
  if (typeof e === 'string') return e || fallback;
  const data = e?.response?.data;
  const translated = translateKey(data?.messageKey, data?.params);
  if (translated) return translated;
  const m = data?.message;
  if (Array.isArray(m)) return m.join(', ');
  return m ?? fallback;
}

/** The catalog sentence for a server message key, or undefined when the client has none. */
function translateKey(key: unknown, params: unknown): string | undefined {
  if (typeof key !== 'string' || !key) return undefined;
  const path = `errors.${key}`;
  try {
    const { te, t } = i18n.global as unknown as {
      te: (k: string) => boolean;
      t: (k: string, p?: Record<string, unknown>) => string;
    };
    if (!te(path)) return undefined;
    return t(path, (params && typeof params === 'object' ? params : {}) as Record<string, unknown>);
  } catch {
    return undefined; // i18n not mounted (a bare unit test): the server's words are still there
  }
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
