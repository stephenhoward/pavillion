import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import sinon from 'sinon';
import express, { Application } from 'express';
import supertest from 'supertest';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';
import axios from 'axios';
import { DateTime } from 'luxon';

import { Calendar } from '@/common/model/calendar';
import CalendarInterface from '@/server/calendar/interface';
import WidgetDomainService from '@/server/calendar/service/widget_domain';
import WidgetRoutes from '@/server/calendar/api/v1/widget';
import WidgetEmbed from '@/client/components/logged_in/calendar-management/widget-embed.vue';
import WidgetConfig from '@/client/components/logged_in/calendar-management/widget-config.vue';
import WeekView from '@/widget/components/WeekView.vue';
import MonthView from '@/widget/components/MonthView.vue';
import ListView from '@/widget/components/ListView.vue';
import { useWidgetStore } from '@/widget/stores/widgetStore';
import { usePublicCalendarStore } from '@/site/stores/publicCalendarStore';

describe('Widget Integration Tests', () => {
  let app: Application;
  let sandbox: sinon.SinonSandbox;
  let calendar: Calendar;
  let mockInterface: CalendarInterface;
  let mockWidgetService: WidgetDomainService;

  beforeAll(async () => {
    // Initialize i18next for all tests
    await i18next.init({
      lng: 'en',
      fallbackLng: 'en',
      resources: {
        en: {
          calendars: {
            widget: {
              embed: {
                title: 'Embed Code',
                description: 'Copy this code',
                copy_button: 'Copy',
                copied: 'Copied!',
              },
              config: {
                view_mode_list: 'List',
                view_mode_week: 'Week',
                view_mode_month: 'Month',
                color_mode_auto: 'Auto',
                color_mode_light: 'Light',
                color_mode_dark: 'Dark',
              },
            },
          },
          system: {
            loading_events: 'Loading...',
            no_events_available: 'No events',
            previous_week: 'Previous',
            next_week: 'Next',
            previous_month: 'Previous Month',
            next_month: 'Next Month',
          },
        },
      },
    });
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    setActivePinia(createPinia());

    // Create express app for API testing
    app = express();
    app.use(express.json());

    // Create mock calendar and services
    calendar = new Calendar('test-id', 'my-calendar');
    mockInterface = {
      getCalendarByName: sandbox.stub(),
      getCalendarForWidget: sandbox.stub(),
    } as any;
    mockWidgetService = new WidgetDomainService();

    // Install widget routes
    const widgetRoutes = new WidgetRoutes(mockInterface, mockWidgetService);
    widgetRoutes.installHandlers(app, '/api/widget/v1');

    // Stub the calendar lookup
    (mockInterface.getCalendarByName as sinon.SinonStub).resolves(calendar);
    (mockInterface.getCalendarForWidget as sinon.SinonStub).resolves(calendar);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('End-to-end widget embedding workflow', () => {
    it('should complete full workflow: configure → generate code → validate embedding', async () => {
      // Step 1: Configure widget in admin UI
      const configWrapper = mount(WidgetConfig, {
        props: {
          calendarId: 'test-id',
          calendarUrlName: 'my-calendar',
        },
        global: {
          plugins: [[I18NextVue, { i18next }]],
        },
      });

      // Select week view by clicking the week card button
      const weekCard = configWrapper.findAll('button.view-mode-card')[1]; // list=0, week=1, month=2
      await weekCard.trigger('click');

      // Set accent color
      const colorInput = configWrapper.find('input[type="color"]');
      await colorInput.setValue('#ff9131');

      // Verify configuration state
      const configVm = configWrapper.vm as any;
      expect(configVm.state.viewMode).toBe('week');
      expect(configVm.state.accentColor).toBe('#ff9131');

      // Step 2: Generate embed code
      const embedWrapper = mount(WidgetEmbed, {
        props: {
          calendarUrlName: 'my-calendar',
          viewMode: 'week',
          accentColor: '#ff9131',
          colorMode: 'auto',
        },
        global: {
          plugins: [[I18NextVue, { i18next }]],
        },
      });

      const embedCode = embedWrapper.find('.embed-code').text();
      expect(embedCode).toContain('my-calendar');
      expect(embedCode).toContain('view: \'week\'');
      expect(embedCode).toContain('accentColor: \'#ff9131\'');

      // Step 3: Validate widget loads with correct configuration
      const widgetStore = useWidgetStore();
      const urlParams = new URLSearchParams('view=week&accentColor=%23ff9131&colorMode=auto');
      widgetStore.parseConfig(urlParams);

      expect(widgetStore.viewMode).toBe('week');
      expect(widgetStore.accentColor).toBe('#ff9131');
      expect(widgetStore.colorMode).toBe('auto');

      // Step 4: Verify API endpoint is accessible
      const response = await supertest(app)
        .get('/api/widget/v1/calendars/my-calendar')
        .set('Origin', 'http://localhost:3000')
        .expect(200);

      expect(response.body.urlName).toBe('my-calendar');
    });
  });

  describe('Unauthorized domain blocking with clear error', () => {
    it('should block unauthorized domain and return clear error message', async () => {
      // Stub origin validation to reject the domain
      const isOriginAllowedStub = sandbox.stub(mockWidgetService, 'isOriginAllowed');
      isOriginAllowedStub.resolves(false);

      const response = await supertest(app)
        .get('/api/widget/v1/calendars/my-calendar')
        .set('Origin', 'https://unauthorized-site.com')
        .expect(403);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('not authorized');
      expect(response.body.error.toLowerCase()).toContain('domain');
    });

    it('should provide helpful error when Origin header is missing', async () => {
      const response = await supertest(app)
        .get('/api/widget/v1/calendars/my-calendar')
        .expect(403);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error.toLowerCase()).toContain('origin');
    });
  });

  describe('Localhost exception without configuration', () => {
    it('should allow localhost without any domain configuration', async () => {
      // No domains configured in the database
      const response = await supertest(app)
        .get('/api/widget/v1/calendars/my-calendar')
        .set('Origin', 'http://localhost:8080')
        .expect(200);

      expect(response.body.urlName).toBe('my-calendar');
    });

    it('should allow 127.0.0.1 without configuration', async () => {
      const response = await supertest(app)
        .get('/api/widget/v1/calendars/my-calendar')
        .set('Origin', 'http://127.0.0.1:3000')
        .expect(200);

      expect(response.body.urlName).toBe('my-calendar');
    });
  });

  describe('All three view modes render correctly', () => {
    const createMockRouter = () => {
      return createRouter({
        history: createMemoryHistory(),
        routes: [
          { path: '/widget/:urlName', name: 'widget-calendar', component: { template: '<div></div>' } },
        ],
      });
    };

    it('should render week view with 7-day grid', async () => {
      const router = createMockRouter();
      const wrapper = mount(WeekView, {
        global: {
          plugins: [[I18NextVue, { i18next }], router],
        },
      });

      const weekGrid = wrapper.find('.week-grid');
      expect(weekGrid.exists()).toBe(true);

      const dayColumns = wrapper.findAll('.week-day-column');
      expect(dayColumns.length).toBe(7);
    });

    it('should render month view with calendar grid', async () => {
      const router = createMockRouter();
      const wrapper = mount(MonthView, {
        global: {
          plugins: [[I18NextVue, { i18next }], router],
        },
      });

      const monthGrid = wrapper.find('.month-grid');
      expect(monthGrid.exists()).toBe(true);

      const dayCells = wrapper.findAll('.month-day-cell');
      expect(dayCells.length).toBeGreaterThanOrEqual(35);
    });

    it('should render list view with day groups', async () => {
      const router = createMockRouter();
      const publicStore = usePublicCalendarStore();

      // Mock an event - use allEvents property (not events)
      publicStore.allEvents = [
        {
          id: '1',
          start: { toISODate: () => '2026-01-06', toLocaleString: () => '10:00 AM' },
          event: { id: 'e1', content: () => ({ name: 'Test Event' }), media: null, categories: [] },
        },
      ] as any;

      const wrapper = mount(ListView, {
        global: {
          plugins: [[I18NextVue, { i18next }], router],
        },
      });

      // The events are in a ul.events element inside a conditional block
      const eventsList = wrapper.find('ul.events');
      expect(eventsList.exists()).toBe(true);
    });
  });

  describe('Resize communication between SDK and iframe', () => {
    it('should send resize message when content height changes', async () => {
      const widgetStore = useWidgetStore();

      // Mock parent window
      const mockParent = {
        postMessage: vi.fn(),
      };

      const originalParent = Object.getOwnPropertyDescriptor(window, 'parent');
      Object.defineProperty(window, 'parent', {
        configurable: true,
        writable: true,
        value: mockParent,
      });

      // Trigger resize notification
      widgetStore.notifyResize(800);

      expect(mockParent.postMessage).toHaveBeenCalledWith(
        { type: 'pavillion:resize', height: 800 },
        '*',
      );

      // Restore
      if (originalParent) {
        Object.defineProperty(window, 'parent', originalParent);
      }
    });
  });

  describe('Accent color customization applies correctly', () => {
    it('should inject accent color as CSS custom property', () => {
      const mockRoot = document.createElement('div');
      document.body.appendChild(mockRoot);

      const widgetStore = useWidgetStore();
      const urlParams = new URLSearchParams('accentColor=%23ff9131');
      widgetStore.parseConfig(urlParams);

      widgetStore.injectAccentColor(mockRoot);

      const appliedColor = mockRoot.style.getPropertyValue('--widget-accent-color');
      expect(appliedColor).toBe('#ff9131');

      document.body.removeChild(mockRoot);
    });
  });

  describe('Color mode switching (auto/light/dark)', () => {
    it('should apply light theme class when colorMode=light', () => {
      const mockRoot = document.createElement('div');
      document.body.appendChild(mockRoot);

      const widgetStore = useWidgetStore();
      const urlParams = new URLSearchParams('colorMode=light');
      widgetStore.parseConfig(urlParams);

      widgetStore.applyColorMode(mockRoot);

      expect(mockRoot.classList.contains('widget-theme-light')).toBe(true);
      expect(mockRoot.classList.contains('widget-theme-dark')).toBe(false);

      document.body.removeChild(mockRoot);
    });

    it('should apply dark theme class when colorMode=dark', () => {
      const mockRoot = document.createElement('div');
      document.body.appendChild(mockRoot);

      const widgetStore = useWidgetStore();
      const urlParams = new URLSearchParams('colorMode=dark');
      widgetStore.parseConfig(urlParams);

      widgetStore.applyColorMode(mockRoot);

      expect(mockRoot.classList.contains('widget-theme-dark')).toBe(true);
      expect(mockRoot.classList.contains('widget-theme-light')).toBe(false);

      document.body.removeChild(mockRoot);
    });

    it('should not apply theme class when colorMode=auto (uses media query)', () => {
      const mockRoot = document.createElement('div');
      document.body.appendChild(mockRoot);

      const widgetStore = useWidgetStore();
      const urlParams = new URLSearchParams('colorMode=auto');
      widgetStore.parseConfig(urlParams);

      widgetStore.applyColorMode(mockRoot);

      expect(mockRoot.classList.contains('widget-theme-light')).toBe(false);
      expect(mockRoot.classList.contains('widget-theme-dark')).toBe(false);

      document.body.removeChild(mockRoot);
    });
  });

  describe('Widget performance with 100+ events', () => {
    it('should handle large event datasets efficiently', async () => {
      const publicStore = usePublicCalendarStore();
      const router = createRouter({
        history: createMemoryHistory(),
        routes: [
          { path: '/widget/:urlName', name: 'widget-calendar', component: { template: '<div></div>' } },
        ],
      });

      // Create 100+ mock events spread across the current week
      // WeekView only shows events for the current week, so we need dates that match
      const events = [];
      const baseDate = DateTime.now().startOf('week');
      for (let i = 0; i < 120; i++) {
        // Spread events across 7 days of the week (ensures some days have > 3 events for overflow)
        const dayOffset = i % 7;
        const eventDate = baseDate.plus({ days: dayOffset });
        events.push({
          id: `event-${i}`,
          start: {
            toISODate: () => eventDate.toISODate(),
            toLocaleString: () => `${i % 12}:00 ${i % 12 >= 12 ? 'PM' : 'AM'}`,
          },
          event: {
            id: `e${i}`,
            content: () => ({ name: `Event ${i}` }),
            media: null,
            categories: [],
          },
        });
      }

      // Use allEvents property (not events)
      publicStore.allEvents = events as any;

      // Mount WeekView and verify it renders without issues
      const startTime = performance.now();

      const wrapper = mount(WeekView, {
        global: {
          plugins: [[I18NextVue, { i18next }], router],
        },
      });

      const endTime = performance.now();
      const renderTime = endTime - startTime;

      // Verify component rendered
      expect(wrapper.find('.week-grid').exists()).toBe(true);

      // Performance check: should render in under 1 second
      expect(renderTime).toBeLessThan(1000);

      // With 120 events spread across 7 days (~17 events/day), overflow indicators should appear
      // since MAX_VISIBLE_EVENTS is 3. Each day will show "+14 more" or similar.
      const overflowIndicators = wrapper.findAll('.event-overflow');
      expect(overflowIndicators.length).toBeGreaterThan(0);
    });
  });
});
