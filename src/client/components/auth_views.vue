<script setup>
import { inject, ref } from 'vue';
const site_config = inject('site_config');

const siteTitle = ref(site_config.settings().siteTitle);
</script>

<template>
  <div>
    <h1>{{ siteTitle }}</h1>
    <RouterView />
    <div class="logo">
      <div class="pavillion-logo"/> Powered by Pavillion
    </div>
  </div>
</template>

<style scoped lang="scss">
  @use '../assets/mixins' as *;

  div.logo,h1 {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12pt;
    text-align: center;
  }
  div.pavillion-logo {
    display: inline-block;
    background-color: $light-mode-text;
    -webkit-mask-size: contain;
    -webkit-mask-repeat: no-repeat;
    -webkit-mask-image: url('../assets/pavillion-logo.svg');
    mask-size: contain;
    mask-repeat: no-repeat;
    mask-image: url('../assets/pavillion-logo.svg');
    width: 24px;
    height: 24px;
  }
  @include dark-mode {
    div.pavillion-logo {
      background-color: $dark-mode-text;
    }
  }

</style>
