<script setup>
import { useTranslation } from 'i18next-vue';

const { t } = useTranslation('feed');
</script>

<template>
  <p>{{ t("title") }}</p>
  <section>
    {{ t("events_description") }}<br/>
    {{ t("calendars_description") }}<br/>
    {{ t("follow_interface_description") }}<br/>
    {{ t("follow_identifier_description") }}<br/>
    <div class="event"/>
  </section>
</template>

<style scoped lang="scss">
</style>
