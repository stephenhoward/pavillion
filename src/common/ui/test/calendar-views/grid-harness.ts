/**
 * Shared fixtures for the WeekView and MonthView tests.
 *
 * Both grids resolve RouterLinks and read the active locale through
 * useLocale(), so they mount under a real memory-history router and an
 * i18next instance carrying the `ui` bundles every app registers.
 */
import { vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createRouter, createMemoryHistory, type RouteLocationRaw } from 'vue-router';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';
import { DateTime } from 'luxon';
import type { Component } from 'vue';

import CalendarEventInstance from '@/common/model/event_instance';
import { CalendarEvent, CalendarEventContent } from '@/common/model/events';
import { uiResources } from '@/common/ui/locales';

export async function initI18n(language = 'en'): Promise<void> {
  await i18next.init({
    lng: language,
    fallbackLng: 'en',
    supportedLngs: ['en', 'es', 'fr'],
    resources: uiResources,
    showSupportNotice: false,
  });
  await i18next.changeLanguage(language);
}

export function makeRouter() {
  const stub = { template: '<div></div>' };
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: stub },
      { path: '/:calendar', name: 'calendar', component: stub },
      { path: '/:calendar/events/:event', name: 'event', component: stub },
    ],
  });
}

/** An instance on `start` whose event carries a name in each given language. */
export function makeInstance(
  id: string,
  start: DateTime,
  names: Record<string, string> = { en: `Event ${id}` },
): CalendarEventInstance {
  const event = new CalendarEvent(`event-${id}`, 'cal-1');
  for (const [language, name] of Object.entries(names)) {
    event.addContent(new CalendarEventContent(language, name));
  }
  return new CalendarEventInstance(id, event, start, null);
}

export function routeBuilders() {
  return {
    eventRoute: vi.fn((instance: CalendarEventInstance): RouteLocationRaw => ({
      name: 'event',
      params: { calendar: 'mycal', event: instance.event.id },
    })),
    dayRoute: vi.fn((isoDate: string): RouteLocationRaw => ({
      name: 'calendar',
      params: { calendar: 'mycal' },
      query: { date: isoDate },
    })),
  };
}

export async function mountGrid(
  component: Component,
  props: Record<string, unknown>,
): Promise<VueWrapper> {
  const router = makeRouter();
  await router.push('/');
  await router.isReady();

  return mount(component, {
    props,
    global: { plugins: [router, [I18NextVue, { i18next }]] },
  });
}
