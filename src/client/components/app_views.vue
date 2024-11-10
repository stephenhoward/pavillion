<script setup>
import loggedInNavigation from './loggedInNavigation.vue'
import { inject, onBeforeMount } from 'vue';
import { useRouter} from 'vue-router';

const authn = inject('authn');

onBeforeMount(() => {
  if (!authn.is_logged_in()) {
    useRouter().replace({ name: 'login'});
  }

})
</script>

<template>
    <RouterView />
    <loggedInNavigation />
</template>

<style scoped lang="scss">
.logo {
  height: 6em;
  padding: 1.5em;
  will-change: filter;
  transition: filter 300ms;
}
.logo:hover {
  filter: drop-shadow(0 0 2em #646cffaa);
}
.logo.vue:hover {
  filter: drop-shadow(0 0 2em #42b883aa);
}
</style>