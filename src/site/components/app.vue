<script setup>
import { useTranslation } from 'i18next-vue';
import LanguageSwitcher from './language-switcher.vue';

const { t } = useTranslation('system');
</script>

<template>
  <RouterView />
  <footer>
    <div class="logo">
      <a href="https://pavillion.social" target="_blank" rel="noopener noreferrer">
        <div class="pavillion-logo"/> {{ t('powered_by') }}
      </a>
    </div>
    <div class="site-footer-utilities">
      <LanguageSwitcher />
      <a href="/auth/login" class="site-footer-login">{{ t('footer.login_link') }}</a>
    </div>
  </footer>
</template>

<style scoped lang="scss">
@use '../assets/mixins' as *;

footer {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: $public-space-md;

  .site-footer-utilities {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: $public-space-lg;
    flex-wrap: wrap;
    width: 100%;
  }

  .site-footer-login {
    font-size: $public-font-size-sm;
    font-weight: $public-font-weight-regular;
    color: $public-text-secondary-light;
    text-decoration: none;

    &:hover {
      color: $public-text-primary-light;
      text-decoration: underline;
    }

    &:focus-visible {
      @include public-focus-visible;
    }

    @include public-dark-mode {
      color: $public-text-secondary-dark;

      &:hover {
        color: $public-text-primary-dark;
      }
    }
  }
}
</style>
