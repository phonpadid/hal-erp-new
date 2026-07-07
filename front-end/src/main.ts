import Aura from "@primeuix/themes/aura";
import { createPinia } from "pinia";
import PrimeVue from "primevue/config";
import ToastService from "primevue/toastservice";
import ConfirmationService from "primevue/confirmationservice";
import StyleClass from "primevue/styleclass";
import Tooltip from "primevue/tooltip";
import { createApp } from "vue";
import App from "./App.vue";
import { can } from "./directives/can";
import { i18n } from "./i18n";
import router from "./router";
import { useAuthStore } from "./stores/auth";
import { useLayoutStore } from "./layouts/store/layout.store";
import { applyAppTheme } from "./layouts/composables/useTheme";
import "primeicons/primeicons.css";
import "./style.css";
import "./styles/layout/layout.scss";

const app = createApp(App);

const pinia = createPinia();
app.use(pinia);
app.use(i18n);
app.use(PrimeVue, {
  // Styled mode, Aura preset, dark mode toggled by the `.dark` class.
  theme: {
    preset: Aura,
    options: { darkModeSelector: ".dark" },
  },
});
app.use(ToastService);
app.use(ConfirmationService);

// Apply the default brand theme (primary/surface/dark) before the first paint, so
// pre-login pages like the login screen show the brand palette instead of the
// Aura default (green). User-specific settings still override this after login.
applyAppTheme(useLayoutStore(pinia).layoutConfig);

app.directive("can", can);
app.directive("styleclass", StyleClass);
app.directive("tooltip", Tooltip);

// Restore a persisted session (validates the token via /auth/me) before routing,
// so the first navigation guard sees the real auth state.
useAuthStore(pinia)
  .restore()
  .finally(() => {
    app.use(router);
    app.mount("#app");
  });
