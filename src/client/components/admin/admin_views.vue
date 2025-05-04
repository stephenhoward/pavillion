<script setup>
    import { reactive, inject } from 'vue';
    const site_config = inject('site_config');
</script>

<template>
<div>
        <router-link to="/profile" class="button">&lt; back</router-link>
    <nav>
        <li>Instance Name/Title</li>
        <li>Registration Mode: {{ site_config.settings.registrationMode || 'closed' }}</li>
        <li><router-link :to="{ name: 'accounts' }">Accounts (with badge for outstanding applications)</router-link></li>
        <li>List of blocked instances</li>
        <li>details needed for pay-what-you-can form</li>
        <RouterView />
    </nav>
</div>
</template>

<style scoped lang="scss">
</style>