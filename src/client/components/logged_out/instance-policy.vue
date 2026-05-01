<script setup lang="ts">
import { computed, inject } from 'vue';
import { useTranslation } from 'i18next-vue';
import i18next from 'i18next';
import { sanitizePolicyHtml } from '@/common/utils/render-markdown';

/**
 * InstancePolicy — public /policy page rendering the instance's community
 * guidelines / policy text.
 *
 * Reads the multilingual `instancePolicy` map from server settings and
 * resolves the displayed HTML via the standard fallback chain
 * (current language → instance default language → empty-fallback message).
 *
 * Defense-in-depth: even though the stored value is already sanitized at
 * save time by `renderPolicyMarkdown`, we re-run `sanitizePolicyHtml` here
 * with the identical allowlist before binding via `v-html`. This guarantees
 * that any future storage-layer bypass cannot reach the DOM.
 */

const site_config = inject('site_config') as { settings: () => {
  instancePolicy?: Record<string, string>;
  defaultLanguage?: string;
} };

const { t } = useTranslation('policy');

const settings = computed(() => site_config.settings());

const policyHtml = computed<string>(() => {
  const policy = settings.value.instancePolicy;
  if (!policy || typeof policy !== 'object') {
    return `<p>${t('empty_fallback')}</p>`;
  }

  const currentLang = i18next.language;
  if (policy[currentLang]) {
    return sanitizePolicyHtml(policy[currentLang]);
  }

  const defaultLang = settings.value.defaultLanguage;
  if (defaultLang && policy[defaultLang]) {
    return sanitizePolicyHtml(policy[defaultLang]);
  }

  return `<p>${t('empty_fallback')}</p>`;
});
</script>

<template>
  <div class="welcome-card">
    <div class="welcome-card-main">
      <h2>{{ t('heading') }}</h2>

      <article class="policy-content"
               v-html="policyHtml" />

      <router-link class="forgot"
                   :to="{ name: 'login' }">
        {{ t('back_to_login') }}
      </router-link>
    </div>
  </div>
</template>

<style scoped lang="scss">
.policy-content {
  margin-block-start: var(--pav-space-4);
  line-height: 1.6;

  :deep(h1),
  :deep(h2),
  :deep(h3),
  :deep(h4),
  :deep(h5),
  :deep(h6) {
    margin-block-start: var(--pav-space-6);
    margin-block-end: var(--pav-space-2);
  }

  :deep(p) {
    margin-block-end: var(--pav-space-4);
  }

  :deep(ul),
  :deep(ol) {
    margin-block-end: var(--pav-space-4);
    padding-inline-start: var(--pav-space-6);
  }
}
</style>
