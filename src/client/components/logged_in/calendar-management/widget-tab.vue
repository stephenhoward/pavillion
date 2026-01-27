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
          ref="widgetConfigRef"
          :calendar-id="calendarId"
          :calendar-url-name="calendarUrlName"
        />
      </section>

      <!-- Embed Code Section -->
      <section class="widget-section">
        <h2>{{ t('embed_section_title') }}</h2>
        <p class="section-intro">{{ t('embed_section_intro') }}</p>
        <WidgetEmbed
          :calendar-url-name="calendarUrlName"
          :view-mode="widgetConfigState.viewMode"
          :accent-color="widgetConfigState.accentColor"
          :color-mode="widgetConfigState.colorMode"
        />
      </section>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import WidgetDomains from './widget-domains.vue';
import WidgetConfig from './widget-config.vue';
import WidgetEmbed from './widget-embed.vue';

// Props
const props = defineProps({
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

// Ref to widget config component to access its state
const widgetConfigRef = ref(null);

// Computed property to reactively get widget config state
const widgetConfigState = computed(() => {
  return widgetConfigRef.value?.state || {
    viewMode: 'list',
    accentColor: '#ff9131',
    colorMode: 'auto',
  };
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
