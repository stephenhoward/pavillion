<script setup>
import LanguageSwitcher from './LanguageSwitcher.vue';
</script>

<template>
  <RouterView />
  <footer>
    <div class="logo">
      <div class="pavillion-logo"/> Powered by Pavillion
    </div>
    <LanguageSwitcher />
  </footer>
</template>

<style lang="scss">
</style>
