/**
 * Theme parity probe for the public site and widget.
 *
 * Captures the computed colour/shadow styling of a fixed element list on
 * every public page, in every colour mode, across interaction states, and
 * diffs two captures mechanically. It exists so the theme-token migration can
 * prove that site and widget render the same as before, measured rather than
 * eyeballed.
 *
 * Usage (from the repo root, after `npm run build` on the commit to probe):
 *
 *   npx tsx tests/theme-parity/probe.ts capture [out.json] [--base-url URL] [--screenshots DIR]
 *   npx tsx tests/theme-parity/probe.ts diff <baseline.json> <candidate.json>
 *
 * `capture` starts its own isolated server (built dist/, NODE_ENV=e2e,
 * freshly seeded database) unless `--base-url` points at a running one.
 * `diff` exits non-zero only on real deviations; differences in a colour's
 * alpha within ALPHA_EPSILON are reported separately.
 *
 * Not a Playwright test: it lives outside tests/e2e so CI never runs it.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from '@playwright/test';
import { startTestServer, type TestEnvironment } from '../e2e/helpers/test-server';

// ---------------------------------------------------------------------------
// What is read
// ---------------------------------------------------------------------------

/** Every theme-varying property compared on every probed element. */
const PROPERTIES = [
  'color',
  'background-color',
  'background-image',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-color',
  'box-shadow',
  'filter',
  'backdrop-filter',
  'fill',
  'stroke',
] as const;

/**
 * Read only on the two token-layer include sites. color-scheme inherits, so
 * reading it per element would flag every descendant for one change.
 */
const ROOT_PROPERTIES = ['color-scheme'] as const;

/** Tolerance on a colour's alpha channel, from calc() serialisation. */
const ALPHA_EPSILON = 0.005;

const VIEWPORT = { width: 1280, height: 900 };

/** A phone-width viewport, where the category pill row overflows and shows its scroll arrows. */
const NARROW_VIEWPORT = { width: 390, height: 844 };

/** Any slug of an occurrence that does not exist: renders the not-found page. */
const MISSING_INSTANCE = '/events/00000000-0000-4000-8000-000000000000/20260101-1200';

/**
 * The seeded series (j_event_series.json: series e5000001-… on test_calendar,
 * three events in x_event.json) and its event that carries the seed's only
 * image (m_media.json). event-image.vue's `context-hero` has no caller, so only
 * the card and feature contexts are probed.
 */
const SERIES_PATH = '/test_calendar/series/summer_festival';
const IMAGE_EVENT_ID = '37d1bb5a-452b-432e-ac46-268b9c565bde';

const EVENTS_API = '**/api/public/v1/calendar/test_calendar/events**';
const INSTANCE_API = '**/api/public/v1/events/*/instances/**';

type PseudoClass = 'hover' | 'focus' | 'focus-visible' | 'active';

/**
 * One probed element. `sel` is the first match of a CSS selector; `cls` and
 * `attr` are applied for the read and reverted after it; `state` is forced
 * through CDP; `pseudo` reads a pseudo-element; `root` adds color-scheme.
 */
interface Probe {
  sel: string;
  pseudo?: '::before' | '::after' | '::placeholder' | '::backdrop';
  state?: PseudoClass[];
  cls?: string;
  attr?: [string, string];
  root?: boolean;
  /** Read the UA shadow part `::-webkit-calendar-picker-indicator` through CDP. */
  pickerIndicator?: boolean;
}

/** One stable key per probe, used as the JSON key and the diff key. */
function probeKey(p: Probe): string {
  return p.sel
    + (p.cls ? `{+.${p.cls}}` : '')
    + (p.attr ? `{+[${p.attr[0]}="${p.attr[1]}"]}` : '')
    + (p.state ? p.state.map(s => `:${s}`).join('') : '')
    + (p.pseudo ?? '')
    + (p.pickerIndicator ? '::-webkit-calendar-picker-indicator' : '');
}

/** Expand a selector into its resting read plus each listed forced state. */
function withStates(sel: string, ...states: PseudoClass[]): Probe[] {
  return [{ sel }, ...states.map(s => ({ sel, state: [s] }))];
}

// ---------------------------------------------------------------------------
// Element lists
//
// Fixed per page. Derived from a pass over the style blocks of every file the
// theme migration touches (src/site/assets/style.scss, src/site/components,
// src/widget/components, src/common/ui): each rule that declares a colour,
// background, border, outline, shadow or filter, includes a colour-bearing
// public-* mixin, or carries a public-dark-mode block, contributes its
// selector, plus the states its nested rules (and the mixins it includes)
// style. An element the seed cannot render is reached by stubbing the API
// response it renders from (see the *.decorated steps), never left out.
// ---------------------------------------------------------------------------

/** src/site/assets/style.scss and src/site/components/app.vue: chrome on every site page. */
const SITE_CHROME: Probe[] = [
  { sel: '#app', root: true },
  { sel: '#app > footer' },
  { sel: '#app > footer div.logo' },
  ...withStates('#app > footer div.logo a', 'hover'),
  { sel: '#app > footer div.pavillion-logo' },
  ...withStates('#app > footer .site-footer-login', 'hover', 'focus-visible'),
  // language-switcher.vue: the closed trigger.
  ...withStates('.language-switcher__trigger', 'hover', 'focus-visible'),
];

/** style.scss global element rules, read on the page's first instance of each. */
const SITE_GLOBALS: Probe[] = [
  { sel: '#app h1' },
  { sel: '#app h2' },
  { sel: '#app h3' },
  { sel: '#app p' },
  ...withStates('#app a', 'hover'),
];

/** search-filter-public.vue at rest, and category-pill-selector.vue / public-filter-pill. */
const FILTER_BAR: Probe[] = [
  { sel: '.search-section .search-label' },
  { sel: '.search-section .search-icon' },
  // public-input-base via search-input: an input-base hover/focus checkpoint.
  ...withStates('.search-section .search-input', 'hover', 'focus'),
  { sel: '.search-section .search-input', state: ['hover', 'focus'] },
  { sel: '.search-section .search-input', pseudo: '::placeholder' },
  { sel: '.category-filter-section .filter-label' },
  ...withStates('.date-range-section .date-filter-button', 'hover', 'focus-visible'),
  { sel: '.date-range-section .date-filter-button .dropdown-icon' },
  // public-filter-pill, unselected: hover is the state the dark block
  // overrides with its own literals.
  ...withStates('.category-pill:not(.absent)', 'hover', 'focus', 'focus-visible', 'active'),
  // public-filter-pill absent checkpoint: restated inside the dark block.
  // The site seed renders absent pills; the widget's does not, so the state
  // is also applied as a class to a present pill, in both apps.
  ...withStates('.category-pill.absent', 'hover', 'focus'),
  { sel: '.category-pill:not(.absent)', cls: 'absent' },
  { sel: '.category-pill:not(.absent)', cls: 'absent', state: ['hover'] },
  { sel: '.category-pill:not(.absent)', cls: 'absent', state: ['focus'] },
];

/** A category actually selected: public-filter-pill .selected checkpoint, checkmark, clear-all. */
const CATEGORY_SELECTED: Probe[] = [
  ...withStates('.category-pill.selected', 'hover', 'focus', 'focus-visible'),
  { sel: '.category-pill.selected .checkmark' },
  ...withStates('.clear-all-section .clear-all-filters-btn', 'hover', 'focus-visible'),
];

/** category-pill-selector.vue scroll arrows, rendered only when the pill row overflows. */
const PILL_SCROLL: Probe[] = [
  ...withStates('.scroll-arrow', 'hover', 'focus-visible'),
  { sel: '.category-pill-selector-wrapper' },
];

/** search-filter-public.vue: the open date popover, no mode chosen. */
const DATE_POPOVER: Probe[] = [
  ...withStates('.date-range-section .date-filter-button', 'hover'),
  { sel: '.date-range-section .date-dropdown' },
  ...withStates('.date-range-section .date-mode-pills .date-pill', 'hover', 'focus-visible'),
  { sel: '.date-range-section .date-mode-pills .date-pill.calendar-pill' },
];

/** search-filter-public.vue: custom dates chosen (has-filter, active pill, inputs). */
const DATE_CUSTOM: Probe[] = [
  ...withStates('.date-range-section .date-filter-button', 'hover'),
  { sel: '.date-range-section .date-filter-button .dropdown-icon' },
  ...withStates('.date-range-section .clear-date-filter', 'hover', 'focus-visible'),
  { sel: '.date-range-section .date-dropdown' },
  ...withStates('.date-range-section .date-mode-pills .date-pill.active', 'hover'),
  { sel: '.date-range-section .date-mode-pills .date-pill:not(.active)' },
  { sel: '.date-range-section .custom-dates-section' },
  { sel: '.date-range-section .date-input-label' },
  // public-input-base via input-base: hover/focus checkpoint.
  ...withStates('.date-range-section .date-input', 'hover', 'focus'),
  { sel: '.date-range-section .date-input', state: ['hover', 'focus'] },
  { sel: '.date-range-section .date-input', pickerIndicator: true },
  { sel: '.date-range-section .date-format-hint' },
];

/** search-filter-public.vue: a week chosen, popover closed (has-filter at rest). */
const DATE_CHOSEN: Probe[] = [
  ...withStates('.date-range-section .date-filter-button', 'hover', 'focus-visible'),
  { sel: '.date-range-section .date-filter-button .dropdown-icon' },
  ...withStates('.date-range-section .clear-date-filter', 'hover'),
];

/** language-switcher.vue: the open dropdown. */
const LANGUAGE_OPEN: Probe[] = [
  { sel: '.language-switcher__trigger' },
  { sel: '.language-switcher__dropdown' },
  ...withStates('.language-switcher__option:not(.language-switcher__option--selected)', 'hover', 'focus-visible'),
  ...withStates('.language-switcher__option--selected', 'hover'),
  { sel: '.language-switcher__native-name' },
  { sel: '.language-switcher__checkmark' },
];

/** event-card.vue at rest, in a list. */
const EVENT_CARD: Probe[] = [
  ...withStates('.event-card', 'hover'),
  { sel: '.event-card .card-image' },
  { sel: '.event-card .no-image-fallback' },
  { sel: '.event-card .fallback-icon' },
  { sel: '.event-card .recurrence-badge' },
  { sel: '.event-card .event-time' },
  ...withStates('.event-title-link', 'hover', 'focus-visible'),
  { sel: '.event-card .event-location' },
  { sel: '.event-card .event-description' },
  { sel: '.event-card .category-badge' },
];

/** event-card.vue and event-image.vue (card context) with an image and a cancellation stubbed in. */
const EVENT_CARD_DECORATED: Probe[] = [
  { sel: '.event-card:not(.is-cancelled) .event-image.context-card' },
  { sel: '.event-card:not(.is-cancelled) .context-card .image-vignette' },
  { sel: '.event-card.is-cancelled' },
  { sel: '.event-card.is-cancelled .cancelled-badge' },
  { sel: '.event-card.is-cancelled .card-image .event-image' },
  { sel: '.event-card.is-cancelled .no-image-fallback' },
];

/** src/common/ui/calendar-views/CalendarViewToolbar.vue in the list view. */
const VIEW_TOOLBAR: Probe[] = [
  { sel: '.ui-view-toolbar__views' },
  ...withStates('.ui-view-toolbar__view[aria-checked="false"]', 'hover', 'focus-visible'),
  { sel: '.ui-view-toolbar__view[aria-checked="true"]' },
];

/** CalendarViewToolbar.vue controls that only the week and month views render. */
const VIEW_TOOLBAR_STEPPER: Probe[] = [
  ...withStates('.ui-view-toolbar__step', 'hover', 'focus-visible'),
  ...withStates('.ui-view-toolbar__today', 'hover'),
  { sel: '.ui-view-toolbar__label' },
  { sel: '.ui-view-toolbar__view[aria-checked="true"]' },
];

/** src/common/ui/calendar-views/WeekView.vue. */
const WEEK_VIEW: Probe[] = [
  { sel: '.week-grid' },
  { sel: '.week-day-column:not(.is-today)' },
  { sel: '.week-day-column .day-header' },
  { sel: '.week-day-column .day-name' },
  ...withStates('.week-day-column:not(.is-today) .day-number', 'hover', 'focus-visible'),
  ...withStates('.week-day-column.is-today .day-number', 'hover'),
  ...withStates('.week-day-column .event-item', 'hover', 'focus-visible'),
  { sel: '.week-day-column .event-time' },
  { sel: '.week-day-column .event-name' },
  { sel: '.view-status' },
];

/** src/common/ui/calendar-views/MonthView.vue. */
const MONTH_VIEW: Probe[] = [
  { sel: '.month-grid' },
  { sel: '.month-grid .weekday-header' },
  { sel: '.month-day-cell:not(.is-other-month):not(.is-today)' },
  ...withStates('.month-day-cell:not(.is-other-month):not(.is-today) .day-number', 'focus-visible'),
  ...withStates('.month-day-cell:not(.is-other-month):not(.is-today) a.day-number', 'hover'),
  { sel: '.month-day-cell.is-other-month' },
  { sel: '.month-day-cell.is-other-month .day-number' },
  ...withStates('.month-day-cell.is-today .day-number', 'hover'),
  ...withStates('.month-day-cell .event-item', 'hover', 'focus-visible'),
  { sel: '.month-day-cell .event-time' },
  { sel: '.month-day-cell .event-name' },
  { sel: '.view-status' },
];

/** calendar.vue and list-view.vue: the day list with its sticky heading. */
const DAY_LIST: Probe[] = [
  { sel: '.day-heading' },
  { sel: '.day-heading', pseudo: '::before' },
  { sel: '.day-heading', pseudo: '::after' },
  ...withStates('li.day-event-item h3 a', 'focus-visible'),
];

/** EventDetailBody.vue (site event-instance and widget overlay), as the seed renders it. */
const EVENT_DETAIL_BODY: Probe[] = [
  { sel: '.hero-image-wrapper' },
  { sel: '.event-image.context-feature' },
  { sel: '.context-feature .image-vignette' },
  { sel: '.instance-title' },
  { sel: '.event-date' },
  { sel: '.event-datetime' },
  { sel: '.datetime-icon--date' },
  { sel: '.datetime-icon--time' },
  { sel: '.about-heading' },
  { sel: '.event-description' },
  { sel: '.section-heading' },
  ...withStates('.event-category-badge', 'hover', 'focus-visible'),
  { sel: '.sidebar-card' },
  { sel: '.card-icon' },
  { sel: '.card-heading' },
  { sel: '.location-name' },
  { sel: '.location-address' },
  // add-to-calendar.vue.
  ...withStates('.add-to-calendar-btn', 'hover', 'focus-visible'),
];

/** EventDetailBody.vue blocks the seed never renders, reached by stubbing the instance response. */
const EVENT_DETAIL_DECORATED: Probe[] = [
  { sel: '.cancelled-badge' },
  { sel: '.recurrence-badge' },
  { sel: '.recurrence-text' },
  ...withStates('.source-calendar-pill', 'hover', 'focus-visible'),
  { sel: '.accessibility-subheading' },
  { sel: '.accessibility-info' },
  ...withStates('.external-link-button', 'hover', 'focus-visible'),
];

/** event.vue (the event page without an occurrence). */
const EVENT_PAGE: Probe[] = [
  { sel: '.event-back-header' },
  ...withStates('.event-back-header .back-link', 'hover', 'focus-visible'),
  { sel: '.hero-image-wrapper' },
  { sel: '.event-image.context-feature' },
  { sel: '.context-feature .image-vignette' },
  { sel: '.event-title' },
  { sel: '.about-heading' },
  { sel: '.event-description' },
  { sel: '.section-heading' },
  ...withStates('.event-category-badge', 'hover', 'focus-visible'),
  { sel: '.sidebar-card' },
  { sel: '.card-icon' },
  { sel: '.card-heading' },
  { sel: '.location-name' },
  { sel: '.location-address' },
  { sel: '.event-main footer' },
  { sel: '.event-main footer .series-link-wrapper .series-label' },
  ...withStates('.event-series-link', 'hover', 'focus-visible'),
  ...withStates('.report-link', 'hover', 'focus-visible'),
];

/** event.vue blocks the seed never renders, reached by stubbing the event response. */
const EVENT_PAGE_DECORATED: Probe[] = [
  ...withStates('.source-calendar-pill', 'hover', 'focus-visible'),
  { sel: '.accessibility-subheading' },
  { sel: '.accessibility-info' },
  ...withStates('.external-link-button', 'hover', 'focus-visible'),
];

/** event-instance.vue (one occurrence) around EventDetailBody. */
const INSTANCE_PAGE: Probe[] = [
  { sel: '.instance-back-header' },
  ...withStates('.instance-back-header .back-link', 'hover', 'focus-visible'),
  ...EVENT_DETAIL_BODY,
  { sel: '.instance-footer' },
  ...withStates('.report-link', 'hover', 'focus-visible'),
];

/**
 * event-instance.vue's series link. The instance API omits `event.series`
 * at the base SHA, so the seed never renders it; the stub supplies the
 * series from the event API.
 */
const INSTANCE_SERIES_LINK: Probe[] = [
  { sel: '.instance-footer .series-link-wrapper .series-label' },
  ...withStates('.event-series-link', 'hover', 'focus-visible'),
];

/** report-event.vue: the open dialog. Invalid and warning states are attribute/class driven. */
const REPORT_DIALOG: Probe[] = [
  { sel: '.report-dialog', pseudo: '::backdrop' },
  { sel: '.report-dialog__content' },
  { sel: '.report-dialog__header' },
  { sel: '.report-dialog__header h2' },
  ...withStates('.report-dialog__close', 'hover', 'focus-visible'),
  { sel: '.report-dialog__field label' },
  { sel: '.report-dialog__field label span' },
  // public-input-base via the dialog fields: hover/focus checkpoint.
  ...withStates('.report-dialog__field select', 'hover', 'focus'),
  ...withStates('.report-dialog__field textarea', 'hover', 'focus'),
  { sel: '.report-dialog__field textarea', state: ['hover', 'focus'] },
  { sel: '.report-dialog__field textarea', pseudo: '::placeholder' },
  ...withStates('.report-dialog__field input[type="email"]', 'hover', 'focus'),
  { sel: '.report-dialog__field textarea', attr: ['aria-invalid', 'true'] },
  { sel: '.report-dialog__field textarea', attr: ['aria-invalid', 'true'], state: ['focus'] },
  { sel: '.report-dialog__help' },
  { sel: '.report-dialog__char-counter' },
  { sel: '.report-dialog__char-counter', cls: 'report-dialog__char-counter--warning' },
  { sel: '.report-dialog__actions' },
  ...withStates('.report-dialog__btn--primary', 'hover', 'focus-visible', 'active'),
  { sel: '.report-dialog__btn--primary', attr: ['disabled', ''] },
  ...withStates('.report-dialog__btn--ghost', 'hover', 'focus-visible'),
];

/** report-event.vue: validation and success messages, after a real submit. */
const REPORT_DIALOG_ERRORS: Probe[] = [
  { sel: '.report-dialog__field-error' },
  { sel: '.report-dialog__error' },
  { sel: '.report-dialog__field [aria-invalid="true"]' },
];

/** report-event.vue: the confirmation after a (stubbed) successful submit. */
const REPORT_DIALOG_SENT: Probe[] = [
  { sel: '.report-dialog__content' },
  { sel: '.report-dialog__success p' },
];

/** series-view.vue. */
const SERIES_PAGE: Probe[] = [
  ...withStates('.series-header .breadcrumb .back-link', 'hover', 'focus-visible'),
  { sel: '.series-header .series-meta' },
  { sel: '.series-header .series-meta h1' },
  { sel: '.series-content .series-description' },
  { sel: '.series-events h2' },
  { sel: '.series-event-item' },
  ...withStates('.series-event-link', 'hover', 'focus-visible'),
];

/** series-view.vue pagination, reached by stubbing the series total (prev is disabled on page 1). */
const SERIES_PAGINATION: Probe[] = [
  { sel: '.series-pagination' },
  { sel: '.series-pagination .prev-page' },
  ...withStates('.series-pagination .next-page', 'hover', 'focus-visible'),
  { sel: '.series-pagination .page-info' },
];

/** discovery.vue. */
const DISCOVERY_PAGE: Probe[] = [
  { sel: '.discovery-instance-description' },
  ...withStates('.discovery-learn-more a', 'hover', 'focus-visible'),
  ...withStates('.discovery-tile', 'hover', 'focus-visible'),
  { sel: '.discovery-tile-description' },
  { sel: '.discovery-tile-handle' },
];

/** not-found.vue. */
const NOT_FOUND: Probe[] = [
  { sel: '.not-found h1' },
  { sel: '.not-found p' },
  ...withStates('.not-found .not-found-home-link', 'hover', 'focus-visible'),
];

/** calendar.vue: the empty state of a search with no matches. */
const NO_RESULTS: Probe[] = [
  { sel: '.empty-state' },
  { sel: '.empty-state .empty-state-icon' },
  { sel: '.empty-state .empty-state-text' },
  { sel: '.empty-state .empty-state-hint' },
  ...withStates('.empty-state .clear-filters-btn', 'hover', 'focus-visible'),
  ...withStates('.search-section .clear-search', 'hover'),
];

/** calendar.vue header. */
const CALENDAR_HEADER: Probe[] = [
  { sel: '.calendar-title' },
  { sel: '.calendar-description' },
];

/** public-error-state in calendar.vue. */
const CALENDAR_ERROR: Probe[] = [{ sel: '#app .error' }];

/** public-error-state in discovery.vue. */
const DISCOVERY_ERROR: Probe[] = [{ sel: '#app .discovery-error' }];

/** EmptyState.vue. */
const UI_EMPTY: Probe[] = [
  { sel: '.ui-empty-state' },
  { sel: '.ui-empty-state p' },
];

/** src/widget/components/app.vue and widget-container.vue: chrome on every widget view. */
const WIDGET_CHROME: Probe[] = [
  { sel: '.widget-root', root: true },
  { sel: '.widget-container' },
  { sel: '.widget-container header' },
  { sel: '.widget-footer' },
  ...withStates('.widget-footer a', 'hover', 'focus-visible'),
  { sel: '.widget-footer .pavillion-logo' },
];

/** event-detail-overlay.vue around EventDetailBody. */
const WIDGET_OVERLAY: Probe[] = [
  { sel: '.widget-root', root: true },
  { sel: '.widget-footer' },
  { sel: '.event-detail-overlay' },
  { sel: '.instance-back-header' },
  ...withStates('.instance-back-header .back-link', 'hover', 'focus-visible'),
  ...EVENT_DETAIL_BODY,
];

/** event-detail-overlay.vue error state (public-error-state, back button). */
const WIDGET_OVERLAY_ERROR: Probe[] = [
  { sel: '.widget-root', root: true },
  { sel: '.event-detail-overlay' },
  { sel: '.error-container .error' },
  ...withStates('.error-container .back-button', 'hover', 'focus-visible'),
];

// ---------------------------------------------------------------------------
// Pages and modes
// ---------------------------------------------------------------------------

interface Mode {
  name: string;
  colorScheme: 'light' | 'dark';
  /** Widget-only: `?colorMode=` forced on the URL (src/widget/stores/widgetStore.ts parseConfig). */
  colorMode?: 'light' | 'dark';
}

const SITE_MODES: Mode[] = [
  { name: 'os-light', colorScheme: 'light' },
  { name: 'os-dark', colorScheme: 'dark' },
];

const WIDGET_MODES: Mode[] = [
  { name: 'auto/os-light', colorScheme: 'light' },
  { name: 'auto/os-dark', colorScheme: 'dark' },
  { name: 'forced-light/os-dark', colorScheme: 'dark', colorMode: 'light' },
  { name: 'forced-dark/os-light', colorScheme: 'light', colorMode: 'dark' },
];

/** Raw API JSON, edited in place by the response stubs. */
type Json = any;

/** Paths read once per run from the public API, because seed dates shift relative to today. */
interface DiscoveredPaths {
  /** event.vue for the image-bearing series event. */
  eventPath: string;
  /** event-instance.vue for the same event's occurrence. */
  instancePath: string;
  /** An occurrence of a recurring event, for the recurrence badge. */
  recurringInstancePath: string;
  /** The image event's media object, as the API serialises it. */
  media: Json;
  /** The image event's series object, as the event API serialises it. */
  series: Json;
}

interface Ctx {
  page: Page;
  baseURL: string;
  mode: Mode;
  paths: DiscoveredPaths;
}

/**
 * One captured state of one page: `setup` brings the page there, `probes`
 * is what is read. `screenshot` names a date-picker shot taken in this state.
 */
interface Step {
  name: string;
  probes: Probe[];
  setup: (ctx: Ctx) => Promise<void>;
  viewport?: { width: number; height: number };
  screenshot?: { selector: string; modes: string[]; file: (mode: string) => string };
}

interface Scenario {
  app: 'site' | 'widget';
  modes: Mode[];
  steps: Step[];
}

/** Activate an element through the DOM, so no pointer comes to rest on it (a real hover would leak into the next read). */
async function domClick(page: Page, selector: string): Promise<void> {
  const target = page.locator(selector).first();
  await target.waitFor({ state: 'attached', timeout: 20000 });
  await target.evaluate((el: HTMLElement) => el.click());
}

async function blurActive(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

async function gotoAndSettle(page: Page, url: string, ready: string): Promise<void> {
  await page.goto(url);
  await page.locator(ready).first().waitFor({ state: 'visible', timeout: 20000 });
  // Lets media fetches finish, so image vignettes are in place.
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
}

/** Rewrite the JSON body of every response matching `pattern`. */
async function stubJson(page: Page, pattern: string, edit: (json: Json) => void): Promise<void> {
  await page.route(pattern, async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    edit(json);
    await route.fulfill({ response, json });
  });
}

/** Decorations the seed never renders: a repost source, a ticket link, accessibility notes. */
function decorateEvent(event: Json): void {
  event.sourceCalendar = { urlName: 'river_arts', host: 'peer.example', url: 'https://peer.example/river_arts' };
  event.externalUrl = 'https://example.com/tickets';
  event.urlPrompt = 'tickets';
  for (const content of Object.values(event.content ?? {}) as Json[]) {
    content.accessibilityInfo = 'Step-free entrance on the east side.';
  }
}

/**
 * List decorations: the seed's image on the first card, a cancelled card
 * with that image, and a cancelled card without one.
 */
function decorateList(instances: Json[], media: Json): void {
  if (instances.length < 3) {
    return;
  }
  instances[0].event.media = media;
  instances[1].event.media = media;
  instances[1].isCancelled = true;
  instances[2].event.media = null;
  instances[2].isCancelled = true;
}

function widgetUrl(ctx: Ctx, pathname: string, query: string = ''): string {
  const params = new URLSearchParams(query);
  if (ctx.mode.colorMode) {
    params.set('colorMode', ctx.mode.colorMode);
  }
  const search = params.toString();
  return ctx.baseURL + pathname + (search ? `?${search}` : '');
}

const DATE_SHOT = (app: string) => (mode: string) => `date-picker-${app}-${mode.replace(/\//g, '-')}.png`;

/**
 * The calendar-list steps both apps share: filters, popover states, list
 * decorations and the week/month views. `open(ctx, query)` loads the list.
 */
function listSteps(app: 'site' | 'widget', open: (ctx: Ctx, query?: string) => Promise<void>, modes: Mode[]): Step[] {
  const openPopover = async (ctx: Ctx) => {
    await open(ctx);
    await domClick(ctx.page, '.date-filter-button');
    await ctx.page.locator('.date-dropdown').waitFor({ state: 'visible' });
  };
  return [
    {
      name: 'date-popover',
      probes: DATE_POPOVER,
      setup: openPopover,
    },
    {
      name: 'date-custom',
      probes: DATE_CUSTOM,
      setup: async (ctx) => {
        await openPopover(ctx);
        await domClick(ctx.page, '.date-pill.calendar-pill');
        await ctx.page.locator('.date-input').first().waitFor({ state: 'visible' });
      },
      screenshot: { selector: '.date-dropdown', modes: modes.map(m => m.name), file: DATE_SHOT(app) },
    },
    {
      name: 'date-chosen',
      probes: DATE_CHOSEN,
      setup: async (ctx) => {
        await openPopover(ctx);
        await domClick(ctx.page, '.date-pill:not(.calendar-pill)');
        await ctx.page.locator('.date-filter-button.has-filter').waitFor({ state: 'attached' });
        // Escape closes the popover (search-filter-public.vue's wrapper handler).
        await ctx.page.locator('.date-filter-wrapper').evaluate(el => el.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        ));
        await ctx.page.locator('.date-dropdown').waitFor({ state: 'detached' });
        await blurActive(ctx.page);
      },
    },
    {
      name: 'category-selected',
      probes: CATEGORY_SELECTED,
      setup: async (ctx) => {
        await open(ctx);
        await domClick(ctx.page, '.category-pill:not(.absent)');
        await ctx.page.locator('.category-pill.selected').waitFor({ state: 'attached' });
        await ctx.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await blurActive(ctx.page);
      },
    },
    {
      name: 'narrow',
      probes: PILL_SCROLL,
      viewport: NARROW_VIEWPORT,
      setup: async (ctx) => {
        await open(ctx);
        await ctx.page.locator('.scroll-arrow').first().waitFor({ state: 'attached', timeout: 20000 });
      },
    },
    {
      name: 'decorated',
      probes: EVENT_CARD_DECORATED,
      setup: async (ctx) => {
        await stubJson(ctx.page, EVENTS_API, json => decorateList(json, ctx.paths.media));
        await open(ctx);
        await ctx.page.locator('.event-card.is-cancelled').first().waitFor({ state: 'attached' });
        await ctx.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      },
    },
    {
      name: 'week',
      probes: [...VIEW_TOOLBAR_STEPPER, ...WEEK_VIEW],
      setup: async (ctx) => {
        await open(ctx, 'view=week');
        await ctx.page.locator('.week-grid').waitFor({ state: 'visible', timeout: 20000 });
      },
    },
    {
      name: 'month',
      probes: [...VIEW_TOOLBAR_STEPPER, ...MONTH_VIEW],
      setup: async (ctx) => {
        await open(ctx, 'view=month');
        await ctx.page.locator('.month-grid').waitFor({ state: 'visible', timeout: 20000 });
      },
    },
  ];
}

const siteCalendar = async (ctx: Ctx, query?: string): Promise<void> => {
  const ready = query ? '.ui-view-toolbar' : 'li.day-event-item';
  await gotoAndSettle(ctx.page, ctx.baseURL + '/test_calendar' + (query ? `?${query}` : ''), ready);
};

const SITE: Scenario = {
  app: 'site',
  modes: SITE_MODES,
  steps: [
    {
      name: 'calendar',
      probes: [...SITE_CHROME, ...SITE_GLOBALS, ...CALENDAR_HEADER, ...FILTER_BAR, ...VIEW_TOOLBAR, ...DAY_LIST, ...EVENT_CARD],
      setup: siteCalendar,
    },
    ...listSteps('site', siteCalendar, SITE_MODES).map(step => ({ ...step, name: `calendar.${step.name}` })),
    {
      name: 'calendar.language-switcher',
      probes: LANGUAGE_OPEN,
      setup: async (ctx) => {
        await siteCalendar(ctx);
        await domClick(ctx.page, '.language-switcher__trigger');
        await ctx.page.locator('.language-switcher__dropdown').waitFor({ state: 'visible' });
      },
    },
    {
      name: 'calendar.no-results',
      probes: NO_RESULTS,
      setup: async (ctx) => {
        await siteCalendar(ctx);
        await ctx.page.locator('.search-input').fill('zzqxnomatch');
        await ctx.page.locator('.empty-state').waitFor({ state: 'visible', timeout: 20000 });
        await blurActive(ctx.page);
      },
    },
    {
      name: 'calendar.error',
      probes: CALENDAR_ERROR,
      setup: async (ctx) => {
        await ctx.page.route(EVENTS_API, route => route.fulfill({ status: 500, json: {} }));
        await gotoAndSettle(ctx.page, ctx.baseURL + '/test_calendar', '#app .error');
      },
    },
    {
      name: 'event',
      probes: [...SITE_CHROME, ...SITE_GLOBALS, ...EVENT_PAGE],
      setup: ctx => gotoAndSettle(ctx.page, ctx.baseURL + ctx.paths.eventPath, '.report-link'),
    },
    {
      name: 'event.decorated',
      probes: EVENT_PAGE_DECORATED,
      setup: async (ctx) => {
        await stubJson(ctx.page, `**/api/public/v1/events/${IMAGE_EVENT_ID}?**`, decorateEvent);
        await gotoAndSettle(ctx.page, ctx.baseURL + ctx.paths.eventPath, '.external-link-button');
      },
    },
    {
      name: 'instance',
      probes: [...SITE_CHROME, ...SITE_GLOBALS, ...INSTANCE_PAGE],
      setup: ctx => gotoAndSettle(ctx.page, ctx.baseURL + ctx.paths.instancePath, '.report-link'),
    },
    {
      name: 'instance.decorated',
      probes: [...EVENT_DETAIL_DECORATED, ...INSTANCE_SERIES_LINK],
      setup: async (ctx) => {
        await stubJson(ctx.page, INSTANCE_API, (json) => {
          json.isCancelled = true;
          json.event.series = ctx.paths.series;
          decorateEvent(json.event);
        });
        await gotoAndSettle(ctx.page, ctx.baseURL + ctx.paths.recurringInstancePath, '.recurrence-badge');
      },
    },
    {
      name: 'instance.image-loading',
      probes: [
        { sel: '.image-loading .loading-pulse' },
        { sel: '.event-image.is-loading' },
        { sel: '.event-image.is-loading .image-vignette' },
      ],
      setup: async (ctx) => {
        // Hold every media request so the loading pulse stays on screen.
        await ctx.page.route('**/api/v1/media/**', () => new Promise(() => {}));
        await ctx.page.goto(ctx.baseURL + ctx.paths.instancePath);
        await ctx.page.locator('.image-loading .loading-pulse').first().waitFor({ state: 'attached', timeout: 20000 });
      },
    },
    {
      name: 'instance.report-dialog',
      probes: REPORT_DIALOG,
      setup: async (ctx) => {
        await gotoAndSettle(ctx.page, ctx.baseURL + ctx.paths.instancePath, '.report-link');
        await domClick(ctx.page, '.report-link');
        await ctx.page.locator('.report-dialog__content').waitFor({ state: 'visible' });
        await blurActive(ctx.page);
      },
    },
    {
      name: 'instance.report-dialog.invalid',
      probes: REPORT_DIALOG_ERRORS,
      setup: async (ctx) => {
        await gotoAndSettle(ctx.page, ctx.baseURL + ctx.paths.instancePath, '.report-link');
        await domClick(ctx.page, '.report-link');
        await ctx.page.locator('.report-dialog__content').waitFor({ state: 'visible' });
        await domClick(ctx.page, '.report-dialog__btn--primary');
        await ctx.page.locator('.report-dialog__field-error').first().waitFor({ state: 'attached', timeout: 20000 });
        await blurActive(ctx.page);
      },
    },
    {
      name: 'instance.report-dialog.sent',
      probes: REPORT_DIALOG_SENT,
      setup: async (ctx) => {
        await ctx.page.route('**/api/public/v1/events/*/reports', route => route.fulfill({ status: 201, json: {} }));
        await gotoAndSettle(ctx.page, ctx.baseURL + ctx.paths.instancePath, '.report-link');
        await domClick(ctx.page, '.report-link');
        await ctx.page.locator('.report-dialog__content').waitFor({ state: 'visible' });
        await ctx.page.locator('.report-dialog__field select').selectOption({ index: 1 });
        await ctx.page.locator('.report-dialog__field textarea').fill('This listing is spam.');
        await ctx.page.locator('.report-dialog__field input[type="email"]').fill('visitor@example.com');
        await domClick(ctx.page, '.report-dialog__btn--primary');
        await ctx.page.locator('.report-dialog__success p').first().waitFor({ state: 'visible', timeout: 20000 });
        await blurActive(ctx.page);
      },
    },
    {
      name: 'series',
      probes: [...SITE_CHROME, ...SITE_GLOBALS, ...SERIES_PAGE],
      setup: ctx => gotoAndSettle(ctx.page, ctx.baseURL + SERIES_PATH, '.series-event-link'),
    },
    {
      name: 'series.paginated',
      probes: SERIES_PAGINATION,
      setup: async (ctx) => {
        await stubJson(ctx.page, '**/api/public/v1/calendar/test_calendar/series/summer_festival?**', (json) => {
          json.pagination.total = 45;
        });
        await gotoAndSettle(ctx.page, ctx.baseURL + SERIES_PATH, '.series-pagination');
      },
    },
    {
      name: 'series.empty',
      probes: [{ sel: '.series-no-events' }],
      setup: async (ctx) => {
        await stubJson(ctx.page, '**/api/public/v1/calendar/test_calendar/series/summer_festival?**', (json) => {
          json.events = [];
          json.pagination.total = 0;
        });
        await gotoAndSettle(ctx.page, ctx.baseURL + SERIES_PATH, '.series-no-events');
      },
    },
    {
      name: 'discovery',
      probes: [...SITE_CHROME, ...SITE_GLOBALS, ...DISCOVERY_PAGE],
      setup: ctx => gotoAndSettle(ctx.page, ctx.baseURL + '/discover', '.discovery-tile'),
    },
    {
      name: 'discovery.empty',
      probes: UI_EMPTY,
      setup: async (ctx) => {
        await ctx.page.route('**/api/public/v1/calendars', route => route.fulfill({ json: [] }));
        await gotoAndSettle(ctx.page, ctx.baseURL + '/discover', '.ui-empty-state');
      },
    },
    {
      name: 'discovery.error',
      probes: DISCOVERY_ERROR,
      setup: async (ctx) => {
        await ctx.page.route('**/api/public/v1/calendars', route => route.fulfill({ status: 500, json: {} }));
        await gotoAndSettle(ctx.page, ctx.baseURL + '/discover', '.discovery-error');
      },
    },
    {
      name: 'not-found',
      probes: [...SITE_CHROME, ...NOT_FOUND],
      setup: ctx => gotoAndSettle(ctx.page, ctx.baseURL + '/test_calendar' + MISSING_INSTANCE, '.not-found h1'),
    },
  ],
};

const widgetList = async (ctx: Ctx, query?: string): Promise<void> => {
  const ready = query ? '.ui-view-toolbar' : '.list-view li.day-event-item';
  await gotoAndSettle(ctx.page, widgetUrl(ctx, '/widget/test_calendar', query), ready);
};

const widgetEventPath = (ctx: Ctx) => '/widget' + ctx.paths.instancePath;

const WIDGET: Scenario = {
  app: 'widget',
  modes: WIDGET_MODES,
  steps: [
    {
      name: 'list',
      probes: [...WIDGET_CHROME, ...FILTER_BAR, ...VIEW_TOOLBAR, ...DAY_LIST, ...EVENT_CARD],
      setup: widgetList,
    },
    ...listSteps('widget', widgetList, WIDGET_MODES).map(step => ({ ...step, name: `list.${step.name}` })),
    {
      name: 'list.empty',
      probes: [{ sel: '.widget-root', root: true }, ...UI_EMPTY],
      setup: async (ctx) => {
        await ctx.page.route(EVENTS_API, route => route.fulfill({ json: [] }));
        await gotoAndSettle(ctx.page, widgetUrl(ctx, '/widget/test_calendar'), '.ui-empty-state');
      },
    },
    {
      name: 'event-detail',
      probes: WIDGET_OVERLAY,
      setup: ctx => gotoAndSettle(ctx.page, widgetUrl(ctx, widgetEventPath(ctx)), '.instance-back-header .back-link'),
    },
    {
      name: 'event-detail.decorated',
      probes: EVENT_DETAIL_DECORATED,
      setup: async (ctx) => {
        await stubJson(ctx.page, INSTANCE_API, (json) => {
          json.isCancelled = true;
          decorateEvent(json.event);
        });
        await gotoAndSettle(ctx.page, widgetUrl(ctx, '/widget' + ctx.paths.recurringInstancePath), '.recurrence-badge');
      },
    },
    {
      name: 'event-detail.error',
      probes: WIDGET_OVERLAY_ERROR,
      setup: async (ctx) => {
        await ctx.page.route(INSTANCE_API, route => route.fulfill({ status: 500, json: {} }));
        await gotoAndSettle(ctx.page, widgetUrl(ctx, '/widget/test_calendar' + MISSING_INSTANCE), '.error-container .error');
      },
    },
    {
      name: 'not-found',
      probes: [{ sel: '.widget-root', root: true }, ...NOT_FOUND],
      setup: ctx => gotoAndSettle(ctx.page, widgetUrl(ctx, '/widget/test_calendar' + MISSING_INSTANCE), '.not-found h1'),
    },
  ],
};

const SCENARIOS: Scenario[] = [SITE, WIDGET];

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

type Values = Record<string, string>;
type PageCapture = Record<string, Values | null>;

interface Capture {
  meta: {
    sha: string;
    dirty: boolean;
    properties: string[];
    rootProperties: string[];
    viewport: typeof VIEWPORT;
    alphaEpsilon: number;
  };
  pages: Record<string, PageCapture>;
}

/**
 * Freeze motion: a transition caught mid-flight after a forced state would
 * make a read depend on timing. Neither property is compared, so this
 * changes no captured value.
 */
const FREEZE_CSS = '*, *::before, *::after { transition: none !important; animation: none !important; }';

/** The computed style of the UA-shadow calendar-picker indicator inside the first match of `selector`. */
async function pickerIndicatorStyle(cdp: CDPSession, selector: string): Promise<Values | null> {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const { nodeId: hostId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  if (!hostId) {
    return null;
  }
  const { node: host } = await cdp.send('DOM.describeNode', { nodeId: hostId, depth: -1, pierce: true });
  interface CdpNode {
    backendNodeId: number;
    attributes?: string[];
    children?: CdpNode[];
    shadowRoots?: CdpNode[];
    shadowPseudoId?: string;
  }
  const find = (n: CdpNode): CdpNode | null => {
    const attrs = n.attributes ?? [];
    const pseudoAttr = attrs.indexOf('pseudo');
    if (n.shadowPseudoId === '-webkit-calendar-picker-indicator'
      || (pseudoAttr >= 0 && attrs[pseudoAttr + 1] === '-webkit-calendar-picker-indicator')) {
      return n;
    }
    for (const child of [...(n.shadowRoots ?? []), ...(n.children ?? [])]) {
      const hit = find(child);
      if (hit) {
        return hit;
      }
    }
    return null;
  };
  const indicator = find(host as CdpNode);
  if (!indicator) {
    return null;
  }
  const { nodeIds } = await cdp.send('DOM.pushNodesByBackendIdsToFrontend', { backendNodeIds: [indicator.backendNodeId] });
  const { computedStyle } = await cdp.send('CSS.getComputedStyleForNode', { nodeId: nodeIds[0] });
  const values: Values = {};
  for (const prop of PROPERTIES) {
    values[prop] = computedStyle.find(c => c.name === prop)?.value ?? '';
  }
  return values;
}

async function readProbe(page: Page, cdp: CDPSession, probe: Probe): Promise<Values | null> {
  const handle = await page.$(probe.sel);
  if (!handle) {
    return null;
  }
  if (probe.pickerIndicator) {
    return pickerIndicatorStyle(cdp, probe.sel);
  }

  // Resolve the node before any class/attribute change, which could make the
  // selector match a different element.
  let forcedNode: number | null = null;
  if (probe.state) {
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: probe.sel });
    forcedNode = nodeId;
  }

  const previousAttr = await handle.evaluate((el, { cls, attr }) => {
    if (cls) {
      el.classList.add(cls);
    }
    if (attr) {
      const before = el.getAttribute(attr[0]);
      el.setAttribute(attr[0], attr[1]);
      return before;
    }
    return null;
  }, { cls: probe.cls, attr: probe.attr });

  if (forcedNode !== null) {
    await cdp.send('CSS.forcePseudoState', { nodeId: forcedNode, forcedPseudoClasses: probe.state ?? [] });
  }

  const props = probe.root ? [...PROPERTIES, ...ROOT_PROPERTIES] : [...PROPERTIES];
  const values = await handle.evaluate((el, { pseudo, props }) => {
    const style = getComputedStyle(el, pseudo ?? null);
    const out: Record<string, string> = {};
    for (const p of props) {
      out[p] = style.getPropertyValue(p);
    }
    return out;
  }, { pseudo: probe.pseudo, props });

  if (forcedNode !== null) {
    await cdp.send('CSS.forcePseudoState', { nodeId: forcedNode, forcedPseudoClasses: [] });
  }
  await handle.evaluate((el, { cls, attr, previousAttr }) => {
    if (cls) {
      el.classList.remove(cls);
    }
    if (attr) {
      if (previousAttr === null) {
        el.removeAttribute(attr[0]);
      }
      else {
        el.setAttribute(attr[0], previousAttr);
      }
    }
  }, { cls: probe.cls, attr: probe.attr, previousAttr });

  return values;
}

async function newContext(browser: Browser, mode: Mode, viewport = VIEWPORT): Promise<BrowserContext> {
  const context = await browser.newContext({
    colorScheme: mode.colorScheme,
    viewport,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    // The server's CSP blocks inline styles, and FREEZE_CSS is one.
    bypassCSP: true,
  });
  await context.addInitScript((css: string) => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = css;
      document.head.appendChild(style);
    });
  }, FREEZE_CSS);
  return context;
}

/** An occurrence's UTC `yyyymmdd-hhmm` slug (src/common/utils/instance-slug.ts). */
function instanceSlug(start: string): string {
  const iso = new Date(start).toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}`;
}

/** Event and occurrence paths, read from the public events API (seed dates shift relative to today). */
async function discoverPaths(baseURL: string): Promise<DiscoveredPaths> {
  const response = await fetch(`${baseURL}/api/public/v1/calendar/test_calendar/events`);
  const instances: { start: string; event: { id: string; isRecurring: boolean; media: Json } }[] = await response.json();
  const imageInstance = instances.find(i => i.event.id === IMAGE_EVENT_ID);
  const recurring = instances.find(i => i.event.isRecurring);
  if (!imageInstance || !recurring) {
    throw new Error(`Seed lacks an occurrence of ${IMAGE_EVENT_ID} or of a recurring event`);
  }
  const event = await (await fetch(`${baseURL}/api/public/v1/events/${IMAGE_EVENT_ID}?calendar=test_calendar`)).json();
  if (!event.series) {
    throw new Error(`Seed event ${IMAGE_EVENT_ID} has no series`);
  }
  return {
    eventPath: `/test_calendar/events/${IMAGE_EVENT_ID}`,
    instancePath: `/test_calendar/events/${IMAGE_EVENT_ID}/${instanceSlug(imageInstance.start)}`,
    recurringInstancePath: `/test_calendar/events/${recurring.event.id}/${instanceSlug(recurring.start)}`,
    media: imageInstance.event.media,
    series: event.series,
  };
}

function gitState(): { sha: string; dirty: boolean } {
  const sha = execSync('git rev-parse HEAD').toString().trim();
  const dirty = execSync('git status --porcelain -- src').toString().trim().length > 0;
  return { sha, dirty };
}

async function capture(outFile: string, baseUrlArg: string | null, screenshotDir: string | null): Promise<void> {
  let env: TestEnvironment | null = null;
  const baseURL = baseUrlArg ?? (env = await startTestServer({ startupTimeout: 60000 })).baseURL;
  const browser = await chromium.launch();
  const result: Capture = {
    meta: {
      ...gitState(),
      properties: [...PROPERTIES],
      rootProperties: [...ROOT_PROPERTIES],
      viewport: VIEWPORT,
      alphaEpsilon: ALPHA_EPSILON,
    },
    pages: {},
  };
  const missing: string[] = [];

  try {
    const paths = await discoverPaths(baseURL);
    for (const scenario of SCENARIOS) {
      for (const mode of scenario.modes) {
        for (const step of scenario.steps) {
          const key = `${scenario.app}/${step.name}|${mode.name}`;
          const context = await newContext(browser, mode, step.viewport);
          const page = await context.newPage();
          const cdp = await context.newCDPSession(page);
          await cdp.send('DOM.enable');
          await cdp.send('CSS.enable');

          await step.setup({ page, baseURL, mode, paths });
          await page.mouse.move(0, 0);

          const captured: PageCapture = {};
          for (const probe of step.probes) {
            const value = await readProbe(page, cdp, probe);
            captured[probeKey(probe)] = value;
            if (value === null) {
              missing.push(`${key} ${probeKey(probe)}`);
            }
          }
          result.pages[key] = captured;

          if (screenshotDir && step.screenshot?.modes.includes(mode.name)) {
            fs.mkdirSync(screenshotDir, { recursive: true });
            await page.locator(step.screenshot.selector).first().screenshot({
              path: path.join(screenshotDir, step.screenshot.file(mode.name)),
            });
          }

          await context.close();
        }
      }
    }
  }
  finally {
    await browser.close();
    if (env) {
      await env.cleanup();
    }
  }

  fs.writeFileSync(outFile, JSON.stringify(result, null, 2) + '\n');
  const pages = Object.keys(result.pages).length;
  const reads = Object.values(result.pages).reduce((n, p) => n + Object.keys(p).length, 0);
  console.log(`Wrote ${outFile}: ${pages} page/mode captures, ${reads} element reads (${result.meta.sha}${result.meta.dirty ? ', src dirty' : ''})`);
  if (missing.length) {
    console.log(`Absent (recorded as null):\n  ${missing.join('\n  ')}`);
  }
}

// ---------------------------------------------------------------------------
// Diffing
// ---------------------------------------------------------------------------

const COLOR_RE = /rgba?\(([^)]*)\)/g;

/** Parse an rgb()/rgba() body into four numbers (alpha defaults to 1). */
function parseColor(body: string): number[] | null {
  const parts = body.split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.some(Number.isNaN)) {
    return null;
  }
  return [parts[0], parts[1], parts[2], parts[3] ?? 1];
}

/**
 * True when `a` and `b` differ only in colour alpha channels, each by at most
 * ALPHA_EPSILON: same text around the colours, same colour count, identical
 * rgb channels.
 */
function equalWithinAlphaEpsilon(a: string, b: string): boolean {
  if (a.replace(COLOR_RE, 'C') !== b.replace(COLOR_RE, 'C')) {
    return false;
  }
  const colorsA = [...a.matchAll(COLOR_RE)].map(m => parseColor(m[1]));
  const colorsB = [...b.matchAll(COLOR_RE)].map(m => parseColor(m[1]));
  if (colorsA.length !== colorsB.length || colorsA.length === 0) {
    return false;
  }
  return colorsA.every((ca, i) => {
    const cb = colorsB[i];
    return ca !== null && cb !== null
      && ca[0] === cb[0] && ca[1] === cb[1] && ca[2] === cb[2]
      && Math.abs(ca[3] - cb[3]) <= ALPHA_EPSILON;
  });
}

interface Deviation {
  page: string;
  element: string;
  property: string;
  baseline: string | null;
  candidate: string | null;
}

function describe(v: Values | null | undefined): string {
  if (v === undefined) {
    return 'not probed';
  }
  return v === null ? 'absent' : 'present';
}

function diff(baselineFile: string, candidateFile: string): number {
  const baseline: Capture = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
  const candidate: Capture = JSON.parse(fs.readFileSync(candidateFile, 'utf8'));
  const real: Deviation[] = [];
  const epsilon: Deviation[] = [];

  const pageKeys = new Set([...Object.keys(baseline.pages), ...Object.keys(candidate.pages)]);
  for (const pageKey of pageKeys) {
    const bp = baseline.pages[pageKey];
    const cp = candidate.pages[pageKey];
    if (!bp || !cp) {
      real.push({ page: pageKey, element: '*', property: '*', baseline: bp ? 'captured' : 'not captured', candidate: cp ? 'captured' : 'not captured' });
      continue;
    }
    const elements = new Set([...Object.keys(bp), ...Object.keys(cp)]);
    for (const element of elements) {
      const be = bp[element];
      const ce = cp[element];
      if (!be || !ce) {
        if (describe(be) !== describe(ce)) {
          real.push({ page: pageKey, element, property: '*', baseline: describe(be), candidate: describe(ce) });
        }
        continue;
      }
      const props = new Set([...Object.keys(be), ...Object.keys(ce)]);
      for (const property of props) {
        const bv = be[property] ?? null;
        const cv = ce[property] ?? null;
        if (bv === cv) {
          continue;
        }
        const deviation = { page: pageKey, element, property, baseline: bv, candidate: cv };
        if (bv !== null && cv !== null && equalWithinAlphaEpsilon(bv, cv)) {
          epsilon.push(deviation);
        }
        else {
          real.push(deviation);
        }
      }
    }
  }

  const print = (title: string, list: Deviation[]) => {
    console.log(`\n## ${title}: ${list.length}`);
    for (const d of list) {
      console.log(`- [${d.page}] ${d.element} ${d.property}\n    baseline:  ${d.baseline}\n    candidate: ${d.candidate}`);
    }
  };
  console.log(`baseline ${baseline.meta.sha} vs candidate ${candidate.meta.sha}${candidate.meta.dirty ? ' (src dirty)' : ''}`);
  print(`Alpha-epsilon-only differences (<= ${ALPHA_EPSILON})`, epsilon);
  print('Real deviations', real);
  return real.length > 0 ? 1 : 0;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** Remove `--name value` from `args` and return the value. */
function takeFlag(args: string[], name: string): string | null {
  const i = args.indexOf(name);
  if (i < 0) {
    return null;
  }
  const [, value] = args.splice(i, 2);
  return value ?? null;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args.shift();
  if (command === 'capture') {
    const baseUrl = takeFlag(args, '--base-url');
    const screenshots = takeFlag(args, '--screenshots');
    await capture(args[0] ?? 'theme-parity-capture.json', baseUrl, screenshots);
    return;
  }
  if (command === 'diff' && args.length === 2) {
    process.exitCode = diff(args[0], args[1]);
    return;
  }
  console.error('Usage:\n  probe.ts capture [out.json] [--base-url URL] [--screenshots DIR]\n  probe.ts diff <baseline.json> <candidate.json>');
  process.exitCode = 2;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
