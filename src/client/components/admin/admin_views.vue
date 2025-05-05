<script setup>
    import { reactive, inject } from 'vue';
    import { useTranslation } from 'i18next-vue';
    
    const site_config = inject('site_config');
    const { t } = useTranslation('admin', {
        keyPrefix: 'menu',
    });
</script>

<template>
<div>
        <router-link to="/profile" class="button">{{ t("back") }}</router-link>
    <nav>
        <li>{{ t("instance_name_title") }}</li>
        <li>{{ t("registration_mode") }}: {{ site_config.settings.registrationMode || 'closed' }}</li>
        <li><router-link :to="{ name: 'accounts' }">{{ t("accounts_link") }}</router-link></li>
        <li>{{ t("blocked_instances") }}</li>
        <li>{{ t("payment_details") }}</li>
        <RouterView />
    </nav>
</div>
</template>

<style scoped lang="scss">
</style>