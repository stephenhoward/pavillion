<script setup>
import { useTranslation } from 'i18next-vue';
const { t } = useTranslation('system');
</script>

<template>
  <main class="not-found">
    <h1>{{ t('not_found_error_message') }}</h1>
    <p>{{ t('not_found_suggestion') }}</p>
    <a href="/" class="not-found-home-link">
      {{ t('not_found_go_home') }}
    </a>
  </main>
</template>

<style scoped lang="scss">
@use '../assets/mixins' as *;

.not-found {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: $public-space-3xl $public-space-xl;
  flex: 1;

  h1 {
    font-size: $public-font-size-2xl;
    font-weight: $public-font-weight-semibold;
    color: $public-text-primary-light;
    margin: 0 0 $public-space-md 0;

    @media (prefers-color-scheme: dark) {
      color: $public-text-primary-dark;
    }
  }

  p {
    font-size: $public-font-size-md;
    color: $public-text-secondary-light;
    margin: 0 0 $public-space-xl 0;
    line-height: $public-line-height-relaxed;

    @media (prefers-color-scheme: dark) {
      color: $public-text-secondary-dark;
    }
  }

  .not-found-home-link {
    @include public-button-ghost;

    padding: $public-space-sm $public-space-lg;
    font-size: $public-font-size-base;
    text-decoration: none;

    &:hover {
      text-decoration: none;
    }
  }
}
</style>
