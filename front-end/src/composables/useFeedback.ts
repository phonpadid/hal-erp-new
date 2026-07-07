import { useToast } from 'primevue/usetoast';
import { useConfirm } from 'primevue/useconfirm';
import { useI18n } from 'vue-i18n';
import { messageOf } from '../utils/apiError';

/**
 * The single seam for action feedback (see web-app-layout "Action Feedback and
 * Confirmation"):
 *  - success(detail)        → success toast
 *  - error(e, fallback?)    → error toast (message extracted from the API response)
 *  - confirm({ message })   → ConfirmDialog used ONLY to guard a destructive action
 *
 * Errors are always toasts, never modal dialogs. Page-load (GET) failures keep their
 * inline ErrorState and do not go through here.
 */
export function useFeedback() {
  const toast = useToast();
  const confirmService = useConfirm();
  const { t } = useI18n();

  const success = (detail?: string, summary?: string) =>
    toast.add({
      severity: 'success',
      summary: summary ?? t('feedback.success'),
      detail,
      life: 3000,
    });

  const error = (e: unknown, fallback?: string) =>
    toast.add({
      severity: 'error',
      summary: t('feedback.error'),
      detail: messageOf(e, fallback ?? t('feedback.errorFallback')),
      life: 6000,
    });

  /** Resolves true if the user accepts the destructive action, false otherwise. */
  const confirm = (opts: {
    message: string;
    header?: string;
    acceptLabel?: string;
    rejectLabel?: string;
    /** PrimeVue severity for the accept button, e.g. 'danger'. */
    acceptSeverity?: string;
  }): Promise<boolean> =>
    new Promise((resolve) => {
      confirmService.require({
        message: opts.message,
        header: opts.header ?? t('feedback.confirmHeader'),
        icon: 'pi pi-exclamation-triangle',
        acceptLabel: opts.acceptLabel ?? t('common.confirm'),
        rejectLabel: opts.rejectLabel ?? t('common.cancel'),
        acceptProps: { severity: opts.acceptSeverity ?? 'danger' },
        rejectProps: { text: true, severity: 'secondary' },
        accept: () => resolve(true),
        reject: () => resolve(false),
        onHide: () => resolve(false),
      });
    });

  return { success, error, confirm };
}
