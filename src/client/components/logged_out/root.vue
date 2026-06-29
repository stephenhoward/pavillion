<script setup>
import { inject, ref } from 'vue';
import { useTranslation } from 'i18next-vue';

const site_config = inject('site_config');

const siteTitle = ref(site_config.settings().siteTitle);
const { t } = useTranslation('system');
</script>

<template>
  <main class="logged-out">
    <header>
      <h1>{{ siteTitle }}</h1>
    </header>
    <section>
      <RouterView />
    </section>
    <footer class="logo">
      <a href="https://pavillion.social" target="_blank" rel="noopener noreferrer">
        <div class="pavillion-logo" aria-hidden="true"/> {{ t('powered_by') }}
      </a>
    </footer>
  </main>
</template>
