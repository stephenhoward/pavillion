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
</style>