<template>
  <button
    type="button"
    class="doc-link"
    aria-haspopup="dialog"
    @click="show = true"
  >
    <BookOpenText :size="14" :stroke-width="1.5" aria-hidden="true" />
    <!-- Slot text is the button's accessible name; callers must provide it. -->
    <slot />
  </button>

  <HelpPanel
    v-if="show"
    :guides="[props.guide]"
    :audience="resolvedAudience"
    @close="show = false"
  />
</template>

<script setup lang="ts">
import { ref, computed, onMounted, useSlots } from 'vue';
import { useRoute } from 'vue-router';
import { BookOpenText } from 'lucide-vue-next';
import HelpPanel from '@/client/components/common/help-panel.vue';
import { audienceForRoute } from '@/client/service/docs';
import type { GuideRef, Audience } from '@/client/service/docs';

const props = defineProps<{
  guide: GuideRef;
  audience?: Audience;
}>();

const route = useRoute();
const show = ref(false);
const resolvedAudience = computed<Audience>(
  () => props.audience ?? audienceForRoute(route?.name),
);

const slots = useSlots();
onMounted(() => {
  if (import.meta.env.DEV && !slots.default) {
    console.warn('[DocLink] No slot content provided; the trigger button will have no accessible name.');
  }
});
</script>

<style scoped lang="scss">
.doc-link {
  display: inline-flex;
  align-items: center;
  gap: var(--pav-space-1);
  background: none;
  border: 0;
  padding: 0;
  margin: 0;
  cursor: pointer;
  font-family: inherit;
  font-size: var(--pav-font-size-sm);
  color: var(--pav-color-interactive-active-text);

  &:hover {
    text-decoration: underline;
  }

  &:focus-visible {
    outline: var(--pav-border-width-2) solid var(--pav-border-color-focus);
    outline-offset: var(--pav-space-0_5);
  }
}
</style>
