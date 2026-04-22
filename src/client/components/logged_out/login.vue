<script setup lang="ts">
import { inject, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import i18next from 'i18next';
import LoginForm from './LoginForm.vue';

const router = useRouter();
const route = useRoute();
const site_config = inject('site_config') as any;
const { t } = useTranslation('authentication', {
  keyPrefix: 'login',
});

const settings = computed(() => site_config.settings());

const initialEmail = computed(() =>
  typeof route.query.email === 'string' ? route.query.email : undefined,
);

const infoDescription = computed(() => {
  const desc = settings.value.instanceDescription as Record<string, string> | undefined;
  if (!desc || typeof desc !== 'object') {
    return t('info_panel.default_description');
  }

  const currentLang = i18next.language;
  if (desc[currentLang]) {
    return desc[currentLang];
  }

  const defaultLang = settings.value.defaultLanguage;
  if (defaultLang && desc[defaultLang]) {
    return desc[defaultLang];
  }

  return t('info_panel.default_description');
});

const siteTitle = computed(() => settings.value.siteTitle || '');

function onLoginSuccess() {
  router.push('/calendar');
}
</script>

<template>
  <div class="welcome-card">
    <LoginForm :initial-email="initialEmail" @success="onLoginSuccess" />

    <aside class="welcome-card-info"
           :aria-label="t('info_panel.welcome') + ' ' + siteTitle">
      <h3 v-if="siteTitle">{{ t('info_panel.welcome') }} {{ siteTitle }}</h3>

      <p>{{ infoDescription }}</p>

      <p>
        <i18next :translation="t('info_panel.powered_by')">
          <template #1>
            <a href="https://pavillion.social"
               target="_blank"
               rel="noopener noreferrer">Pavillion</a>
          </template>
        </i18next>
      </p>

      <a href="https://pavillion.social"
         target="_blank"
         rel="noopener noreferrer"
         class="learn-more">
        {{ t('info_panel.learn_more') }}
      </a>
    </aside>
  </div>
</template>
