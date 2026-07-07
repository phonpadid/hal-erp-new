import DOMPurify from 'dompurify';

/**
 * Sanitize an HTML string before it is rendered with `v-html`. Rich-text fields (the PrimeVue
 * Editor) store an HTML fragment; rendering it verbatim would let a pasted/crafted value run
 * scripts (`<script>`, `onerror=`, `javascript:` URLs, etc.). DOMPurify strips that to a safe
 * subset while keeping the formatting the editor produces (headings, lists, links, bold…).
 *
 * Use only for values that are meant to be HTML. Plain-text fields must stay as text (no
 * v-html) so any markup in them is shown literally, not interpreted.
 */
export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return '';
  return DOMPurify.sanitize(html, {
    // Forbid script-bearing elements outright (DOMPurify already drops these by default; listed
    // explicitly so the intent — and invariant — is visible).
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'style'],
    // Links may open elsewhere; keep target/rel safe.
    ADD_ATTR: ['target'],
  });
}
