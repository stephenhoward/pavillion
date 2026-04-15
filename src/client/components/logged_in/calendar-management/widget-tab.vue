<template>
  <div class="widget-tab">
    <div class="widget-sections">
      <!-- Allowed Domains Section -->
      <section class="widget-section">
        <h2>{{ t('domains_section_title') }}</h2>
        <p class="section-intro">{{ t('domains_section_intro') }}</p>
        <WidgetDomains :calendar-id="calendarId" />
      </section>

      <!-- Widget Configuration Section -->
      <section class="widget-section">
        <h2>{{ t('config_section_title') }}</h2>
        <p class="section-intro">{{ t('config_section_intro') }}</p>
        <WidgetConfig
          :calendar-id="calendarId"
          :calendar-url-name="calendarUrlName"
        />
      </section>

      <!-- Embed Code Section -->
      <section class="widget-section">
        <h2>{{ t('embed_section_title') }}</h2>
        <p class="section-intro">{{ t('embed_section_intro') }}</p>
        <WidgetEmbed :calendar-url-name="calendarUrlName" />
      </section>
    </div>
  </div>
</template>

<script setup>
import { useTranslation } from 'i18next-vue';
import WidgetDomains from './widget-domains.vue';
import WidgetConfig from './widget-config.vue';
import WidgetEmbed from './widget-embed.vue';

// Props
defineProps({
  calendarId: {
    type: String,
    required: true,
  },
  calendarUrlName: {
    type: String,
    required: true,
  },
});

// Translations
const { t } = useTranslation('calendars', {
  keyPrefix: 'widget',
});
</script>

<style scoped lang="scss">
@use '../../../assets/style/components/calendar-admin' as *;

.widget-tab {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-6);
}

.widget-sections {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-8);
}

.widget-section {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-4);
  background: white;
  border-radius: 0.75rem;
  padding: var(--pav-space-6);
  overflow: hidden;

  @media (prefers-color-scheme: dark) {
    background: var(--pav-color-stone-900);
  }

  h2 {
    @include admin-section-title;
    margin: 0;
  }

  .section-intro {
    margin: 0;
    color: var(--pav-color-stone-600);
    font-size: 0.875rem;
    line-height: 1.5;

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);
    }
  }
}
</style>
