<script setup>
    import { reactive, inject } from 'vue';
    const site_config = inject('site_config');
</script>

<template>
    <router-link to="/profile" class="button">&lt; back</router-link>
    <ul>
        <li>Instance Name/Title</li>
        <li>Registration Mode: {{ site_config.settings.registrationMode || 'closed' }}</li>
        <li>List of account applications (with badge for outstanding ones)</li>
        <li>List of accounts on this instance</li>
        <li>List of blocked instances</li>
        <li>details needed for pay-what-you-can form</li>
    </ul>

    Powered by Pavillion
</template>

<style scoped lang="scss">
</style>