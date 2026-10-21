import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter, Router, RouteRecordRaw } from 'vue-router';
import { createPinia, setActivePinia, Pinia } from 'pinia';
import axios from 'axios';

import CalendarSettings from '@/client/components/logged_in/calendar-management/settings.vue';
import CalendarService from '@/client/service/calendar';
import { Calendar, CalendarContent } from '@/common/model/calendar';
import { mountComponent } from '@/client/test/lib/vue';

vi.mock('axios');

const CALENDAR_ID = 'calendar-123';
const FUNDING_URL = `/api/funding/v1/calendars/${CALENDAR_ID}/funding`;
const SITE_CONFIG_URL = '/api/config/v1/site';

const routes: RouteRecordRaw[] = [
  { path: '/', component: {}, name: 'home' },
];

/**
 * Body of GET /calendars/:calendarId/funding.
 *
 * The two fields are supplied independently on purpose. `features` is the
 * entitlement and `status` is a display label; the tests below hold them apart
 * and let them disagree, because the component is only allowed to read the
 * first when deciding what the calendar may do.
 */
function summaryResponse(widgetEmbedding: boolean, status: string) {
  return {
    data: {
      status,
      features: { widget_embedding: widgetEmbedding },
    },
  };
}

/**
 * Route the requests this screen issues. Anything else is a failure — in
 * particular the funding *options* endpoint, which this screen no longer has
 * any reason to read.
 */
function mockRequests(funding: unknown) {
  vi.mocked(axios.get).mockImplementation((url: string) => {
    if (url === FUNDING_URL) {
      return funding instanceof Error ? Promise.reject(funding) : Promise.resolve(funding);
    }
    if (url === SITE_CONFIG_URL) {
      return Promise.resolve({ data: { siteTitle: 'Example Instance' } });
    }
    return Promise.reject(new Error(`unexpected request: ${url}`));
  });
}

function createCalendar(): Calendar {
  const calendar = new Calendar(CALENDAR_ID, 'test-calendar');
  calendar.addContent(new CalendarContent('en', 'My Calendar', 'A calendar'));
  return calendar;
}

const mountSettings = async (pinia: Pinia, startPath = '/') => {
  const router: Router = createRouter({ history: createMemoryHistory(), routes });
  await router.push(startPath);
  await router.isReady();

  const wrapper = mountComponent(CalendarSettings, router, {
    pinia,
    props: { calendarId: CALENDAR_ID },
    stubs: {
      LoadingMessage: { template: '<div />' },
      ImageUpload: { template: '<div />' },
      EventImage: { template: '<div />' },
      LanguagePicker: { template: '<div />' },
      FundingSheet: { template: '<div class="funding-sheet-stub" />' },
      // The parent calls panelId/tabId on the component ref to wire up the
      // tabpanel aria attributes, so the stub has to answer them.
      LanguageTabSelector: {
        template: '<div />',
        methods: {
          panelId: (lang: string) => `panel-${lang}`,
          tabId: (lang: string) => `tab-${lang}`,
        },
      },
    },
  });

  await flushPromises();
  return { wrapper, router };
};

describe('CalendarSettings — extended features section', () => {
  let pinia: Pinia;
  let wrapper: ReturnType<typeof mountComponent> | null = null;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    vi.spyOn(CalendarService.prototype, 'getCalendarById').mockResolvedValue(createCalendar());
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
      wrapper = null;
    }
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  describe('when the gate answer is unknown', () => {
    it('renders no part of the section at all when the funding read fails', async () => {
      // The DEC-001 case, and the one this site got wrong before: the old
      // status chain let an unrecognised value fall through to the "not covered"
      // upsell branch, so a failed read told an operator their community owed
      // money. Neither half of the section may appear.
      mockRequests(new Error('funding read failed'));

      ({ wrapper } = await mountSettings(pinia));

      expect(wrapper.text()).not.toContain('Extended Features');
      expect(wrapper.find('.setting-badge--enabled').exists()).toBe(false);
      expect(wrapper.find('.setting-disable-btn').exists()).toBe(false);
      expect(wrapper.find('.funding-upsell').exists()).toBe(false);
    });
  });

  describe('when the gate is closed', () => {
    it('offers funding and claims no entitlement', async () => {
      mockRequests(summaryResponse(false, 'not_covered'));

      ({ wrapper } = await mountSettings(pinia));

      expect(wrapper.text()).toContain('Extended Features');
      expect(wrapper.find('.funding-upsell').exists()).toBe(true);
      expect(wrapper.find('.setting-badge--enabled').exists()).toBe(false);
      expect(wrapper.find('.setting-disable-btn').exists()).toBe(false);
    });
  });

  describe('when the gate is open', () => {
    it('shows the enabled badge and the disable control for a funding plan', async () => {
      mockRequests(summaryResponse(true, 'covered'));

      ({ wrapper } = await mountSettings(pinia));

      const badge = wrapper.find('.setting-badge--enabled');
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toBe('Enabled');
      // A plan is the one funding source with something to cancel.
      expect(wrapper.find('.setting-disable-btn').exists()).toBe(true);
      expect(wrapper.find('.funding-upsell').exists()).toBe(false);
    });

    it('names an admin exemption in the badge and offers nothing to cancel', async () => {
      mockRequests(summaryResponse(true, 'admin_exempt'));

      ({ wrapper } = await mountSettings(pinia));

      expect(wrapper.find('.setting-badge--enabled').text()).toBe('Included with admin account');
      expect(wrapper.find('.setting-disable-btn').exists()).toBe(false);
      expect(wrapper.find('.funding-upsell').exists()).toBe(false);
    });

    it('names a complimentary grant in the badge and offers nothing to cancel', async () => {
      mockRequests(summaryResponse(true, 'grant'));

      ({ wrapper } = await mountSettings(pinia));

      expect(wrapper.find('.setting-badge--enabled').text()).toBe('Complimentary grant');
      expect(wrapper.find('.setting-disable-btn').exists()).toBe(false);
      expect(wrapper.find('.funding-upsell').exists()).toBe(false);
    });
  });

  describe('when the status and the gate disagree', () => {
    it('refuses the feature on a calendar the status calls covered', async () => {
      // Access can expire while the plan itself is still reported as funded.
      // The gate decides capability; the status only ever names a badge.
      mockRequests(summaryResponse(false, 'covered'));

      ({ wrapper } = await mountSettings(pinia));

      expect(wrapper.find('.funding-upsell').exists()).toBe(true);
      expect(wrapper.find('.setting-badge--enabled').exists()).toBe(false);
      expect(wrapper.find('.setting-disable-btn').exists()).toBe(false);
    });

    it('grants the feature on a calendar the status calls not covered', async () => {
      // What an instance that does not charge looks like: no funding
      // relationship to report, every gate open, and nothing to sell.
      mockRequests(summaryResponse(true, 'not_covered'));

      ({ wrapper } = await mountSettings(pinia));

      expect(wrapper.find('.setting-badge--enabled').text()).toBe('Enabled');
      expect(wrapper.find('.funding-upsell').exists()).toBe(false);
      // Nothing to cancel: 'not_covered' names no plan, whatever opened the gate.
      expect(wrapper.find('.setting-disable-btn').exists()).toBe(false);
    });
  });

  describe('when a redirect-based checkout returns to this page', () => {
    const SESSION_ID = 'cs_test_returned123';
    const STATUS_URL = `/api/funding/v1/checkout-sessions/${SESSION_ID}/status`;

    /**
     * The funding summary flips to covered once the session has been
     * verified, as it does on the server, which records the plan when it
     * sees a complete session.
     */
    function mockReturn(sessionStatus: string) {
      let verified = false;
      vi.mocked(axios.get).mockImplementation((url: string) => {
        if (url === STATUS_URL) {
          verified = sessionStatus === 'complete';
          return Promise.resolve({ data: { status: sessionStatus } });
        }
        if (url === FUNDING_URL) {
          return Promise.resolve(verified
            ? summaryResponse(true, 'covered')
            : summaryResponse(false, 'not_covered'));
        }
        if (url === SITE_CONFIG_URL) {
          return Promise.resolve({ data: { siteTitle: 'Example Instance' } });
        }
        return Promise.reject(new Error(`unexpected request: ${url}`));
      });
    }

    it('confirms the plan, switches the section to granted and drops session_id', async () => {
      mockReturn('complete');

      let router: Router;
      ({ wrapper, router } = await mountSettings(pinia, `/?session_id=${SESSION_ID}`));

      expect(axios.get).toHaveBeenCalledWith(STATUS_URL);
      expect(wrapper.find('.alert--success').text()).toBe('Extended features enabled for this calendar.');
      expect(wrapper.find('.setting-badge--enabled').exists()).toBe(true);
      expect(wrapper.find('.funding-upsell').exists()).toBe(false);
      expect(router.currentRoute.value.query).toEqual({});
    });

    it('says the plan could not be confirmed when the session expired', async () => {
      mockReturn('expired');

      ({ wrapper } = await mountSettings(pinia, `/?session_id=${SESSION_ID}`));

      expect(wrapper.find('.alert--error').text()).toContain('couldn\'t confirm your funding plan');
      expect(wrapper.find('.alert--success').exists()).toBe(false);
    });

    it('ignores an unsubstituted session id placeholder', async () => {
      mockReturn('complete');

      let router: Router;
      ({ wrapper, router } = await mountSettings(pinia, '/?session_id={CHECKOUT_SESSION_ID}'));

      expect(axios.get).not.toHaveBeenCalledWith(expect.stringContaining('/checkout-sessions/'));
      expect(wrapper.find('.alert--success').exists()).toBe(false);
      expect(wrapper.find('.alert--error').exists()).toBe(false);
      expect(router.currentRoute.value.query).toEqual({});
    });
  });
});
