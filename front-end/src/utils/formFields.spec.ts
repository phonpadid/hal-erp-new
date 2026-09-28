import { describe, expect, it } from 'vitest';
import Quill from 'quill';
import { EDITOR_MODULES, fieldComponent } from './formFields';

/** The `list autofill` prefixes a real Quill ends up with, built with the editor's options. */
function autofillPrefixes(): RegExp[] {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const quill = new Quill(host, { modules: EDITOR_MODULES });
  const bindings = (quill.getModule('keyboard') as any).bindings[' '] as Array<{ prefix?: RegExp; handler?: unknown }>;
  host.remove();
  // Only the list binding matches a prefix on a space, and it must keep Quill's own handler.
  const list = bindings.filter((b) => b.prefix);
  for (const b of list) expect(typeof b.handler).toBe('function');
  return list.map((b) => b.prefix!);
}

describe('the rich editor', () => {
  it('passes its Quill options to every rich field', () => {
    expect(fieldComponent('text').props.modules).toBe(EDITOR_MODULES);
  });

  it('keeps a typed dash as a dash — `- ` no longer starts a bullet list', () => {
    const prefixes = autofillPrefixes();
    expect(prefixes.length).toBeGreaterThan(0);
    expect(prefixes.some((p) => p.test('-'))).toBe(false);
  });

  it('still starts a list from `1.` and `*`', () => {
    const prefixes = autofillPrefixes();
    expect(prefixes.some((p) => p.test('1.'))).toBe(true);
    expect(prefixes.some((p) => p.test('*'))).toBe(true);
  });
});
