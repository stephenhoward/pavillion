<script setup lang="ts">
import { useTranslation } from 'i18next-vue';
import NavItem from './nav-item.vue';
import type { NavigationItemWithState } from './types';

const { t } = useTranslation('system');

defineProps<{
  items: NavigationItemWithState[];
}>();
</script>

<template>
  <nav class="bottom-nav" :aria-label="t('navigation.mobile_label')">
    <ul class="bottom-nav__list">
      <li v-for="item in items" :key="item.id">
        <NavItem :item="item" variant="bottom" />
      </li>
    </ul>
  </nav>
</template>

<style scoped lang="scss">
@use '@/client/assets/style/mixins/breakpoints' as *;

.bottom-nav {
  display: flex;
  position: fixed;
  inset-inline: 0;
  inset-block-end: 0;
  height: calc(var(--pav-shell-bottom-nav-height) + var(--pav-shell-safe-area-bottom));
  padding-block-end: var(--pav-shell-safe-area-bottom);
  background-color: var(--pav-surface-secondary);
  border-block-start: 1px solid var(--pav-border-subtle);
  z-index: 100;

  @include pav-media(md) {
    display: none;
  }

  &__list {
    display: flex;
    flex-direction: row;
    justify-content: space-around;
    align-items: stretch;
    width: 100%;
    list-style: none;
    margin: 0;
    padding: var(--pav-space-2) var(--pav-space-4);
    gap: var(--pav-space-1);
  }
}
</style>
