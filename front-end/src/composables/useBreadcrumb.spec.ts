import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { buildBreadcrumbTrail, useBreadcrumb, useDynamicCrumbs } from './useBreadcrumb';
import { routes } from '@/router/routes';

// Identity translator so assertions read against the i18n key, not a localized string.
const t = (k: string) => k;
const grantAll = () => true;

describe('buildBreadcrumbTrail', () => {
  it('returns an empty model for the dashboard root (no redundant single crumb)', () => {
    const { home, model } = buildBreadcrumbTrail({ recordPath: '/', can: grantAll, t });
    expect(home.to).toBe('/');
    expect(model).toHaveLength(0);
  });

  it('derives Section → Entry(leaf) for a NAV-entry list route', () => {
    const { model } = buildBreadcrumbTrail({ recordPath: '/documents', can: grantAll, t });
    expect(model.map((m) => m.label)).toEqual(['nav.sections.workspace', 'nav.documents']);
    // Section header is never a link; the entry is the current (non-link) leaf.
    expect(model[0].to).toBeUndefined();
    expect(model[1].to).toBeUndefined();
    expect(model[1].current).toBe(true);
  });

  it('builds ancestor link + dynamic leaf for a detail route via meta.breadcrumb', () => {
    const { model } = buildBreadcrumbTrail({
      recordPath: '/documents/:id',
      meta: [{ nav: 'documents' }],
      can: grantAll,
      t,
      dynamic: [{ label: 'PR-2026-001' }],
    });
    expect(model.map((m) => m.label)).toEqual([
      'nav.sections.workspace',
      'nav.documents',
      'PR-2026-001',
    ]);
    // Documents is a real link; the dynamic leaf is the current page.
    expect(model[1].to).toBe('/documents');
    expect(model[2].to).toBeUndefined();
    expect(model[2].current).toBe(true);
  });

  it('renders an explicit-crumb route (profile) with no section and a leaf', () => {
    const { model } = buildBreadcrumbTrail({
      recordPath: '/profile',
      meta: [{ labelKey: 'breadcrumb.profile' }],
      can: grantAll,
      t,
    });
    expect(model.map((m) => m.label)).toEqual(['breadcrumb.profile']);
    expect(model[0].current).toBe(true);
  });
});

describe('buildBreadcrumbTrail — permission gating', () => {
  it('makes an ancestor a link only when its permission is granted', () => {
    const opts = {
      recordPath: '/documents/:id',
      meta: [{ nav: 'documents' as const }] as never,
      t,
      dynamic: [{ label: 'PR-1' }],
    };
    const granted = buildBreadcrumbTrail({ ...opts, can: (c) => c === 'DOC_VIEW' });
    expect(granted.model[1].to).toBe('/documents'); // linkable

    const denied = buildBreadcrumbTrail({ ...opts, can: () => false });
    expect(denied.model[1].to).toBeUndefined(); // non-link text
    expect(denied.model[1].label).toBe('nav.documents'); // label still shown
  });
});

describe('router breadcrumb coverage', () => {
  // The in-app pages are the children of the AppLayout ('/') record; their paths are
  // relative, so the absolute record path is '/' + child.path (home's '' → '/').
  const appLayout = routes.find((r) => r.path === '/');
  const inAppRoutes = (appLayout?.children ?? []).filter(
    (c) => !('redirect' in c) && !!c.component,
  );

  it('every authenticated in-app route resolves to a non-empty, current-terminated trail', () => {
    // Sanity: the child list actually contains the app pages.
    expect(inAppRoutes.length).toBeGreaterThan(20);

    for (const c of inAppRoutes) {
      const recordPath = `/${c.path}`;
      const { model } = buildBreadcrumbTrail({
        recordPath,
        meta: c.meta?.breadcrumb,
        can: grantAll,
        t,
      });
      if (recordPath === '/') {
        expect(model, 'dashboard root has no crumb').toHaveLength(0);
        continue;
      }
      expect(model.length, `route ${recordPath} has an empty breadcrumb (missing meta.breadcrumb?)`).toBeGreaterThan(0);
      expect(model[model.length - 1].current, `route ${recordPath} leaf not marked current`).toBe(true);
      expect(model[model.length - 1].to, `route ${recordPath} leaf must not be a link`).toBeUndefined();
    }
  });
});

describe('useBreadcrumb (dynamic crumbs)', () => {
  const makeHost = (crumbLabel: string) =>
    defineComponent({
      setup() {
        useBreadcrumb(() => [{ label: crumbLabel }]);
        return () => h('div');
      },
    });

  it('sets dynamic crumbs on mount and clears them on unmount (no leak)', async () => {
    const crumbs = useDynamicCrumbs();
    const wrapper = mount(makeHost('DETAIL-A'));
    await nextTick();
    expect(crumbs.value).toEqual([{ label: 'DETAIL-A' }]);

    wrapper.unmount();
    await nextTick();
    expect(crumbs.value).toEqual([]);
  });

  it('a newly-mounted owner keeps its crumbs when the previous page unmounts after it', async () => {
    const crumbs = useDynamicCrumbs();
    const a = mount(makeHost('DETAIL-A'));
    await nextTick();
    const b = mount(makeHost('DETAIL-B'));
    await nextTick();
    expect(crumbs.value).toEqual([{ label: 'DETAIL-B' }]);

    // A leaves after B took ownership — B's crumbs must survive.
    a.unmount();
    await nextTick();
    expect(crumbs.value).toEqual([{ label: 'DETAIL-B' }]);

    b.unmount();
  });
});
