<script setup>
import { useTranslation } from 'i18next-vue';

const { t } = useTranslation('admin', {
    keyPrefix: 'funding'
});
</script>

<template>
  <p>{{ t("title") }}</p>
  <section>
    <p>{{ t("tmp_note") }}</p>
  </section>
</template>

<style scoped lang="scss">
</style>