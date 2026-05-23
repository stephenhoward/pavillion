<template>
  <section
    class="empty-state"
    :aria-labelledby="titleId"
  >
    <h2 :id="titleId">{{ props.title }}</h2>
    <p v-if="props.description">{{ props.description }}</p>
    <slot/>
    <a
      v-if="guideUrl"
      :href="guideUrl"
      target="_blank"
      rel="noopener noreferrer"
      class="empty-state__guide-link"
    >
      {{ guideLabel }}
      <ExternalLink :size="14" aria-hidden="true" />
    </a>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import { ExternalLink } from 'lucide-vue-next';
import { docsUrl } from '@/client/service/docs';
import type { GuideRef } from '@/client/service/docs';

const { t } = useTranslation('system', { keyPrefix: 'help' });

const props = defineProps<{
  title: string;
  description?: string;
  guide?: GuideRef;
}>();

const dialogId = Math.random().toString(36).substring(2, 11);
const titleId = computed(() => `empty-title-${dialogId}`);
const guideUrl = computed(() => props.guide ? docsUrl(props.guide.slug) : null);
const guideLabel = computed(() => props.guide ? t(`guides.${props.guide.key}.label`) : '');
</script>

<style scoped lang="scss">
.empty-state__guide-link {
  display: inline-flex;
  align-items: center;
  gap: var(--pav-space-1);
  margin-block-start: var(--pav-space-4);
  font-size: var(--pav-font-size-sm);
  color: var(--pav-color-brand-primary);
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }

  &:focus-visible {
    outline: var(--pav-border-width-2) solid var(--pav-border-color-focus);
    outline-offset: var(--pav-space-0_5);
  }
}
</style>
