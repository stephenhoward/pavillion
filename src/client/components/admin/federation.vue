<script setup>
import { useTranslation } from 'i18next-vue';

const { t } = useTranslation('admin', {
  keyPrefix: 'federation',
});
</script>

<template>
  <p>{{ t("title") }}</p>
  <section>
    <h3>{{ t("blocked_instances_title") }}</h3>
    <p>{{ t("blocked_instances_description") }}</p>
  </section>
</template>

<style scoped lang="scss">
</style>
