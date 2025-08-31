<script setup>
import { inject, ref } from 'vue';
const site_config = inject('site_config');

const siteTitle = ref(site_config.settings().siteTitle);
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
      <div class="pavillion-logo"/> Powered by Pavillion
    </footer>
  </main>
</template>
