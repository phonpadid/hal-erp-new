import { onBeforeUnmount, onMounted, ref } from 'vue';

/**
 * Shared chart theming. Resolves colors from PrimeUI theme tokens at runtime (never hardcoded
 * hex) so the Aura preset and the `.dark` selector both render correctly, and bumps a reactive
 * `themeTick` when the root `class` changes (dark-mode toggle) to force re-resolution.
 * Extracted from the budget waterfall chart so every report chart stays theme-aware.
 */
export function useChartTheme() {
  const themeTick = ref(0);

  function cssVar(name: string, fallback = 'transparent'): string {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  let observer: MutationObserver | null = null;
  onMounted(() => {
    observer = new MutationObserver(() => {
      themeTick.value += 1;
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  });
  onBeforeUnmount(() => observer?.disconnect());

  /** Categorical palette from theme tokens — stable order, legible in light and dark. */
  function palette(): string[] {
    void themeTick.value;
    return [
      cssVar('--p-primary-color'),
      cssVar('--p-green-500'),
      cssVar('--p-orange-500'),
      cssVar('--p-cyan-500'),
      cssVar('--p-purple-500'),
      cssVar('--p-pink-500'),
      cssVar('--p-yellow-500'),
      cssVar('--p-red-500'),
      cssVar('--p-teal-500'),
      cssVar('--p-indigo-500'),
    ].filter((c) => c && c !== 'transparent');
  }

  const textColor = () => {
    void themeTick.value;
    return cssVar('--p-text-muted-color', cssVar('--p-text-color', ''));
  };
  const gridColor = () => {
    void themeTick.value;
    return cssVar('--p-content-border-color', 'transparent');
  };
  const primary = () => {
    void themeTick.value;
    return cssVar('--p-primary-color');
  };

  /**
   * Theme token for a PrimeVue severity, so a chart segment can match its status Tag color
   * (e.g. a REJECTED bar and its `danger` Tag are the same red). Hue-matched to the Aura Tag
   * severities; resolved at runtime so light/dark both stay correct.
   */
  const SEVERITY_TOKEN: Record<string, string> = {
    primary: '--p-primary-color',
    secondary: '--p-surface-400',
    success: '--p-green-500',
    info: '--p-blue-500',
    warn: '--p-orange-500',
    danger: '--p-red-500',
    contrast: '--p-text-color',
  };
  function severityColor(severity: string): string {
    void themeTick.value;
    return cssVar(SEVERITY_TOKEN[severity] ?? '--p-primary-color', cssVar('--p-primary-color'));
  }

  return { themeTick, cssVar, palette, textColor, gridColor, primary, severityColor };
}
