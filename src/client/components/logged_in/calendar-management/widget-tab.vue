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
@use '../../../assets/mixins' as *;

.widget-tab {
  padding: $spacing-xl 0;

  .widget-sections {
    max-width: 1000px;
    margin: 0 auto;

    .widget-section {
      margin-bottom: $spacing-3xl;
      padding: $spacing-2xl;
      background: $light-mode-panel-background;
      border: 1px solid $light-mode-border;
      border-radius: $component-border-radius-small;

      @include dark-mode {
        background: $dark-mode-panel-background;
        border-color: $dark-mode-border;
      }

      h2 {
        margin: 0 0 $spacing-md 0;
        font-size: 22px;
        font-weight: $font-bold;
        color: $light-mode-text;

        @include dark-mode {
          color: $dark-mode-text;
        }
      }

      .section-intro {
        margin: 0 0 $spacing-xl 0;
        font-size: 15px;
        color: $light-mode-secondary-text;
        line-height: 1.6;

        @include dark-mode {
          color: $dark-mode-secondary-text;
        }
      }
    }
  }
}
</style>
