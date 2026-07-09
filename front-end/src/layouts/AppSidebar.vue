<script setup lang="ts">
import { useLayout } from "./composables/layout";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import Avatar from "primevue/avatar";
import AppMenu from "./AppMenu.vue";
import { useAuthStore } from "@/stores/auth";
import { useI18n } from "vue-i18n";

const { layoutState, isDesktop, hasOpenOverlay } = useLayout();
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const { t } = useI18n();

// Fall back to a friendly placeholder before /auth/me has resolved.
const displayName = computed(() => auth.displayName ?? auth.username ?? t("topbar.profile"));
const roleName = computed(() => auth.roleName ?? "");
// Initials for the avatar (fallback when there's no image); e.g. "Somchai Dee" -> "SD".
const initials = computed(() =>
  displayName.value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join(""),
);
// Show the uploaded 1:1 profile image when present; fall back to initials if it fails to load
// (e.g. a stale presigned URL). Reset the broken flag whenever the URL changes.
const imageBroken = ref(false);
watch(
  () => auth.profileImageUrl,
  () => (imageBroken.value = false),
);
const showImage = computed(() => !!auth.profileImageUrl && !imageBroken.value);

async function goToProfile() {
  await router.push({ name: "profile" });
}
const sidebarRef = ref<HTMLDivElement | null>(null);

let outsideClickListener: ((event: MouseEvent) => void) | null = null;

watch(
  () => route.path,
  (newPath) => {
    if (isDesktop()) layoutState.activePath = null;
    else layoutState.activePath = newPath;

    layoutState.overlayMenuActive = false;
    layoutState.mobileMenuActive = false;
    layoutState.menuHoverActive = false;
  },
  { immediate: true },
);

watch(hasOpenOverlay, (newVal) => {
  if (isDesktop()) {
    if (newVal) bindOutsideClickListener();
    else unbindOutsideClickListener();
  }
});
const bindOutsideClickListener = () => {
  if (!outsideClickListener) {
    outsideClickListener = (event: MouseEvent) => {
      if (isOutsideClicked(event)) {
        layoutState.overlayMenuActive = false;
      }
    };

    document.addEventListener("click", outsideClickListener);
  }
};

const unbindOutsideClickListener = () => {
  if (outsideClickListener) {
    document.removeEventListener("click", outsideClickListener);
    outsideClickListener = null;
  }
};

const isOutsideClicked = (event: MouseEvent): boolean => {
  const sidebarEl = sidebarRef.value;
  const topbarButtonEl = document.querySelector<HTMLElement>(
    ".layout-menu-button",
  );

  if (!sidebarEl) return false;

  return !(
    sidebarEl.isSameNode(event.target as Node) ||
    sidebarEl.contains(event.target as Node) ||
    topbarButtonEl?.isSameNode(event.target as Node) ||
    topbarButtonEl?.contains(event.target as Node)
  );
};

onBeforeUnmount(() => {
  unbindOutsideClickListener();
});
</script>

<template>
  <div ref="sidebarRef" class="layout-sidebar">
    <div class="layout-menu-scroll hide_scrollbar">
      <AppMenu />
    </div>

    <button
      type="button"
      class="layout-sidebar-profile relative overflow-hidden w-full border-0 bg-transparent flex items-center p-1.5 pl-3.5 hover:bg-surface-100 dark:hover:bg-surface-800 rounded-md cursor-pointer transition-colors duration-200"
      @click="goToProfile"
    >
      <Avatar
        :image="showImage ? (auth.profileImageUrl ?? undefined) : undefined"
        :label="!showImage ? (initials || undefined) : undefined"
        :icon="!showImage && !initials ? 'pi pi-user' : undefined"
        class="mr-2"
        shape="circle"
        @error="imageBroken = true"
      />
      <span class="inline-flex flex-col items-start min-w-0">
        <span class="text-sm font-bold truncate max-w-44">{{ displayName }}</span>
        <span v-if="roleName" class="text-xs truncate max-w-44">{{ roleName }}</span>
      </span>
    </button>
  </div>
</template>

<style scoped>
/* Turn the sidebar into a flex column: the menu scrolls, the profile stays pinned. */
.layout-sidebar {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.layout-menu-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

.layout-sidebar-profile {
  flex-shrink: 0;
  margin-top: 0.5rem;
  padding-top: 0.75rem;
  padding-bottom: 0.25rem;
  border-top: 1px solid var(--surface-border);
}
</style>
