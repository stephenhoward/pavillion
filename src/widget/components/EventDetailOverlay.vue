<script setup lang="ts">
import { reactive, onBeforeMount } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useRoute, useRouter } from 'vue-router';
import { DateTime } from 'luxon';
import CalendarService from '@/site/service/calendar';
import { useWidgetStore } from '../stores/widgetStore';
import NotFound from '@/site/components/notFound.vue';
import EventImage from '@/site/components/EventImage.vue';

const { t } = useTranslation('system');
const route = useRoute();
const router = useRouter();
const widgetStore = useWidgetStore();

const calendarId = route.params.urlName;
const eventId = route.params.eventId;

const state = reactive({
  err: '',
  notFound: false,
  calendar: null,
  instance: null,
  isLoading: false,
});

const calendarService = new CalendarService();

const goBack = () => {
  router.push({
    name: 'widget-calendar',
    params: { urlName: widgetStore.calendarUrlName! },
  });
};

onBeforeMount(async () => {
  try {
    state.isLoading = true;

    // Load calendar by URL name
    state.calendar = await calendarService.getCalendarByUrlName(calendarId as string);

    if (!state.calendar) {
      state.notFound = true;
      return;
    }

    // For now, load the event's first instance
    // TODO: Handle specific instance ID when available
    const events = await calendarService.loadCalendarEvents(calendarId as string);
    const event = events.find((e: any) => e.event.id === eventId);

    if (!event) {
      state.notFound = true;
      return;
    }

    state.instance = event;
  }
  catch (error) {
    console.error('Error loading event data:', error);
    state.err = 'Failed to load event data';
  }
  finally {
    state.isLoading = false;
  }
});
</script>

<template>
  <div class="event-detail-overlay">
    <!-- Loading State -->
    <div v-if="state.isLoading" class="loading">
      {{ t('loading_event') }}
    </div>

    <!-- Not Found State -->
    <div v-else-if="state.notFound">
      <NotFound />
    </div>

    <!-- Error State -->
    <div v-else-if="state.err" class="error-container">
      <div class="error">{{ state.err }}</div>
      <button type="button" class="back-button" @click="goBack">
        {{ t('back_to_calendar') }}
      </button>
    </div>

    <!-- Event Detail Content -->
    <div v-else-if="state.instance" class="event-detail-content">
      <!-- Back Button -->
      <header class="overlay-header">
        <button type="button"
                class="back-button"
                @click="goBack"
                :aria-label="t('back_to_calendar')">
          <svg width="24"
               height="24"
               viewBox="0 0 24 24"
               fill="none">
            <path
              d="M15 18L9 12L15 6"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span>{{ t('back') }}</span>
        </button>
      </header>

      <!-- Event Detail (based on site eventInstance.vue) -->
      <div class="instance-detail">
        <div class="instance-header">
          <EventImage :media="state.instance.event.media" context="hero" />
          <div class="instance-meta">
            <h1>{{ state.instance.event.content("en").name }}</h1>
            <time :datetime="state.instance.start.toISO()" class="event-datetime">
              {{ state.instance.start.toLocaleString(DateTime.DATETIME_MED) }}
            </time>
          </div>
        </div>

        <main class="instance-body">
          <p>{{ state.instance.event.content("en").description }}</p>
        </main>

        <footer v-if="state.instance.event.categories?.length > 0" class="instance-footer">
          <a
            v-for="category in state.instance.event.categories"
            :key="category.id"
            class="event-category-badge"
            @click.prevent="() => {}"
          >
            {{ category.content("en").name }}
          </a>
        </footer>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '@/site/assets/mixins' as *;

.event-detail-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: $public-bg-primary-light;
  z-index: 100;
  overflow-y: auto;
  display: flex;
  flex-direction: column;

  @include public-dark-mode {
    background: $public-bg-primary-dark;
  }
}

.event-detail-content {
  flex: 1;
  display: flex;
  flex-direction: column;
}

// ================================================================
// OVERLAY HEADER WITH BACK BUTTON
// ================================================================

.overlay-header {
  padding: $public-space-md;
  border-bottom: 1px solid $public-border-subtle-light;

  @include public-dark-mode {
    border-bottom-color: $public-border-subtle-dark;
  }

  .back-button {
    @include public-button-base;

    display: inline-flex;
    align-items: center;
    gap: $public-space-xs;
    padding: $public-space-sm $public-space-md;
    background: transparent;
    border: 1px solid $public-border-medium-light;
    border-radius: $public-radius-sm;
    color: $public-text-primary-light;
    font-size: $public-font-size-base;
    transition: $public-transition-fast;

    &:hover {
      background: $public-hover-overlay-light;
      border-color: $public-border-strong-light;
    }

    @include public-dark-mode {
      border-color: $public-border-medium-dark;
      color: $public-text-primary-dark;

      &:hover {
        background: $public-hover-overlay-dark;
        border-color: $public-border-strong-dark;
      }
    }

    svg {
      flex-shrink: 0;
    }
  }
}

// ================================================================
// EVENT DETAIL (adapted from site eventInstance.vue)
// ================================================================

.instance-detail {
  flex: 1;
  padding: $public-space-lg;
  max-width: 800px;
  margin: 0 auto;
  width: 100%;

  @include public-mobile-only {
    padding: $public-space-md;
  }
}

.instance-header {
  display: flex;
  flex-direction: column;
  gap: $public-space-lg;
  margin-bottom: $public-space-2xl;

  // ============================================================
  // HEADER WITHOUT IMAGE
  // ============================================================

  &:not(:has(.event-image)) .instance-meta {
    padding-top: $public-space-lg;
    border-top: 4px solid $public-accent-light;
    max-width: 80%;

    @include public-dark-mode {
      border-top-color: $public-accent-dark;
    }

    @include public-mobile-only {
      max-width: 100%;
    }

    h1 {
      font-size: 40px;
      font-weight: $public-font-weight-bold;
      letter-spacing: $public-letter-spacing-tight;

      @include public-mobile-only {
        font-size: $public-font-size-2xl;
      }
    }

    .event-datetime {
      font-size: $public-font-size-lg;
    }
  }

  // ============================================================
  // HEADER WITH IMAGE
  // ============================================================

  &:has(.event-image) .instance-meta {
    h1 {
      font-size: $public-font-size-2xl;
      font-weight: $public-font-weight-semibold;

      @include public-mobile-only {
        font-size: $public-font-size-xl;
      }
    }
  }

  .instance-meta {
    display: flex;
    flex-direction: column;
    gap: $public-space-sm;

    h1 {
      margin: 0;
      line-height: $public-line-height-tight;
      color: $public-text-primary-light;

      @include public-dark-mode {
        color: $public-text-primary-dark;
      }
    }

    .event-datetime {
      display: inline-flex;
      align-items: center;
      gap: $public-space-sm;
      font-size: $public-font-size-md;
      font-weight: $public-font-weight-medium;
      color: $public-accent-light;

      @include public-dark-mode {
        color: $public-accent-dark;
      }
    }
  }
}

.instance-body {
  p {
    font-size: $public-font-size-md;
    line-height: $public-line-height-relaxed;
    color: $public-text-primary-light;
    margin: 0 0 $public-space-lg 0;

    @include public-dark-mode {
      color: $public-text-primary-dark;
    }
  }
}

.instance-footer {
  display: flex;
  flex-wrap: wrap;
  gap: $public-space-sm;
  margin-top: $public-space-xl;
  padding-top: $public-space-lg;
  border-top: 1px solid $public-border-subtle-light;

  @include public-dark-mode {
    border-top-color: $public-border-subtle-dark;
  }
}

.event-category-badge {
  @include public-category-badge;

  text-decoration: none;
  cursor: default;
}

.loading {
  @include public-loading-state;
}

.error-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: $public-space-2xl;
  gap: $public-space-lg;
  min-height: 400px;

  .error {
    @include public-error-state;
    margin: 0;
  }

  .back-button {
    @include public-button-base;

    padding: $public-space-sm $public-space-lg;
    background: transparent;
    border: 1px solid $public-border-medium-light;
    border-radius: $public-radius-sm;
    color: $public-text-primary-light;
    font-size: $public-font-size-base;
    transition: $public-transition-fast;

    &:hover {
      background: $public-hover-overlay-light;
      border-color: $public-border-strong-light;
    }

    @include public-dark-mode {
      border-color: $public-border-medium-dark;
      color: $public-text-primary-dark;

      &:hover {
        background: $public-hover-overlay-dark;
        border-color: $public-border-strong-dark;
      }
    }
  }
}

.error {
  @include public-error-state;

  margin: $public-space-md 0;
}
</style>
