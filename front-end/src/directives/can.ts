import { useAuthStore } from '../stores/auth';
import type { Directive, DirectiveBinding } from 'vue';

/**
 * v-can="'DOC_PR_APPROVE'" — hides the element unless the active company grants
 * the permission code. UX-only; the server still enforces authorization.
 */
function apply(el: HTMLElement, binding: DirectiveBinding<string>) {
  const auth = useAuthStore();
  el.style.display = auth.can(binding.value) ? '' : 'none';
}

export const can: Directive<HTMLElement, string> = {
  mounted: apply,
  updated: apply,
};
