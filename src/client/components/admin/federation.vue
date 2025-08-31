<script setup>
import { useTranslation } from 'i18next-vue';

const { t } = useTranslation('admin', {
  keyPrefix: 'federation',
});
</script>

<template>
  <h1>{{ t("title") }}</h1>
  <section>
    <h2>{{ t("blocked_instances_title") }}</h2>
    <p>{{ t("blocked_instances_description") }}</p>
  </section>
</template>

<style scoped lang="scss">
</style>
