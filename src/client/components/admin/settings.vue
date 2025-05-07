<script setup>
import { useTranslation } from 'i18next-vue';
import { inject } from 'vue';

const site_config = inject('site_config');
const { t } = useTranslation('admin', {
  keyPrefix: 'settings',
});
</script>

<template>
  <p>{{ t("title") }}</p>
  <section>
    <li>{{ t("instance_name") }}</li>
    <li>{{ t("registration_mode") }}: {{ t( site_config.settings.registrationMode || 'closed' ) }}</li>
  </section>
</template>

<style scoped lang="scss">
</style>
