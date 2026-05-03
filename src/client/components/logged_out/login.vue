<script setup lang="ts">
import { ref, inject, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import i18next from 'i18next';
import LoginForm from './LoginForm.vue';
import PolicyLink from '@/client/components/common/PolicyLink.vue';

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

// Local reactive email, seeded from the initial query-param value. Kept in
// sync with LoginForm's <input> via the @update:email emit so the secondary
// router-links (register / apply / forgot-password) can propagate the live
// typed value through their ?email= query params.
const email = ref<string>(initialEmail.value ?? '');

const registrationMode = computed(() => settings.value.registrationMode);

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
    <div class="welcome-card-main">
      <h2>{{ t('title') }}</h2>

      <LoginForm :initial-email="initialEmail"
                 @update:email="(v) => email = v"
                 @success="onLoginSuccess" />

      <div v-if="registrationMode === 'open' || registrationMode === 'apply'"
           class="secondary-actions">
        <router-link v-if="registrationMode === 'open'"
                     class="btn btn--pill btn--secondary"
                     :to="{ name: 'register', query: { email: email }}">
          {{ t("register_button") }}
        </router-link>
        <router-link v-if="registrationMode === 'apply'"
                     class="btn btn--pill btn--secondary"
                     :to="{ name: 'register-apply', query: { email: email }}">
          {{ t("apply_button") }}
        </router-link>
      </div>

      <router-link class="forgot"
                   :to="{ name: 'forgot_password', query: { email: email }}">
        {{ t("forgot_password") }}
      </router-link>
    </div>

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

      <p class="policy-link">
        <PolicyLink source="login" />
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

<style scoped lang="scss">
.secondary-actions {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-4);
  margin-block-start: var(--pav-space-6);
}

.policy-link {
  margin-block-start: var(--pav-space-4);
}
</style>
