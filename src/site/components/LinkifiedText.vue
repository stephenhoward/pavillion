<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from 'i18next-vue';

import { linkifyText } from '@/common/utils/linkify';

const props = defineProps<{ text: string }>();

const { t } = useTranslation('system');

const segments = computed(() => linkifyText(props.text ?? ''));
</script>

<template>
  <!-- Segments are rendered without whitespace between them so the parent's white-space rule is unaffected. -->
  <span class="linkified-text"><template v-for="(segment, index) in segments" :key="index"><a v-if="segment.type === 'link'"
                                                                                              :href="segment.href"
                                                                                              target="_blank"
                                                                                              rel="noopener noreferrer nofollow ugc">{{ segment.text }}<span class="sr-only">, {{ t('opens_in_new_tab') }}</span></a><template v-else>{{ segment.text }}</template></template></span>
</template>

<style scoped lang="scss">
@use '@/common/ui/assets/mixins' as *;

// Styled here rather than by an app-wide `a` rule: the widget loads no
// such rule, and the site's colours links with the owner-configurable
// accent, which has no paired ink. The link inherits the text colour and
// keeps its underline, so it never relies on colour.
a {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 0.2em;

  &:hover,
  &:focus-visible {
    text-decoration-thickness: 2px;
  }
}

.sr-only {
  @include public-sr-only;
}
</style>
