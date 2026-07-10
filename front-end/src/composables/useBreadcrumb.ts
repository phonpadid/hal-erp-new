import { onUnmounted, ref, toValue, watch, type MaybeRefOrGetter } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import { NAV } from '@/layouts/store/layout.store';
import type { BreadcrumbCrumb } from '@/router/routes';

/**
 * One crumb a page contributes at runtime (e.g. a document number or record name).
 * `to` makes it a link; omit it for a plain (usually the current/leaf) crumb.
 */
export interface DynamicCrumb {
  label: string;
  to?: RouteLocationRaw;
}

/** A resolved breadcrumb item consumed by AppBreadcrumb's PrimeVue template. */
export interface TrailItem {
  label?: string;
  icon?: string;
  to?: RouteLocationRaw;
  /** True for the final, non-link crumb (the current page). */
  current?: boolean;
}

export interface BuiltBreadcrumb {
  home: TrailItem;
  model: TrailItem[];
}

// Module-level so the single AppBreadcrumb in the shell and any page that calls
// useBreadcrumb() share one source of dynamic crumbs.
const dynamicCrumbs = ref<DynamicCrumb[]>([]);
// The page instance that last set the crumbs; used so a leaving page never clears
// crumbs a newly-mounted page has already set (mount-before-unmount ordering).
let currentOwner: symbol | null = null;

/** Reactive dynamic crumbs, read by AppBreadcrumb. */
export function useDynamicCrumbs() {
  return dynamicCrumbs;
}

/**
 * Let a detail/dynamic page contribute the trailing breadcrumb crumb(s) (e.g. a
 * document number). The crumbs auto-clear when the page unmounts so they never
 * leak into the next page. Pass a getter/ref for values that resolve after load.
 */
export function useBreadcrumb(source: MaybeRefOrGetter<DynamicCrumb[]>): void {
  const mySym = Symbol('breadcrumb-owner');
  const stop = watch(
    () => toValue(source),
    (v) => {
      dynamicCrumbs.value = v ?? [];
      currentOwner = mySym;
    },
    { immediate: true, deep: true },
  );
  onUnmounted(() => {
    stop();
    if (currentOwner === mySym) {
      dynamicCrumbs.value = [];
      currentOwner = null;
    }
  });
}

const navByKey = (key: string) => NAV.find((n) => n.key === key);
const navByPath = (path: string) => NAV.find((n) => n.to === path);

/**
 * Pure breadcrumb trail builder — derives `home` + `model` from the active route's
 * matched path, its `meta.breadcrumb`, the permission-gated NAV table, and any
 * dynamic crumbs. Kept free of Vue reactivity so it is unit-testable in isolation.
 *
 * - `home` always links to the Dashboard (`/`).
 * - A route that is itself a NAV entry yields `Section → Entry(leaf)`.
 * - Otherwise `meta.breadcrumb` supplies the ancestor chain (nav refs reuse the NAV
 *   label/link/permission), and the dynamic crumbs form the leaf.
 * - An ancestor links only when its permission is granted (UX only; server authoritative).
 * - The final crumb is always the non-link current page.
 * - The Dashboard root (`/`) yields an empty model so no redundant single crumb shows.
 */
export function buildBreadcrumbTrail(opts: {
  recordPath: string;
  meta?: BreadcrumbCrumb[];
  can: (code: string) => boolean;
  t: (key: string) => string;
  dynamic?: DynamicCrumb[];
}): BuiltBreadcrumb {
  const { recordPath, meta, can, t, dynamic = [] } = opts;
  const home: TrailItem = { icon: 'pi pi-home', to: '/' };

  if (recordPath === '/') return { home, model: [] };

  const model: TrailItem[] = [];
  let sectionKey: string | undefined;
  const ancestors: { label: string; to?: string; linkable: boolean }[] = [];
  let selfLeafLabel: string | undefined;

  if (meta && meta.length) {
    for (const item of meta) {
      if ('nav' in item) {
        const n = navByKey(item.nav);
        if (!n) continue;
        sectionKey ??= n.section;
        ancestors.push({ label: t(`nav.${n.key}`), to: n.to, linkable: can(n.permission) });
      } else {
        ancestors.push({
          label: t(item.labelKey),
          to: item.to,
          linkable: item.permission ? can(item.permission) : true,
        });
      }
    }
  } else {
    const n = navByPath(recordPath);
    if (n) {
      sectionKey = n.section;
      selfLeafLabel = t(`nav.${n.key}`);
    }
  }

  if (sectionKey) model.push({ label: t(`nav.sections.${sectionKey}`) }); // section header: never a link
  for (const a of ancestors) model.push({ label: a.label, to: a.linkable ? a.to : undefined });
  if (selfLeafLabel) model.push({ label: selfLeafLabel });
  for (const d of dynamic) model.push({ label: d.label, to: d.to });

  const last = model[model.length - 1];
  if (last) {
    last.to = undefined;
    last.current = true;
  }
  return { home, model };
}
