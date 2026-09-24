import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import type { VueWrapper } from '@vue/test-utils';
import { mountView } from '../test/mountView';
import LoginView from './LoginView.vue';

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
});

/**
 * The login page is public and its source ships to every visitor, so it must carry no account.
 * It once opened with a real username and password already filled in — readable by anyone who
 * loaded the page, on every deployed server.
 */
describe('login page', () => {
  it('opens with the username and password empty', async () => {
    wrapper = await mountView(LoginView, { path: '/login', routeName: 'login' });
    await flushPromises();
    const username = wrapper.find('input#username').element as HTMLInputElement;
    const password = wrapper.find('input#password').element as HTMLInputElement;
    expect(username.value).toBe('');
    expect(password.value).toBe('');
  });
});
