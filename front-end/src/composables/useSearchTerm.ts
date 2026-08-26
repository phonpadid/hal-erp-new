import { onUnmounted, ref } from 'vue';

/** How long typing has to stop before the term is sent. */
const QUIET_MS = 250;

/**
 * A search box whose term is answered by the server.
 *
 * Every list long enough to page is too long to filter on the client — the client holds one page,
 * so a client-side filter would search a fraction of the set while looking like it searched all of
 * it. So the term goes with the query, and this is what stands between the keyboard and the query:
 * it waits until typing stops before asking, so a nine-letter vendor name costs one request rather
 * than nine.
 *
 * The box stays fully responsive while it waits — `term` updates on every keystroke and is what the
 * input binds to. Only the request is delayed.
 */
export function useSearchTerm(load: (term: string) => void) {
  const term = ref('');
  let timer: ReturnType<typeof setTimeout> | undefined;

  function onSearch(value: string) {
    term.value = value;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      load(value);
    }, QUIET_MS);
  }

  // A pending request would land on a screen nobody is looking at, and its store write would be a
  // page of results the next visit did not ask for.
  onUnmounted(() => {
    if (timer) clearTimeout(timer);
  });

  return { term, onSearch };
}
