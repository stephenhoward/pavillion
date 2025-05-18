<script setup>
</script>

<template>
  <RouterView />
  <footer>
    <div class="logo">
      <div class="pavillion-logo"/> Powered by Pavillion
    </div>
</footer>
</template>

<style lang="scss">
  @use '../../client/assets/mixins' as *;
  footer {

  div.logo {
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
    -webkit-mask-image: url('../../client/assets/pavillion-logo.svg');
    mask-size: contain;
    mask-repeat: no-repeat;
    mask-image: url('../../client/assets/pavillion-logo.svg');
    width: 24px;
    height: 24px;
  }
  @include dark-mode {
    div.pavillion-logo {
      background-color: $dark-mode-text;
    }
  }
  }
</style>
