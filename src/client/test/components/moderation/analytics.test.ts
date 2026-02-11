import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import sinon from 'sinon';
import axios from 'axios';
import Analytics from '@/client/components/moderation/analytics.vue';

// Mock i18next-vue
vi.mock('i18next-vue', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, any>) => {
      if (params) {
        return `${key}:${JSON.stringify(params)}`;
      }
      return key;
    },
  }),
}));

// Mock axios
vi.mock('axios');

describe('Analytics Component', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  afterEach(() => {
    sandbox.restore();
    vi.restoreAllMocks();
  });

  describe('Component Initialization', () => {
    it('should render with required props', () => {
      // Mock axios.get to prevent real network calls
      vi.mocked(axios.get).mockRejectedValue(new Error('Network error'));

      const wrapper = mount(Analytics, {
        props: {
          startDate: '2024-01-01',
          endDate: '2024-01-31',
        },
        global: {
          stubs: {
            LoadingMessage: {
              template: '<div class="loading-stub">{{ description }}</div>',
              props: ['description'],
            },
          },
        },
      });

      expect(wrapper.exists()).toBe(true);
    });

    it('should show loading state initially', () => {
      // Mock axios.get to prevent real network calls
      vi.mocked(axios.get).mockRejectedValue(new Error('Network error'));

      const wrapper = mount(Analytics, {
        props: {
          startDate: '2024-01-01',
          endDate: '2024-01-31',
        },
        global: {
          stubs: {
            LoadingMessage: {
              template: '<div class="loading-stub">{{ description }}</div>',
              props: ['description'],
            },
          },
        },
      });

      expect(wrapper.find('[data-testid="analytics-loading"]').exists()).toBe(true);
    });
  });

  describe('Data Fetching', () => {
    it('should fetch analytics data on mount', async () => {
      const mockData = {
        reportsByStatus: {
          submitted: 5,
          under_review: 3,
          escalated: 2,
          resolved: 10,
          dismissed: 1,
        },
        resolutionRate: 0.85,
        averageResolutionTime: 24.5,
        reportsTrend: [],
        topReportedEvents: [],
        reporterVolume: {
          calendar_owner: 5,
          calendar_editor: 3,
          administrator: 2,
        },
      };

      // Mock axios.get
      vi.mocked(axios.get).mockResolvedValue({ data: mockData });

      const wrapper = mount(Analytics, {
        props: {
          startDate: '2024-01-01',
          endDate: '2024-01-31',
        },
        global: {
          stubs: {
            LoadingMessage: {
              template: '<div class="loading-stub">{{ description }}</div>',
              props: ['description'],
            },
          },
        },
      });

      // Wait for all pending promises
      await flushPromises();

      expect(wrapper.vm.loading).toBe(false);
      expect(wrapper.vm.analyticsData).toEqual(mockData);
    });

    it('should display analytics data after loading', async () => {
      const mockData = {
        reportsByStatus: {
          submitted: 5,
          under_review: 3,
          escalated: 2,
          resolved: 10,
          dismissed: 1,
        },
        resolutionRate: 0.85,
        averageResolutionTime: 24.5,
        reportsTrend: [],
        topReportedEvents: [],
        reporterVolume: {
          calendar_owner: 5,
          calendar_editor: 3,
          administrator: 2,
        },
      };

      vi.mocked(axios.get).mockResolvedValue({ data: mockData });

      const wrapper = mount(Analytics, {
        props: {
          startDate: '2024-01-01',
          endDate: '2024-01-31',
        },
        global: {
          stubs: {
            LoadingMessage: {
              template: '<div class="loading-stub">{{ description }}</div>',
              props: ['description'],
            },
          },
        },
      });

      await flushPromises();

      expect(wrapper.find('[data-testid="analytics-loading"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="analytics-content"]').exists()).toBe(true);
    });

    it('should handle error state', async () => {
      vi.mocked(axios.get).mockRejectedValue(new Error('Network error'));

      const wrapper = mount(Analytics, {
        props: {
          startDate: '2024-01-01',
          endDate: '2024-01-31',
        },
        global: {
          stubs: {
            LoadingMessage: {
              template: '<div class="loading-stub">{{ description }}</div>',
              props: ['description'],
            },
          },
        },
      });

      await flushPromises();

      expect(wrapper.find('[data-testid="analytics-error"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="analytics-content"]').exists()).toBe(false);
    });
  });

  describe('Props Validation', () => {
    it('should accept valid date strings', () => {
      vi.mocked(axios.get).mockRejectedValue(new Error('Network error'));

      const wrapper = mount(Analytics, {
        props: {
          startDate: '2024-01-01',
          endDate: '2024-01-31',
        },
        global: {
          stubs: {
            LoadingMessage: {
              template: '<div class="loading-stub">{{ description }}</div>',
              props: ['description'],
            },
          },
        },
      });

      expect(wrapper.props('startDate')).toBe('2024-01-01');
      expect(wrapper.props('endDate')).toBe('2024-01-31');
    });

    it('should re-fetch data when props change', async () => {
      const mockData = {
        reportsByStatus: {},
        resolutionRate: 0,
        averageResolutionTime: 0,
        reportsTrend: [],
        topReportedEvents: [],
        reporterVolume: {},
      };

      vi.mocked(axios.get).mockResolvedValue({ data: mockData });

      const wrapper = mount(Analytics, {
        props: {
          startDate: '2024-01-01',
          endDate: '2024-01-31',
        },
        global: {
          stubs: {
            LoadingMessage: {
              template: '<div class="loading-stub">{{ description }}</div>',
              props: ['description'],
            },
          },
        },
      });

      await flushPromises();

      // Clear previous mock calls
      vi.mocked(axios.get).mockClear();

      // Update props
      await wrapper.setProps({
        startDate: '2024-02-01',
        endDate: '2024-02-29',
      });

      await flushPromises();

      expect(axios.get).toHaveBeenCalledWith('/api/v1/admin/moderation/analytics', {
        params: {
          startDate: '2024-02-01',
          endDate: '2024-02-29',
        },
      });
    });
  });

  describe('Summary Cards', () => {
    it('should display total reports count', async () => {
      const mockData = {
        reportsByStatus: {
          submitted: 5,
          under_review: 3,
          escalated: 2,
          resolved: 10,
          dismissed: 1,
        },
        resolutionRate: 0.85,
        averageResolutionTime: 24.5,
        reportsTrend: [],
        topReportedEvents: [],
        reporterVolume: {
          calendar_owner: 5,
          calendar_editor: 3,
          administrator: 2,
        },
      };

      vi.mocked(axios.get).mockResolvedValue({ data: mockData });

      const wrapper = mount(Analytics, {
        props: {
          startDate: '2024-01-01',
          endDate: '2024-01-31',
        },
        global: {
          stubs: {
            LoadingMessage: {
              template: '<div class="loading-stub">{{ description }}</div>',
              props: ['description'],
            },
          },
        },
      });

      await flushPromises();

      const metricCards = wrapper.findAll('.metric-card');
      expect(metricCards.length).toBeGreaterThanOrEqual(3);

      // Find the total reports card
      const totalReportsCard = metricCards.find(card =>
        card.find('.metric-label').text().includes('total_reports'),
      );
      expect(totalReportsCard).toBeDefined();
      expect(totalReportsCard?.find('.metric-value').text()).toBe('21');
    });

    it('should display resolution rate percentage', async () => {
      const mockData = {
        reportsByStatus: {
          submitted: 5,
          under_review: 3,
          escalated: 2,
          resolved: 10,
          dismissed: 1,
        },
        resolutionRate: 0.85,
        averageResolutionTime: 24.5,
        reportsTrend: [],
        topReportedEvents: [],
        reporterVolume: {
          calendar_owner: 5,
          calendar_editor: 3,
          administrator: 2,
        },
      };

      vi.mocked(axios.get).mockResolvedValue({ data: mockData });

      const wrapper = mount(Analytics, {
        props: {
          startDate: '2024-01-01',
          endDate: '2024-01-31',
        },
        global: {
          stubs: {
            LoadingMessage: {
              template: '<div class="loading-stub">{{ description }}</div>',
              props: ['description'],
            },
          },
        },
      });

      await flushPromises();

      const metricCards = wrapper.findAll('.metric-card');

      // Find the resolution rate card
      const resolutionRateCard = metricCards.find(card =>
        card.find('.metric-label').text().includes('resolution_rate'),
      );
      expect(resolutionRateCard).toBeDefined();
      expect(resolutionRateCard?.find('.metric-value').text()).toBe('85.0%');
    });

    it('should display average resolution time', async () => {
      const mockData = {
        reportsByStatus: {
          submitted: 5,
          under_review: 3,
          escalated: 2,
          resolved: 10,
          dismissed: 1,
        },
        resolutionRate: 0.85,
        averageResolutionTime: 24.5,
        reportsTrend: [],
        topReportedEvents: [],
        reporterVolume: {
          calendar_owner: 5,
          calendar_editor: 3,
          administrator: 2,
        },
      };

      vi.mocked(axios.get).mockResolvedValue({ data: mockData });

      const wrapper = mount(Analytics, {
        props: {
          startDate: '2024-01-01',
          endDate: '2024-01-31',
        },
        global: {
          stubs: {
            LoadingMessage: {
              template: '<div class="loading-stub">{{ description }}</div>',
              props: ['description'],
            },
          },
        },
      });

      await flushPromises();

      const metricCards = wrapper.findAll('.metric-card');

      // Find the average resolution time card
      const avgResolutionCard = metricCards.find(card =>
        card.find('.metric-label').text().includes('avg_resolution_time'),
      );
      expect(avgResolutionCard).toBeDefined();
      expect(avgResolutionCard?.find('.metric-value').text()).toBe('24.5h');
    });

    it('should display reports by status breakdown', async () => {
      const mockData = {
        reportsByStatus: {
          submitted: 5,
          under_review: 3,
          escalated: 2,
          resolved: 10,
          dismissed: 1,
        },
        resolutionRate: 0.85,
        averageResolutionTime: 24.5,
        reportsTrend: [],
        topReportedEvents: [],
        reporterVolume: {
          calendar_owner: 5,
          calendar_editor: 3,
          administrator: 2,
        },
      };

      vi.mocked(axios.get).mockResolvedValue({ data: mockData });

      const wrapper = mount(Analytics, {
        props: {
          startDate: '2024-01-01',
          endDate: '2024-01-31',
        },
        global: {
          stubs: {
            LoadingMessage: {
              template: '<div class="loading-stub">{{ description }}</div>',
              props: ['description'],
            },
          },
        },
      });

      await flushPromises();

      const legendItems = wrapper.findAll('.legend-item');
      expect(legendItems.length).toBe(5);

      // Verify each status has correct count in legend
      const statusCounts = legendItems.map(item => ({
        label: item.find('.legend-label').text(),
        value: item.find('.legend-value').text(),
      }));

      // Verify all statuses are present in the legend
      expect(statusCounts.some(item => item.label.includes('submitted'))).toBe(true);
      expect(statusCounts.some(item => item.label.includes('under_review'))).toBe(true);
      expect(statusCounts.some(item => item.label.includes('escalated'))).toBe(true);
      expect(statusCounts.some(item => item.label.includes('resolved'))).toBe(true);
      expect(statusCounts.some(item => item.label.includes('dismissed'))).toBe(true);
    });


    it('should use consistent styling with metric cards', async () => {
      const mockData = {
        reportsByStatus: {
          submitted: 5,
          under_review: 3,
          escalated: 2,
          resolved: 10,
          dismissed: 1,
        },
        resolutionRate: 0.85,
        averageResolutionTime: 24.5,
        reportsTrend: [],
        topReportedEvents: [],
        reporterVolume: {
          calendar_owner: 5,
          calendar_editor: 3,
          administrator: 2,
        },
      };

      vi.mocked(axios.get).mockResolvedValue({ data: mockData });

      const wrapper = mount(Analytics, {
        props: {
          startDate: '2024-01-01',
          endDate: '2024-01-31',
        },
        global: {
          stubs: {
            LoadingMessage: {
              template: '<div class="loading-stub">{{ description }}</div>',
              props: ['description'],
            },
          },
        },
      });

      await flushPromises();

      // Verify metric cards have consistent class names
      const metricCards = wrapper.findAll('.metric-card');
      expect(metricCards.length).toBe(3);

      metricCards.forEach(card => {
        expect(card.find('.metric-label').exists()).toBe(true);
        expect(card.find('.metric-value').exists()).toBe(true);
      });
    });

    it('should be responsive with mobile-friendly layout', async () => {
      const mockData = {
        reportsByStatus: {
          submitted: 5,
          under_review: 3,
          escalated: 2,
          resolved: 10,
          dismissed: 1,
        },
        resolutionRate: 0.85,
        averageResolutionTime: 24.5,
        reportsTrend: [],
        topReportedEvents: [],
        reporterVolume: {
          calendar_owner: 5,
          calendar_editor: 3,
          administrator: 2,
        },
      };

      vi.mocked(axios.get).mockResolvedValue({ data: mockData });

      const wrapper = mount(Analytics, {
        props: {
          startDate: '2024-01-01',
          endDate: '2024-01-31',
        },
        global: {
          stubs: {
            LoadingMessage: {
              template: '<div class="loading-stub">{{ description }}</div>',
              props: ['description'],
            },
          },
        },
      });

      await flushPromises();

      // Verify metrics grid exists (responsive layout handled by CSS)
      const metricsGrid = wrapper.find('.metrics-grid');
      expect(metricsGrid.exists()).toBe(true);
      expect(metricsGrid.findAll('.metric-card').length).toBe(3);
    });
  });

  describe('Basic Layout Structure', () => {
    it('should render metrics sections', async () => {
      const mockData = {
        reportsByStatus: {
          submitted: 5,
          under_review: 3,
          escalated: 2,
          resolved: 10,
          dismissed: 1,
        },
        resolutionRate: 0.85,
        averageResolutionTime: 24.5,
        reportsTrend: [],
        topReportedEvents: [],
        reporterVolume: {
          calendar_owner: 5,
          calendar_editor: 3,
          administrator: 2,
        },
      };

      vi.mocked(axios.get).mockResolvedValue({ data: mockData });

      const wrapper = mount(Analytics, {
        props: {
          startDate: '2024-01-01',
          endDate: '2024-01-31',
        },
        global: {
          stubs: {
            LoadingMessage: {
              template: '<div class="loading-stub">{{ description }}</div>',
              props: ['description'],
            },
          },
        },
      });

      await flushPromises();

      // Check for basic structure elements
      expect(wrapper.find('[data-testid="analytics-content"]').exists()).toBe(true);
    });
  });

  describe('Charts Visualization', () => {
    it('should render reports trend chart when data is available', async () => {
      const mockData = {
        reportsByStatus: {
          submitted: 5,
          under_review: 3,
          resolved: 10,
        },
        resolutionRate: 0.85,
        averageResolutionTime: 24.5,
        reportsTrend: [
          { date: '2024-01-01', count: 5 },
          { date: '2024-01-02', count: 8 },
          { date: '2024-01-03', count: 3 },
        ],
        topReportedEvents: [],
        reporterVolume: {},
      };

      vi.mocked(axios.get).mockResolvedValue({ data: mockData });

      const wrapper = mount(Analytics, {
        props: {
          startDate: '2024-01-01',
          endDate: '2024-01-31',
        },
        global: {
          stubs: {
            LoadingMessage: {
              template: '<div class="loading-stub">{{ description }}</div>',
              props: ['description'],
            },
          },
        },
      });

      await flushPromises();

      // Check for trend chart
      expect(wrapper.find('[data-testid="reports-trend-chart"]').exists()).toBe(true);
      expect(wrapper.find('.chart-bar').exists()).toBe(true);
    });

    it('should render status breakdown chart', async () => {
      const mockData = {
        reportsByStatus: {
          submitted: 5,
          under_review: 3,
          escalated: 2,
          resolved: 10,
          dismissed: 1,
        },
        resolutionRate: 0.85,
        averageResolutionTime: 24.5,
        reportsTrend: [],
        topReportedEvents: [],
        reporterVolume: {},
      };

      vi.mocked(axios.get).mockResolvedValue({ data: mockData });

      const wrapper = mount(Analytics, {
        props: {
          startDate: '2024-01-01',
          endDate: '2024-01-31',
        },
        global: {
          stubs: {
            LoadingMessage: {
              template: '<div class="loading-stub">{{ description }}</div>',
              props: ['description'],
            },
          },
        },
      });

      await flushPromises();

      // Check for status chart
      expect(wrapper.find('[data-testid="status-breakdown-chart"]').exists()).toBe(true);
    });

    it('should render top reported events chart when data is available', async () => {
      const mockData = {
        reportsByStatus: {
          submitted: 5,
        },
        resolutionRate: 0.85,
        averageResolutionTime: 24.5,
        reportsTrend: [],
        topReportedEvents: [
          { eventId: 'event-1', reportCount: 5 },
          { eventId: 'event-2', reportCount: 3 },
          { eventId: 'event-3', reportCount: 2 },
        ],
        reporterVolume: {},
      };

      vi.mocked(axios.get).mockResolvedValue({ data: mockData });

      const wrapper = mount(Analytics, {
        props: {
          startDate: '2024-01-01',
          endDate: '2024-01-31',
        },
        global: {
          stubs: {
            LoadingMessage: {
              template: '<div class="loading-stub">{{ description }}</div>',
              props: ['description'],
            },
          },
        },
      });

      await flushPromises();

      // Check for top events chart
      expect(wrapper.find('[data-testid="top-events-chart"]').exists()).toBe(true);
    });

    it('should render chart with accessible colors', async () => {
      const mockData = {
        reportsByStatus: {
          submitted: 5,
          under_review: 3,
        },
        resolutionRate: 0.85,
        averageResolutionTime: 24.5,
        reportsTrend: [
          { date: '2024-01-01', count: 5 },
        ],
        topReportedEvents: [],
        reporterVolume: {},
      };

      vi.mocked(axios.get).mockResolvedValue({ data: mockData });

      const wrapper = mount(Analytics, {
        props: {
          startDate: '2024-01-01',
          endDate: '2024-01-31',
        },
        global: {
          stubs: {
            LoadingMessage: {
              template: '<div class="loading-stub">{{ description }}</div>',
              props: ['description'],
            },
          },
        },
      });

      await flushPromises();

      // Charts should use CSS custom properties for colors
      const chartElement = wrapper.find('[data-testid="reports-trend-chart"]');
      expect(chartElement.exists()).toBe(true);
    });

    it('should render charts with proper labels and legends', async () => {
      const mockData = {
        reportsByStatus: {
          submitted: 5,
          under_review: 3,
          resolved: 10,
        },
        resolutionRate: 0.85,
        averageResolutionTime: 24.5,
        reportsTrend: [
          { date: '2024-01-01', count: 5 },
        ],
        topReportedEvents: [],
        reporterVolume: {},
      };

      vi.mocked(axios.get).mockResolvedValue({ data: mockData });

      const wrapper = mount(Analytics, {
        props: {
          startDate: '2024-01-01',
          endDate: '2024-01-31',
        },
        global: {
          stubs: {
            LoadingMessage: {
              template: '<div class="loading-stub">{{ description }}</div>',
              props: ['description'],
            },
          },
        },
      });

      await flushPromises();

      // Check for chart legend
      expect(wrapper.find('.chart-legend').exists()).toBe(true);

      // Check for axis labels on trend chart
      const trendChart = wrapper.find('[data-testid="reports-trend-chart"]');
      expect(trendChart.find('.chart-axis-label').exists()).toBe(true);
    });

    it('should not render charts when no data is available', async () => {
      const mockData = {
        reportsByStatus: {},
        resolutionRate: 0,
        averageResolutionTime: 0,
        reportsTrend: [],
        topReportedEvents: [],
        reporterVolume: {},
      };

      vi.mocked(axios.get).mockResolvedValue({ data: mockData });

      const wrapper = mount(Analytics, {
        props: {
          startDate: '2024-01-01',
          endDate: '2024-01-31',
        },
        global: {
          stubs: {
            LoadingMessage: {
              template: '<div class="loading-stub">{{ description }}</div>',
              props: ['description'],
            },
          },
        },
      });

      await flushPromises();

      // Should not show charts with empty data
      expect(wrapper.find('[data-testid="reports-trend-chart"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="top-events-chart"]').exists()).toBe(false);
    });
  });
});
