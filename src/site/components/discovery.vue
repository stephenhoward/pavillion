<script setup lang="ts">
import { ref, computed, inject, onBeforeMount, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import type Config from '@/client/service/config';

import CalendarService, { type PublicCalendarListing } from '../service/calendar';
import { useLocale } from '../composables/useLocale';
import { useLocalizedContent } from '../composables/useLocalizedContent';
import { DEFAULT_LANGUAGE_CODE } from '@/common/i18n/languages';

const { t } = useTranslation('system');
const { currentLocale, localizedPath } = useLocale();
const { localizedContent } = useLocalizedContent();
const siteConfig = inject<Config>('site_config');

const calendarService = new CalendarService();

type LoadState = 'loading' | 'populated' | 'empty' | 'error';

const state = ref<LoadState>('loading');
const calendars = ref<PublicCalendarListing[]>([]);

const PAVILLION_URL = 'https://pavillion.social';

const siteTitle = computed<string>(() => {
  const title = siteConfig?.settings?.()?.siteTitle;
  return typeof title === 'string' && title.length > 0 ? title : 'Pavillion';
});

/**
 * Localized instance description, picked from the site config's
 * instanceDescription (a Record<lang, string>) by visitor locale with fallback
 * to the default language. Returns an empty string when no description is
 * configured for any locale so the header collapses cleanly.
 */
const instanceDescription = computed<string>(() => {
  const settings = siteConfig?.settings?.();
  const map = settings?.instanceDescription;
  if (!map || typeof map !== 'object') return '';
  const locale = currentLocale.value;
  if (map[locale] && map[locale].length > 0) {
    return map[locale];
  }
  if (locale !== DEFAULT_LANGUAGE_CODE && map[DEFAULT_LANGUAGE_CODE]) {
    return map[DEFAULT_LANGUAGE_CODE];
  }
  return '';
});

/**
 * Build the calendar detail path for a tile, locale-prefixed when the visitor
 * is on a non-default-locale URL so links remain inside the visitor's locale.
 */
function calendarPath(urlName: string): string {
  return localizedPath(`/view/${urlName}`);
}

function tileName(listing: PublicCalendarListing): string {
  const content = localizedContent(listing.calendar);
  return content?.name || listing.calendar.urlName;
}

function tileDescription(listing: PublicCalendarListing): string {
  const content = localizedContent(listing.calendar);
  return content?.description || '';
}

/**
 * Sets <title> and <meta name="description"> for the discovery page.
 *
 * Mirrors the document.title pattern already used by calendar.vue / event.vue
 * and additionally manages a meta description tag (created if absent) for SEO
 * on this anonymous discovery surface.
 */
function applyHead() {
  const title = `${t('discovery.page_title')} | ${siteTitle.value}`;
  document.title = title;
  const description = t('discovery.meta_description');
  let meta = document.head.querySelector('meta[name="description"]') as HTMLMetaElement | null;
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'description');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', description);
}

// Re-apply head when locale changes so translated title/description follow
// the visitor's language without a full page reload.
watch(currentLocale, () => {
  applyHead();
});

onBeforeMount(async () => {
  // Apply head metadata on mount. We intentionally don't clear the meta
  // description on unmount: the next route's onBeforeMount will overwrite it,
  // and clearing here would briefly drop SEO context during navigation.
  applyHead();
  try {
    const listings = await calendarService.listPublicCalendars();
    calendars.value = listings;
    state.value = listings.length === 0 ? 'empty' : 'populated';
  }
  catch (error) {
    console.error('Error loading discovery list:', error);
    state.value = 'error';
  }
});
</script>

<template>
  <main class="discovery">
    <header class="discovery-header">
      <div class="discovery-header-inner">
        <h1 class="discovery-title">{{ siteTitle }}</h1>
        <p
          v-if="instanceDescription"
          class="discovery-instance-description"
        >
          {{ instanceDescription }}
        </p>
        <p class="discovery-learn-more">
          <a
            :href="PAVILLION_URL"
            target="_blank"
            rel="noopener noreferrer"
          >
            {{ t('discovery.learn_more') }}
          </a>
        </p>
      </div>
    </header>

    <section class="discovery-main">
      <h2 class="discovery-subheading">{{ t('discovery.page_title') }}</h2>

      <div
        v-if="state === 'loading'"
        role="status"
        class="discovery-loading"
      >
        {{ t('discovery.loading_label') }}
      </div>

      <div
        v-else-if="state === 'error'"
        role="alert"
        class="discovery-error"
      >
        {{ t('discovery.error_message') }}
      </div>

      <div
        v-else-if="state === 'empty'"
        class="discovery-empty"
      >
        <h3 class="discovery-empty-heading">{{ t('discovery.empty_state_heading') }}</h3>
        <p class="discovery-empty-body">{{ t('discovery.empty_state_body') }}</p>
      </div>

      <ul
        v-else
        role="list"
        class="discovery-list"
      >
        <li
          v-for="listing in calendars"
          :key="listing.calendar.id"
          class="discovery-list-item"
        >
          <RouterLink
            :to="calendarPath(listing.calendar.urlName)"
            class="discovery-tile"
          >
            <h3 class="discovery-tile-title">{{ tileName(listing) }}</h3>
            <p
              v-if="tileDescription(listing)"
              class="discovery-tile-description"
            >
              {{ tileDescription(listing) }}
            </p>
          </RouterLink>
        </li>
      </ul>
    </section>
  </main>
</template>

<style scoped lang="scss">
@use '../assets/mixins' as *;

.discovery {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 100%;
}

// ================================================================
// HEADER
// ================================================================

.discovery-header {
  margin-bottom: $public-space-xl;
}

.discovery-header-inner {
  @include public-container-constrained;

  padding-top: $public-space-2xl;
  padding-bottom: $public-space-xl;

  @include public-tablet-up {
    padding-top: $public-space-3xl;
    padding-bottom: $public-space-2xl;
  }
}

.discovery-title {
  font-size: $public-font-size-2xl;
  font-weight: $public-font-weight-bold;
  letter-spacing: $public-letter-spacing-tight;
  line-height: $public-line-height-tight;
  margin: 0 0 $public-space-sm 0;
  color: $public-text-primary-light;

  @include public-tablet-up {
    font-size: 2.25rem;
  }

  @include public-dark-mode {
    color: $public-text-primary-dark;
  }
}

.discovery-instance-description {
  font-size: $public-font-size-md;
  color: $public-text-secondary-light;
  margin: 0 0 $public-space-md 0;
  line-height: $public-line-height-relaxed;

  @include public-dark-mode {
    color: $public-text-secondary-dark;
  }
}

.discovery-learn-more {
  font-size: $public-font-size-sm;
  margin: 0;

  a {
    color: $public-accent-light;
    text-decoration: none;
    border-bottom: 1px solid transparent;
    transition: $public-transition-normal;

    &:hover {
      border-bottom-color: currentColor;
    }

    &:focus-visible {
      @include public-focus-visible;
    }

    @include public-dark-mode {
      color: $public-accent-dark;
    }
  }
}

// ================================================================
// MAIN / LIST
// ================================================================

.discovery-main {
  @include public-container-constrained;

  padding-top: $public-space-xl;
  padding-bottom: $public-space-2xl;

  @include public-tablet-up {
    padding-top: $public-space-2xl;
    padding-bottom: $public-space-3xl;
  }
}

.discovery-subheading {
  font-size: $public-font-size-xl;
  font-weight: $public-font-weight-semibold;
  letter-spacing: $public-letter-spacing-tight;
  line-height: $public-line-height-tight;
  margin: 0 0 $public-space-lg 0;
  color: $public-text-primary-light;

  @include public-dark-mode {
    color: $public-text-primary-dark;
  }
}

.discovery-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: 1fr;
  gap: $public-space-lg;

  @include public-tablet-up {
    grid-template-columns: repeat(2, 1fr);
    gap: $public-space-xl;
  }

  @include public-desktop-up {
    grid-template-columns: repeat(3, 1fr);
  }
}

.discovery-list-item {
  // Grid handles spacing; nothing to do at the row level.
}

.discovery-tile {
  display: flex;
  flex-direction: column;
  padding: $public-space-xl;
  background: $public-bg-primary-light;
  border: 1px solid $public-border-subtle-light;
  border-radius: $public-radius-lg;
  text-decoration: none;
  color: inherit;
  transition: $public-transition-normal;
  height: 100%;

  &:hover {
    transform: translateY(-2px);
    border-color: $public-border-medium-light;
    box-shadow: $public-shadow-md-light;
  }

  &:focus-visible {
    @include public-focus-visible;
  }

  @include public-dark-mode {
    background: $public-bg-primary-dark;
    border-color: $public-border-subtle-dark;

    &:hover {
      border-color: $public-border-medium-dark;
      box-shadow: $public-shadow-md-dark;
    }
  }
}

.discovery-tile-title {
  font-size: $public-font-size-lg;
  font-weight: $public-font-weight-semibold;
  line-height: $public-line-height-tight;
  letter-spacing: $public-letter-spacing-tight;
  margin: 0 0 $public-space-sm 0;
  color: $public-text-primary-light;

  @include public-dark-mode {
    color: $public-text-primary-dark;
  }
}

.discovery-tile-description {
  font-size: $public-font-size-base;
  color: $public-text-secondary-light;
  line-height: $public-line-height-normal;
  margin: 0;

  @include public-dark-mode {
    color: $public-text-secondary-dark;
  }
}

// ================================================================
// STATES
// ================================================================

.discovery-loading {
  @include public-loading-state;
}

.discovery-error {
  @include public-error-state;

  margin: $public-space-md 0;
}

.discovery-empty {
  @include public-empty-state;
}

.discovery-empty-heading {
  font-size: $public-font-size-lg;
  font-weight: $public-font-weight-semibold;
  margin: 0 0 $public-space-sm 0;
  color: $public-text-primary-light;

  @include public-dark-mode {
    color: $public-text-primary-dark;
  }
}

.discovery-empty-body {
  font-size: $public-font-size-base;
  color: $public-text-secondary-light;
  margin: 0;
  line-height: $public-line-height-relaxed;

  @include public-dark-mode {
    color: $public-text-secondary-dark;
  }
}
</style>
