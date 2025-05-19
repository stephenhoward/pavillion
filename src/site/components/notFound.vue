<script setup>
import { useTranslation } from 'i18next-vue';
const { t } = useTranslation('system');
</script>

<template>
  <main>
    {{ t('not_found_error_message') }}
  </main>
</template>

<style scoped lang="scss">
</style>
