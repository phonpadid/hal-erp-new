/**
 * The condition of a list a control renders its choices from.
 *
 * A bare array cannot tell a screen why it is empty, and `.catch(() => [])` — which is how the
 * documents type filter came to say "No available options" over a populated list — turns a failed
 * read into a statement about the data. Anything a user picks from should carry this instead, so
 * the control can say "there is nothing to choose" and "I could not find out" as different things.
 */
export type LoadStatus = 'idle' | 'loading' | 'loaded' | 'failed';

export interface OptionList<T> {
  status: LoadStatus;
  items: T[];
}

export const emptyOptions = <T>(): OptionList<T> => ({ status: 'idle', items: [] });

/**
 * Run a read into an OptionList, keeping a failure as a failure. Mutates in place so a Pinia
 * state slot stays reactive.
 */
export async function loadOptions<T>(
  target: OptionList<T>,
  read: () => Promise<T[]>,
): Promise<void> {
  target.status = 'loading';
  try {
    target.items = await read();
    target.status = 'loaded';
  } catch {
    // The items from a previous successful read are dropped: showing stale choices under a
    // failure banner invites picking one that no longer exists.
    target.items = [];
    target.status = 'failed';
  }
}
