<template>
  <Sheet :title="t('panel_title')" @close="emit('close')">
    <p class="help-panel__intro">{{ t('panel_intro') }}</p>

    <ul class="help-panel__guides" role="list">
      <li v-for="guide in props.guides" :key="guide.key" class="help-panel__guide">
        <a
          :href="docsUrl(guide.slug)"
          target="_blank"
          rel="noopener noreferrer"
          class="help-panel__link"
        >
          <span class="help-panel__label">{{ t(`guides.${guide.key}.label`) }}</span>
          <span class="help-panel__description">{{ t(`guides.${guide.key}.description`) }}</span>
          <span class="help-panel__read-more">
            {{ t('open_in_docs') }}
            <ExternalLink :size="14" aria-hidden="true" />
          </span>
        </a>
      </li>
    </ul>

    <footer class="help-panel__footer">
      <a
        :href="browseAllUrl(props.audience)"
        target="_blank"
        rel="noopener noreferrer"
        class="help-panel__browse-all"
      >
        {{ t(`browse_all_${props.audience}`) }}
        <ExternalLink :size="14" aria-hidden="true" />
      </a>
    </footer>
  </Sheet>
</template>

<script setup lang="ts">
import { useTranslation } from 'i18next-vue';
import { ExternalLink } from 'lucide-vue-next';
import Sheet from '@/client/components/common/Sheet.vue';
import { docsUrl, browseAllUrl } from '@/client/service/docs';
import type { GuideRef, Audience } from '@/client/service/docs';

const { t } = useTranslation('system', { keyPrefix: 'help' });

const props = defineProps<{
  guides: GuideRef[];
  audience: Audience;
}>();

const emit = defineEmits<{
  close: [];
}>();
</script>

<style scoped lang="scss">
.help-panel__intro {
  font-size: var(--pav-font-size-sm);
  color: var(--pav-text-secondary);
  margin: 0 0 var(--pav-space-4);
}

.help-panel__guides {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-2);
}

.help-panel__link {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-1);
  padding: var(--pav-space-3);
  border-radius: var(--pav-border-radius-md);
  text-decoration: none;
  color: inherit;
  transition: background-color 0.15s ease;

  &:hover {
    background-color: var(--pav-interactive-hover);
  }

  &:focus-visible {
    outline: var(--pav-border-width-2) solid var(--pav-border-color-focus);
    outline-offset: var(--pav-space-0_5);
  }
}

.help-panel__label {
  font-weight: var(--pav-font-weight-medium);
  color: var(--pav-text-primary);
}

.help-panel__description {
  font-size: var(--pav-font-size-sm);
  color: var(--pav-text-secondary);
  line-height: var(--pav-line-height-body);
}

.help-panel__read-more {
  display: inline-flex;
  align-items: center;
  gap: var(--pav-space-1);
  font-size: var(--pav-font-size-xs);
  color: var(--pav-color-brand-primary);
  margin-block-start: var(--pav-space-1);
}

.help-panel__footer {
  margin-block-start: var(--pav-space-4);
  padding-block-start: var(--pav-space-4);
  border-block-start: var(--pav-border-width-1) solid var(--pav-border-primary);
}

.help-panel__browse-all {
  display: inline-flex;
  align-items: center;
  gap: var(--pav-space-1);
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
