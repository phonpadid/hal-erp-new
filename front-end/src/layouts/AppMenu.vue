<script setup lang="ts">
import AppMenuItem from "./AppMenuItem.vue";
import { useLayoutStore } from "./store/layout.store";
const layoutStore = useLayoutStore();
</script>

<template>
  <ul class="layout-menu">
    <template v-for="(item, i) in layoutStore.model" :key="item">
      <app-menu-item
        v-if="!item.separator"
        :item="item"
        :index="i"
        :root="true"
        :parentPath="null"
      ></app-menu-item>
      <li v-if="item.separator" class="menu-separator"></li>
    </template>
  </ul>
</template>

<style lang="scss" scoped></style>
