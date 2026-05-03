<script setup lang="ts">
import { computed, inject } from 'vue';
import { useRoute } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import i18next from 'i18next';
import { renderPolicyMarkdown } from '@/common/utils/render-markdown';

/**
 * InstancePolicy — public /policy page rendering the instance's community
 * guidelines / policy text.
 *
 * Reads the multilingual `instancePolicy` map from server settings and
 * resolves the displayed HTML via the standard fallback chain
 * (current language → instance default language → empty-fallback message).
 *
 * The stored value is markdown source (validated at save time by
 * `isPolicySourceSafe`). Rendering happens at view time via
 * `renderPolicyMarkdown`, which runs marked + DOMPurify with the closed
 * allowlist before the result is bound via `v-html`. DOMPurify in the
 * render path remains the authoritative defense against any markup that
 * would otherwise reach the DOM.
 *
 * The back link is contextual: a `?from=<source>` query (set by PolicyLink
 * at the call site) chooses the destination, falling back to settings for
 * authenticated visitors and login otherwise.
 */

const site_config = inject('site_config') as { settings: () => {
  instancePolicy?: Record<string, string>;
  defaultLanguage?: string;
} };

const authn = inject('authn') as { isLoggedIn?: () => boolean } | undefined;

const route = useRoute();

const { t } = useTranslation('policy');

const settings = computed(() => site_config.settings());

const policyHtml = computed<string>(() => {
  const policy = settings.value.instancePolicy;
  if (!policy || typeof policy !== 'object') {
    return `<p>${t('empty_fallback')}</p>`;
  }

  const currentLang = i18next.language;
  if (policy[currentLang]) {
    return renderPolicyMarkdown(policy[currentLang]);
  }

  const defaultLang = settings.value.defaultLanguage;
  if (defaultLang && policy[defaultLang]) {
    return renderPolicyMarkdown(policy[defaultLang]);
  }

  return `<p>${t('empty_fallback')}</p>`;
});

const backLink = computed<{ name: string; label: string }>(() => {
  const from = typeof route.query.from === 'string' ? route.query.from : '';

  switch (from) {
    case 'login':
      return { name: 'login', label: t('back_to_login') };
    case 'register':
      return { name: 'register', label: t('back_to_register') };
    case 'register-apply':
      return { name: 'register-apply', label: t('back_to_apply') };
    case 'settings':
      return { name: 'profile', label: t('back_to_settings') };
  }

  if (authn?.isLoggedIn?.()) {
    return { name: 'profile', label: t('back_to_settings') };
  }
  return { name: 'login', label: t('back_to_login') };
});
</script>

<template>
  <div class="welcome-card">
    <div class="welcome-card-main">
      <h2>{{ t('heading') }}</h2>

      <article class="policy-content"
               v-html="policyHtml" />

      <router-link class="forgot"
                   :to="{ name: backLink.name }">
        {{ backLink.label }}
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

  :deep(ul) {
    list-style: disc;
  }

  :deep(ol) {
    list-style: decimal;
  }

  :deep(li) {
    margin-block-end: var(--pav-space-2);
  }
}
</style>
