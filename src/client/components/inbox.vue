<script setup>
import { useTranslation } from 'i18next-vue';

const { t } = useTranslation('inbox');
</script>

<template>
  <p>{{ t("title") }}</p>
  {{ t("description") }}
</template>

<style scoped lang="scss">
</style>