import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent } from 'vue';
import { mount } from '@vue/test-utils';
import { useSearchTerm } from './useSearchTerm';

/** Mount the composable so `onUnmounted` has a component to hang off. */
function host(load: (term: string) => void) {
  const wrapper = mount(
    defineComponent({
      setup: () => useSearchTerm(load),
      render: () => null,
    }),
  );
  return { wrapper, vm: wrapper.vm as unknown as ReturnType<typeof useSearchTerm> };
}

describe('useSearchTerm', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows every keystroke immediately', () => {
    const load = vi.fn();
    const { vm } = host(load);
    vm.onSearch('c');
    vm.onSearch('ca');
    // The box must not lag the typist even though the request does.
    expect(vm.term).toBe('ca');
    expect(load).not.toHaveBeenCalled();
  });

  it('asks once, with the last term, after typing stops', () => {
    const load = vi.fn();
    const { vm } = host(load);
    for (const t of ['c', 'ca', 'cas', 'cash']) vm.onSearch(t);
    vi.advanceTimersByTime(250);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith('cash');
  });

  it('asks again when typing resumes after a pause', () => {
    const load = vi.fn();
    const { vm } = host(load);
    vm.onSearch('cash');
    vi.advanceTimersByTime(250);
    vm.onSearch('');
    vi.advanceTimersByTime(250);
    // Clearing the box is a search too — for the whole set.
    expect(load.mock.calls).toEqual([['cash'], ['']]);
  });

  it('drops a pending request when the screen goes away', () => {
    const load = vi.fn();
    const { wrapper, vm } = host(load);
    vm.onSearch('cash');
    wrapper.unmount();
    vi.advanceTimersByTime(1000);
    expect(load).not.toHaveBeenCalled();
  });
});
