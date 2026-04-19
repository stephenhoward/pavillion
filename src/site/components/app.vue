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
    <LanguageSwitcher />
  </footer>
</template>

<style lang="scss">
</style>
