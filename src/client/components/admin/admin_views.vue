<script setup>
    import { reactive, inject } from 'vue';
    import { useTranslation } from 'i18next-vue';
    import { useRoute } from 'vue-router';

    const route = useRoute();

    const site_config = inject('site_config');
    const { t } = useTranslation('admin', {
        keyPrefix: 'menu',
    });

    const isActive = (path) => {
        return route.path === path;
    };
</script>

<template>
<div class="root">
    <nav>
        <li><router-link to="/profile" class="button">{{ t("back") }}</router-link></li>
        <li>{{ t("instance_name_title") }}</li>
        <li>{{ t("registration_mode") }}: {{ site_config.settings.registrationMode || 'closed' }}</li>
        <li :class="{ selected: isActive('/accounts'), badged: true }"><router-link :to="{ name: 'accounts' }">{{ t("accounts_link") }}</router-link></li>
        <li>{{ t("blocked_instances") }}</li>
        <li>{{ t("payment_details") }}</li>
    </nav>
    <div id="main">
        <RouterView />
    </div>
</div>
</template>

<style scoped lang="scss">
@use '../../assets/layout.scss' as *;

</style>