<script setup>
    import { reactive, inject } from 'vue';
    const site_config = inject('site_config');
</script>

<template>
    <router-link to="/" class="button">&lt; back</router-link>
    <ul>
        <li>Registration Mode: {{ site_config.settings.registrationMode || 'closed' }}</li>
    </ul>

    Powered by Pavillion
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