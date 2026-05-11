<script setup lang="ts">
import { ref, computed, inject, onBeforeMount, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import { Calendar as CalendarIcon } from 'lucide-vue-next';

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

const instanceHost = computed<string>(() => {
  return siteConfig?.settings?.()?.domain ?? '';
});

/**
 * Precomputed per-tile view model. Memoizing here ensures each tile's
 * localizedContent() lookup runs once per render (not once per template
 * reference) and gives the template a single, explicit cache point.
 */
type DisplayListing = {
  listing: PublicCalendarListing;
  href: string;
  name: string;
  description: string;
  handle: string;
};

const displayListings = computed<DisplayListing[]>(() => {
  const host = instanceHost.value;
  return calendars.value.map((listing) => {
    const content = localizedContent(listing.calendar);
    return {
      listing,
      href: calendarPath(listing.calendar.urlName),
      name: content?.name || listing.calendar.urlName,
      description: content?.description || '',
      handle: host ? `${listing.calendar.urlName}@${host}` : '',
    };
  });
});

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
    <div class="discovery-header">
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
            <span class="sr-only"> ({{ t('opens_in_new_tab') }})</span>
          </a>
        </p>
      </div>
    </div>

    <section
      class="discovery-main"
      aria-labelledby="discovery-calendars-heading"
    >
      <h2
        id="discovery-calendars-heading"
        class="discovery-subheading"
      >
        {{ t('discovery.page_title') }}
      </h2>

      <!--
        Single always-present live region for loading + empty + populated
        announcements. AT registers the container before any text is injected,
        so the swap is announced. Errors use a separate role="alert" container
        so they interrupt regardless of the polite queue.
      -->
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        class="discovery-status"
      >
        <span
          v-if="state === 'loading'"
          class="discovery-loading"
        >
          {{ t('discovery.loading_label') }}
        </span>
        <div
          v-else-if="state === 'empty'"
          class="discovery-empty"
        >
          <h3 class="discovery-empty-heading">{{ t('discovery.empty_state_heading') }}</h3>
          <p class="discovery-empty-body">{{ t('discovery.empty_state_body') }}</p>
        </div>
      </div>

      <div
        v-if="state === 'error'"
        role="alert"
        class="discovery-error"
      >
        {{ t('discovery.error_message') }}
      </div>

      <ul
        v-if="state === 'populated'"
        role="list"
        class="discovery-list"
      >
        <li
          v-for="item in displayListings"
          :key="item.listing.calendar.id"
          class="discovery-list-item"
        >
          <RouterLink
            :to="item.href"
            class="discovery-tile"
          >
            <h3 class="discovery-tile-title">{{ item.name }}</h3>
            <p
              v-if="item.description"
              class="discovery-tile-description"
            >
              {{ item.description }}
            </p>
            <span
              v-if="item.handle"
              class="discovery-tile-handle"
            >
              <CalendarIcon
                :size="14"
                aria-hidden="true"
              />
              <span>{{ item.handle }}</span>
            </span>
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

  @include public-tablet-up {
    font-size: $public-font-size-3xl;
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
    border-bottom: 1px solid transparent;

    &:hover {
      border-bottom-color: currentColor;
    }

    &:focus-visible {
      @include public-focus-visible;
    }
  }
}

.sr-only {
  @include public-sr-only;
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
  // Inherits background, border (color/width), and dark-mode bg/border from
  // the sidebar-card mixin. Overrides below: tile-specific radius, padding,
  // hover lift, layout, and link semantics.
  @include public-sidebar-card;

  display: flex;
  flex-direction: column;
  padding: $public-space-xl;
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

.discovery-tile-handle {
  @include public-source-calendar-pill;
  align-self: flex-start;
  margin-top: auto;
  cursor: inherit;
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
  // Intentional override: the empty-state mixin sets the container to the
  // secondary text color so paragraph copy is muted, but the heading should
  // read as primary text to anchor the empty state visually.
  color: $public-text-primary-light;

  @include public-dark-mode {
    color: $public-text-primary-dark;
  }
}

.discovery-empty-body {
  font-size: $public-font-size-base;
  margin: 0;
  line-height: $public-line-height-relaxed;
  // Color inherited from the public-empty-state mixin on the container
  // (secondary text, with dark-mode override). No need to re-declare here.
}
</style>
