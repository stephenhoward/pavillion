<template>
  <div class="actions-menu" :class="`actions-menu--align-${align}`">
    <button
      ref="triggerEl"
      type="button"
      class="btn btn--icon actions-menu__trigger"
      :aria-label="triggerLabel"
      aria-haspopup="menu"
      :aria-expanded="isOpen"
      @click="toggle"
      @keydown.down.prevent="openAndFocusFirst"
      @keydown.up.prevent="openAndFocusLast"
    >
      <Menu :size="20" :stroke-width="1.5" aria-hidden="true" />
    </button>

    <ul
      v-if="isOpen"
      ref="panelEl"
      role="menu"
      class="actions-menu__panel"
      @keydown.down.prevent="focusNext"
      @keydown.up.prevent="focusPrev"
      @keydown.home.prevent="focusFirst"
      @keydown.end.prevent="focusLast"
      @keydown.tab="close"
    >
      <slot />
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, provide, onBeforeUnmount } from 'vue';
import { Menu } from 'lucide-vue-next';

withDefaults(defineProps<{
  triggerLabel: string;
  align?: 'start' | 'end';
}>(), {
  align: 'end',
});

const isOpen = ref(false);
const triggerEl = ref<HTMLButtonElement | null>(null);
const panelEl = ref<HTMLUListElement | null>(null);

function getItems(): HTMLElement[] {
  if (!panelEl.value) return [];
  return Array.from(panelEl.value.querySelectorAll<HTMLElement>('[role="menuitem"]'));
}

function focusAt(index: number) {
  const items = getItems();
  if (items.length === 0) return;
  const wrapped = (index + items.length) % items.length;
  items[wrapped].focus();
}

function focusFirst() { focusAt(0); }
function focusLast() { focusAt(-1); }

function focusNext() {
  const items = getItems();
  const current = items.findIndex((el) => el === document.activeElement);
  focusAt(current + 1);
}

function focusPrev() {
  const items = getItems();
  const current = items.findIndex((el) => el === document.activeElement);
  focusAt(current - 1);
}

async function open() {
  if (isOpen.value) return;
  isOpen.value = true;
  document.addEventListener('mousedown', handleOutsideMouseDown);
  document.addEventListener('keydown', handleDocumentKeyDown);
  await nextTick();
}

function close() {
  if (!isOpen.value) return;
  isOpen.value = false;
  document.removeEventListener('mousedown', handleOutsideMouseDown);
  document.removeEventListener('keydown', handleDocumentKeyDown);
  triggerEl.value?.focus();
}

function toggle() {
  if (isOpen.value) close();
  else open();
}

async function openAndFocusFirst() {
  await open();
  focusFirst();
}

async function openAndFocusLast() {
  await open();
  focusLast();
}

function handleOutsideMouseDown(event: MouseEvent) {
  const target = event.target as Node | null;
  if (!target) return;
  if (triggerEl.value?.contains(target)) return;
  if (panelEl.value?.contains(target)) return;
  close();
}

function handleDocumentKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
  }
}

provide('actions-menu-close', close);

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handleOutsideMouseDown);
  document.removeEventListener('keydown', handleDocumentKeyDown);
});
</script>

<style scoped lang="scss">
.actions-menu {
  position: relative;
  display: inline-block;
}

.actions-menu__panel {
  position: absolute;
  inset-block-start: calc(100% + var(--pav-space-1));
  min-width: 12rem;
  margin: 0;
  padding: var(--pav-space-1);
  list-style: none;
  background: var(--pav-surface-primary, var(--pav-color-surface-primary));
  border: var(--pav-border-width-1) solid var(--pav-border-primary, var(--pav-color-border-primary));
  border-radius: var(--pav-border-radius-md);
  box-shadow: var(--pav-shadow-modal, 0 8px 24px rgba(0, 0, 0, 0.12));
  z-index: 20;
}

.actions-menu--align-end .actions-menu__panel {
  inset-inline-end: 0;
}

.actions-menu--align-start .actions-menu__panel {
  inset-inline-start: 0;
}
</style>
