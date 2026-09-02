import { describe, expect, it } from 'vitest';
import { NAV, NAV_SECTIONS, diffSetting, groupNav, visibleNav } from './layout.store';
import enNav from '../../i18n/locales/en/nav';
import laNav from '../../i18n/locales/la/nav';
import zhNav from '../../i18n/locales/zh/nav';
import { routes } from '../../router/routes';
import type { UserSettingDto } from '../types/setting.dto';

const base: UserSettingDto = {
  preset: 'Aura', primary: 'yellow', surface: 'stone', darkTheme: false, menuMode: 'static', locale: 'la',
};

describe('visibleNav (permission-gated menu)', () => {
  it('includes only entries whose permission the user holds', () => {
    const can = (c: string) => ['DOC_VIEW', 'BUDGET_VIEW'].includes(c);
    const tos = visibleNav(can).map((n) => n.to);
    expect(tos).toContain('/documents');
    expect(tos).toContain('/budgets');
    expect(tos).not.toContain('/rbac-admin'); // RBAC_MANAGE not held
    expect(tos).not.toContain('/doc-config');
  });

  it('shows everything to a full-access user and nothing to a no-grant user', () => {
    expect(visibleNav(() => true)).toHaveLength(NAV.length);
    expect(visibleNav(() => false)).toHaveLength(0);
  });
});

describe('groupNav (sectioned menu)', () => {
  it('groups visible entries into ordered sections', () => {
    const groups = groupNav(() => true);
    expect(groups.map((g) => g.section)).toEqual([...NAV_SECTIONS]);
    // every NAV entry lands in its section and nothing is dropped
    expect(groups.flatMap((g) => g.entries)).toHaveLength(NAV.length);
    expect(groups[0].entries.map((e) => e.to)).toContain('/documents');
  });

  it('omits a section when none of its entries are visible', () => {
    // workspace-only grant: no control/masterData/administration entries
    const can = (c: string) => c === 'DOC_VIEW';
    const groups = groupNav(can);
    expect(groups.map((g) => g.section)).toEqual(['workspace']);
    expect(groups).toHaveLength(1);
  });

  it('returns no sections for a no-grant user', () => {
    expect(groupNav(() => false)).toHaveLength(0);
  });
});

describe('NAV is reachable and readable', () => {
  it('has a label in every locale for every entry', () => {
    // A missing key renders the raw `apiKeys` in the sidebar rather than a word.
    for (const [locale, nav] of [['la', laNav], ['en', enNav], ['zh', zhNav]] as const) {
      const missing = NAV.filter((n) => !(n.key in nav)).map((n) => n.key);
      expect(missing, `${locale} is missing labels`).toEqual([]);
    }
  });

  it('points every entry at a declared route', () => {
    // The API-keys view shipped with a route and no sidebar entry; nobody could
    // reach it without typing the URL. This asserts the other direction — an
    // entry that points nowhere — so neither half can drift alone.
    const paths = new Set(
      routes
        .flatMap((r) => [r, ...((r.children ?? []) as typeof routes)])
        .map((r) => (r.path.startsWith('/') ? r.path : `/${r.path}`)),
    );

    const dangling = NAV.filter((n) => !paths.has(n.to)).map((n) => n.to);
    expect(dangling).toEqual([]);
  });
});

describe('diffSetting (partial PUT patch)', () => {
  it('returns only changed fields', () => {
    const patch = diffSetting({ ...base, primary: 'blue', darkTheme: true }, base);
    expect(patch).toEqual({ primary: 'blue', darkTheme: true });
  });

  it('returns empty when nothing changed', () => {
    expect(diffSetting({ ...base }, base)).toEqual({});
  });

  it('returns all fields when there is no baseline', () => {
    expect(Object.keys(diffSetting(base, null)).sort()).toEqual(
      ['darkTheme', 'locale', 'menuMode', 'preset', 'primary', 'surface'],
    );
  });

  it('coerces darkTheme to a real boolean', () => {
    const patch = diffSetting({ ...base, darkTheme: 1 as unknown as boolean }, base);
    expect(patch.darkTheme).toBe(true);
  });
});
