<template>
  <component
    :is="labelled ? 'section' : 'div'"
    class="ui-empty-state"
    :aria-labelledby="labelled ? headingId : undefined"
  >
    <component
      :is="props.headingLevel"
      v-if="props.heading"
      :id="labelled ? headingId : undefined"
      class="ui-empty-state__heading"
    >
      {{ props.heading }}
    </component>
    <slot />
  </component>
</template>

<script setup lang="ts">
/**
 * A centred "nothing to show" block: an optional heading over caller-supplied
 * body copy. Shared by the site, the widget and the client, so it takes its
 * text from props and slot and its colours from --pav-* tokens — each app's
 * theme decides how it looks, and no dark-mode rule is needed here.
 *
 * It is landmark-free by default. `region` opts in to a `<section>` labelled
 * by the heading, for a caller whose empty state stands in for a page region.
 */
import { computed, useId } from 'vue';

const props = withDefaults(defineProps<{
  heading?: string;
  headingLevel?: 'h2' | 'h3' | 'h4';
  region?: boolean;
}>(), {
  heading: undefined,
  headingLevel: 'h2',
  region: false,
});

const headingId = useId();
const labelled = computed(() => props.region && Boolean(props.heading));
</script>

<style scoped lang="scss">
// Spacing and type sizes are plain rem values: the shared runtime token set
// (TOKENS.md) carries colours and shadows only.
.ui-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 3rem 1.5rem;
  color: var(--pav-text-secondary);

  // `color: inherit` keeps body copy on the muted tone above against an app's
  // global paragraph colour (the site sets one).
  :slotted(p) {
    margin: 0;
    line-height: 1.6;
    color: inherit;
  }
}

.ui-empty-state__heading {
  margin: 0 0 0.5rem;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--pav-text-primary);
}
</style>
