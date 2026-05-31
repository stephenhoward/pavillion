<template>
  <section
    class="empty-state"
    :aria-labelledby="titleId"
  >
    <h2 :id="titleId">{{ props.title }}</h2>
    <p v-if="props.description">{{ props.description }}</p>
    <slot/>
    <div v-if="props.guide" class="empty-state__doc-link">
      <DocLink :guide="props.guide">
        {{ props.guideLabel ?? t(`guides.${props.guide.key}.label`) }}
      </DocLink>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import DocLink from '@/client/components/common/doc-link.vue';
import type { GuideRef } from '@/client/service/docs';

const { t } = useTranslation('system', { keyPrefix: 'help' });

const props = defineProps<{
  title: string;
  description?: string;
  guide?: GuideRef;
  guideLabel?: string;
}>();

const dialogId = Math.random().toString(36).substring(2, 11);
const titleId = computed(() => `empty-title-${dialogId}`);
</script>

<style scoped lang="scss">
.empty-state__doc-link {
  margin-block-start: var(--pav-space-4);
}
</style>
