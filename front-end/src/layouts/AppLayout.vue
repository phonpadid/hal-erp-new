<script setup lang="ts">
import { useLayout } from "./composables/layout";
import { useLayoutStore } from "./store/layout.store";
import { computed, onMounted } from "vue";
import Toast from "primevue/toast";
import ConfirmDialog from "primevue/confirmdialog";
import AppBreadcrumb from "./AppBreadcrumb.vue";
import AppFooter from "./AppFooter.vue";
import AppSidebar from "./AppSidebar.vue";
import AppTopbar from "./AppTopbar.vue";
import { useApprovalsStore } from "@/stores/approvals";
import { useAuthStore } from "@/stores/auth";

const { layoutConfig, layoutState, hideMobileMenu } = useLayout();

// Load the signed-in user's saved theme + locale and apply it (falls back to
// defaults if the API is unavailable); subsequent changes auto-save in the store.
const layoutStore = useLayoutStore();
const auth = useAuthStore();
const approvals = useApprovalsStore();
onMounted(() => {
  layoutStore.loadUserSetting();
  // Prime the Approvals sidebar badge without waiting for the user to open the inbox.
  if (auth.can("DOC_APPROVE")) approvals.loadPending().catch(() => undefined);
});

const containerClass = computed(() => {
  return {
    "layout-overlay": layoutConfig.menuMode === "overlay",
    "layout-static": layoutConfig.menuMode === "static",
    "layout-overlay-active": layoutState.overlayMenuActive,
    "layout-mobile-active": layoutState.mobileMenuActive,
    "layout-static-inactive": layoutState.staticMenuInactive,
  };
});
</script>

<template>
  <div class="layout-wrapper" :class="containerClass">
    <AppTopbar />
    <AppSidebar />
    <div class="layout-main-container">
      <div class="layout-main">
        <AppBreadcrumb />
        <router-view />
      </div>
      <AppFooter />
    </div>
    <div class="layout-mask animate-fadein" @click="hideMobileMenu" />
  </div>
  <Toast />
  <ConfirmDialog />
</template>
