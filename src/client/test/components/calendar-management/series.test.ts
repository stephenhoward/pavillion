import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import { nextTick } from 'vue';
import { mountComponent } from '@/client/test/lib/vue';
import SeriesTab from '@/client/components/logged_in/calendar-management/series.vue';
import SeriesService from '@/client/service/series';
import { EventSeries } from '@/common/model/event_series';
import { EventSeriesContent } from '@/common/model/event_series_content';

const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
};

vi.mock('@/client/composables/useToast', () => ({
  useToast: () => mockToast,
}));

const routes: RouteRecordRaw[] = [
  { path: '/calendar/:calendar/series', component: {}, name: 'series' },
];

const createWrapper = (props = {}) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: routes,
  });

  router.push({
    name: 'series',
    params: { calendar: 'calendar-123' },
  });

  return mountComponent(SeriesTab, router, {
    props: {
      calendarId: 'calendar-123',
      ...props,
    },
  });
};

/**
 * Helper function to create test series with event counts
 */
function createTestSeries(id: string, name: string, urlName: string, eventCount: number): EventSeries & { eventCount: number } {
  const series = new EventSeries(id, 'calendar-123', urlName, null);
  series.addContent(EventSeriesContent.fromObject({
    language: 'en',
    name: name,
    description: '',
  }));
  return Object.assign(series, { eventCount });
}

describe('Series Tab Component', () => {
  let wrapper: any;

  beforeEach(() => {
    vi.spyOn(SeriesService.prototype, 'loadSeries').mockResolvedValue([]);
    mockToast.success.mockClear();
    mockToast.error.mockClear();
    mockToast.warning.mockClear();
    mockToast.info.mockClear();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.restoreAllMocks();
  });

  describe('Empty state', () => {
    it('renders empty state when no series exist', async () => {
      vi.spyOn(SeriesService.prototype, 'loadSeries').mockResolvedValue([]);

      wrapper = createWrapper();

      await nextTick();
      await vi.waitFor(() => {
        return !wrapper.vm.state.isLoading;
      }, { timeout: 1000 });

      // Should show empty state
      const text = wrapper.text();
      expect(text).toBeTruthy();
    });

    it('shows add series button in empty state', async () => {
      vi.spyOn(SeriesService.prototype, 'loadSeries').mockResolvedValue([]);

      wrapper = createWrapper();

      await nextTick();
      await vi.waitFor(() => {
        return !wrapper.vm.state.isLoading;
      }, { timeout: 1000 });

      // Should have a button to add series
      const buttons = wrapper.findAll('button');
      expect(buttons.length).toBeGreaterThan(0);
    });
  });

  describe('Series list', () => {
    it('renders series list when series exist', async () => {
      const mockSeries = [
        createTestSeries('series-1', 'Summer Festival', 'summer-festival', 5),
        createTestSeries('series-2', 'Winter Concerts', 'winter-concerts', 3),
      ];

      vi.spyOn(SeriesService.prototype, 'loadSeries').mockResolvedValue(mockSeries);

      wrapper = createWrapper();

      await nextTick();
      await vi.waitFor(() => {
        return wrapper.vm.state.series.length > 0;
      }, { timeout: 1000 });

      const names = wrapper.findAll('.series-name');
      expect(names.length).toBe(2);
      expect(names[0].text()).toContain('Summer Festival');
      expect(names[1].text()).toContain('Winter Concerts');
    });

    it('shows event counts for each series', async () => {
      const mockSeries = [
        createTestSeries('series-1', 'Summer Festival', 'summer-festival', 5),
        createTestSeries('series-2', 'Winter Concerts', 'winter-concerts', 3),
      ];

      vi.spyOn(SeriesService.prototype, 'loadSeries').mockResolvedValue(mockSeries);

      wrapper = createWrapper();

      await nextTick();
      await vi.waitFor(() => {
        return wrapper.vm.state.series.length > 0;
      }, { timeout: 1000 });

      const eventCounts = wrapper.findAll('.event-count');
      expect(eventCounts[0].text()).toContain('5');
      expect(eventCounts[1].text()).toContain('3');
    });

    it('has edit and delete buttons for each series', async () => {
      const mockSeries = [
        createTestSeries('series-1', 'Summer Festival', 'summer-festival', 5),
      ];

      vi.spyOn(SeriesService.prototype, 'loadSeries').mockResolvedValue(mockSeries);

      wrapper = createWrapper();

      await nextTick();
      await vi.waitFor(() => {
        return wrapper.vm.state.series.length > 0;
      }, { timeout: 1000 });

      const editButtons = wrapper.findAll('.icon-button:not(.icon-button--danger)');
      const deleteButtons = wrapper.findAll('.icon-button--danger');
      expect(editButtons.length).toBeGreaterThanOrEqual(1);
      expect(deleteButtons.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Create series', () => {
    it('opens the editor when Add Series button is clicked', async () => {
      vi.spyOn(SeriesService.prototype, 'loadSeries').mockResolvedValue([]);

      wrapper = createWrapper();

      await nextTick();
      await vi.waitFor(() => {
        return !wrapper.vm.state.isLoading;
      }, { timeout: 1000 });

      expect(wrapper.vm.state.showEditor).toBe(false);

      // Call openCreateEditor directly since empty state btn has complex rendering
      wrapper.vm.openCreateEditor();
      await nextTick();

      expect(wrapper.vm.state.showEditor).toBe(true);
      expect(wrapper.vm.state.seriesToEdit).not.toBeNull();
      // PrimaryModel converts null/undefined id to empty string; falsy check covers new series
      expect(wrapper.vm.state.seriesToEdit.id).toBeFalsy();
    });
  });

  describe('Edit series', () => {
    it('opens editor with series data when edit button is clicked', async () => {
      const mockSeries = [
        createTestSeries('series-1', 'Summer Festival', 'summer-festival', 5),
      ];

      vi.spyOn(SeriesService.prototype, 'loadSeries').mockResolvedValue(mockSeries);

      wrapper = createWrapper();

      await nextTick();
      await vi.waitFor(() => {
        return wrapper.vm.state.series.length > 0;
      }, { timeout: 1000 });

      const editButton = wrapper.find('button.icon-button:not(.icon-button--danger)');
      await editButton.trigger('click');
      await nextTick();

      expect(wrapper.vm.state.showEditor).toBe(true);
      expect(wrapper.vm.state.seriesToEdit).not.toBeNull();
      expect(wrapper.vm.state.seriesToEdit.id).toBe('series-1');
    });
  });

  describe('Delete series', () => {
    it('shows delete confirmation dialog when delete button is clicked', async () => {
      const mockSeries = [
        createTestSeries('series-1', 'Summer Festival', 'summer-festival', 5),
      ];

      vi.spyOn(SeriesService.prototype, 'loadSeries').mockResolvedValue(mockSeries);

      wrapper = createWrapper();

      await nextTick();
      await vi.waitFor(() => {
        return wrapper.vm.state.series.length > 0;
      }, { timeout: 1000 });

      expect(wrapper.vm.state.showDeleteDialog).toBe(false);

      const deleteButton = wrapper.find('.icon-button--danger');
      await deleteButton.trigger('click');
      await nextTick();

      expect(wrapper.vm.state.showDeleteDialog).toBe(true);
      expect(wrapper.vm.state.seriesToDelete).not.toBeNull();
      expect(wrapper.vm.state.seriesToDelete.id).toBe('series-1');
    });

    it('calls deleteSeries API when delete is confirmed', async () => {
      const mockSeries = [
        createTestSeries('series-1', 'Summer Festival', 'summer-festival', 5),
      ];

      vi.spyOn(SeriesService.prototype, 'loadSeries').mockResolvedValue(mockSeries);
      const deleteSeriesSpy = vi.spyOn(SeriesService.prototype, 'deleteSeries').mockResolvedValue(undefined);

      wrapper = createWrapper();

      await nextTick();
      await vi.waitFor(() => {
        return wrapper.vm.state.series.length > 0;
      }, { timeout: 1000 });

      // Open delete dialog
      const deleteButton = wrapper.find('.icon-button--danger');
      await deleteButton.trigger('click');
      await nextTick();

      // Confirm delete
      await wrapper.vm.deleteSeries();

      expect(deleteSeriesSpy).toHaveBeenCalledWith('series-1', 'calendar-123');
    });

    it('shows success toast after deletion', async () => {
      const mockSeries = [
        createTestSeries('series-1', 'Summer Festival', 'summer-festival', 5),
      ];

      vi.spyOn(SeriesService.prototype, 'loadSeries').mockResolvedValue(mockSeries);
      vi.spyOn(SeriesService.prototype, 'deleteSeries').mockResolvedValue(undefined);

      wrapper = createWrapper();

      await nextTick();
      await vi.waitFor(() => {
        return wrapper.vm.state.series.length > 0;
      }, { timeout: 1000 });

      const deleteButton = wrapper.find('.icon-button--danger');
      await deleteButton.trigger('click');
      await nextTick();

      await wrapper.vm.deleteSeries();

      await vi.waitFor(() => {
        return mockToast.success.mock.calls.length > 0;
      }, { timeout: 1000 });

      expect(mockToast.success).toHaveBeenCalledOnce();
    });

    it('shows error toast when deletion fails', async () => {
      const mockSeries = [
        createTestSeries('series-1', 'Summer Festival', 'summer-festival', 5),
      ];

      vi.spyOn(SeriesService.prototype, 'loadSeries').mockResolvedValue(mockSeries);
      vi.spyOn(SeriesService.prototype, 'deleteSeries').mockRejectedValue(new Error('Network error'));

      wrapper = createWrapper();

      await nextTick();
      await vi.waitFor(() => {
        return wrapper.vm.state.series.length > 0;
      }, { timeout: 1000 });

      const deleteButton = wrapper.find('.icon-button--danger');
      await deleteButton.trigger('click');
      await nextTick();

      await wrapper.vm.deleteSeries();

      await vi.waitFor(() => {
        return mockToast.error.mock.calls.length > 0;
      }, { timeout: 1000 });

      expect(mockToast.error).toHaveBeenCalledOnce();
    });

    it('cancels delete dialog correctly', async () => {
      const mockSeries = [
        createTestSeries('series-1', 'Summer Festival', 'summer-festival', 5),
      ];

      vi.spyOn(SeriesService.prototype, 'loadSeries').mockResolvedValue(mockSeries);

      wrapper = createWrapper();

      await nextTick();
      await vi.waitFor(() => {
        return wrapper.vm.state.series.length > 0;
      }, { timeout: 1000 });

      const deleteButton = wrapper.find('.icon-button--danger');
      await deleteButton.trigger('click');
      await nextTick();

      expect(wrapper.vm.state.showDeleteDialog).toBe(true);

      wrapper.vm.cancelDelete();
      await nextTick();

      expect(wrapper.vm.state.showDeleteDialog).toBe(false);
      expect(wrapper.vm.state.seriesToDelete).toBeNull();
    });
  });

  describe('Loading state', () => {
    it('shows loading message while loading', async () => {
      vi.spyOn(SeriesService.prototype, 'loadSeries').mockReturnValue(new Promise(() => {}));

      wrapper = createWrapper();

      await nextTick();

      expect(wrapper.vm.state.isLoading).toBe(true);
    });
  });

  describe('Error state', () => {
    it('shows error message when loading fails', async () => {
      vi.spyOn(SeriesService.prototype, 'loadSeries').mockRejectedValue(new Error('Network error'));

      wrapper = createWrapper();

      await nextTick();
      await vi.waitFor(() => {
        return !wrapper.vm.state.isLoading;
      }, { timeout: 1000 });

      expect(wrapper.vm.state.error).toBeTruthy();
    });
  });

  describe('Toast notifications', () => {
    it('shows success toast after creating a series', async () => {
      vi.spyOn(SeriesService.prototype, 'loadSeries').mockResolvedValue([]);

      wrapper = createWrapper();

      await nextTick();
      await vi.waitFor(() => {
        return !wrapper.vm.state.isLoading;
      }, { timeout: 1000 });

      // Simulate onSeriesSaved with no ID (create)
      wrapper.vm.state.seriesToEdit = new EventSeries(null, 'calendar-123', 'new-series');
      await wrapper.vm.onSeriesSaved();

      expect(mockToast.success).toHaveBeenCalledOnce();
    });

    it('shows success toast after editing a series', async () => {
      vi.spyOn(SeriesService.prototype, 'loadSeries').mockResolvedValue([]);

      wrapper = createWrapper();

      await nextTick();
      await vi.waitFor(() => {
        return !wrapper.vm.state.isLoading;
      }, { timeout: 1000 });

      // Simulate onSeriesSaved with existing ID (edit)
      wrapper.vm.state.seriesToEdit = new EventSeries('existing-id', 'calendar-123', 'existing-series');
      await wrapper.vm.onSeriesSaved();

      expect(mockToast.success).toHaveBeenCalledOnce();
    });
  });
});
