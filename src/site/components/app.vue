<script setup>
import LanguageSwitcher from './language-switcher.vue';
</script>

<template>
  <RouterView />
  <footer>
    <div class="logo">
      <a href="https://pavillion.social" target="_blank" rel="noopener noreferrer">
        <div class="pavillion-logo"/> Powered by Pavillion
      </a>
    </div>
    <LanguageSwitcher />
  </footer>
</template>

<style lang="scss">
</style>
