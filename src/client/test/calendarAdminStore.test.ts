import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import sinon from 'sinon';

import AdminCalendarService from '@/client/service/admin-calendar';
import type {
  AdminCalendarListResponse,
  AdminCalendarRow,
} from '@/client/service/admin-calendar';
import { useCalendarAdminStore } from '@/client/stores/calendarAdminStore';

describe('calendarAdminStore', () => {
  let sandbox: sinon.SinonSandbox;
  let listStub: sinon.SinonStub;

  /**
   * Builds a mock admin calendar row for test responses.
   */
  function mockRow(overrides?: Partial<AdminCalendarRow>): AdminCalendarRow {
    return {
      id: 'calendar-1',
      urlName: 'test-calendar',
      title: 'Test Calendar',
      owner: {
        accountId: 'account-1',
        displayName: 'Test Owner',
      },
      upcomingEventCount: 0,
      lastActivityAt: null,
      fundingStatus: 'none',
      openReportCount: 0,
      ...overrides,
    };
  }

  /**
   * Builds a mock paginated list response for the service stub.
   */
  function mockResponse(
    rows: AdminCalendarRow[] = [mockRow()],
    paginationOverrides: Partial<AdminCalendarListResponse['pagination']> = {},
  ): AdminCalendarListResponse {
    return {
      items: rows,
      pagination: {
        currentPage: 1,
        totalPages: 1,
        totalCount: rows.length,
        limit: 20,
        ...paginationOverrides,
      },
    };
  }

  beforeEach(() => {
    setActivePinia(createPinia());
    sandbox = sinon.createSandbox();
    listStub = sandbox.stub(AdminCalendarService.prototype, 'listCalendars');
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('initial state', () => {
    it('should initialize with defaults for items, pagination, filters, and flags', () => {
      const store = useCalendarAdminStore();

      expect(store.items).toEqual([]);
      expect(store.pagination).toEqual({
        currentPage: 1,
        totalPages: 0,
        totalCount: 0,
        limit: 20,
      });
      expect(store.filters).toEqual({
        search: '',
        hasOpenReports: false,
        sortBy: 'lastActivity',
        sortDir: 'desc',
      });
      expect(store.page).toBe(1);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  describe('loadCalendars', () => {
    it('should populate items and pagination from the service response', async () => {
      const rows = [
        mockRow({ id: 'cal-a', urlName: 'cal-a' }),
        mockRow({ id: 'cal-b', urlName: 'cal-b' }),
      ];
      listStub.resolves(mockResponse(rows, {
        currentPage: 2,
        totalPages: 5,
        totalCount: 42,
        limit: 10,
      }));

      const store = useCalendarAdminStore();
      await store.loadCalendars();

      expect(listStub.calledOnce).toBe(true);
      expect(store.items).toHaveLength(2);
      expect(store.items[0].id).toBe('cal-a');
      expect(store.pagination).toEqual({
        currentPage: 2,
        totalPages: 5,
        totalCount: 42,
        limit: 10,
      });
      expect(store.error).toBeNull();
    });

    it('should toggle the loading flag around the fetch', async () => {
      let loadingDuringFetch: boolean | null = null;
      listStub.callsFake(async () => {
        const store = useCalendarAdminStore();
        loadingDuringFetch = store.loading;
        return mockResponse([]);
      });

      const store = useCalendarAdminStore();
      expect(store.loading).toBe(false);

      await store.loadCalendars();

      expect(loadingDuringFetch).toBe(true);
      expect(store.loading).toBe(false);
    });

    it('should capture error message and clear loading on fetch failure', async () => {
      listStub.rejects(new Error('boom'));

      const store = useCalendarAdminStore();

      await expect(store.loadCalendars()).rejects.toThrow('boom');
      expect(store.error).toBe('boom');
      expect(store.loading).toBe(false);
    });
  });

  describe('setFilter', () => {
    it('should update search filter and trigger a re-fetch with the new value', async () => {
      listStub.resolves(mockResponse([]));

      const store = useCalendarAdminStore();
      await store.setFilter('search', 'festival');

      expect(store.filters.search).toBe('festival');
      expect(listStub.calledOnce).toBe(true);
      expect(listStub.firstCall.args[0]).toMatchObject({ search: 'festival' });
    });

    it('should update hasOpenReports filter and trigger a re-fetch', async () => {
      listStub.resolves(mockResponse([]));

      const store = useCalendarAdminStore();
      await store.setFilter('hasOpenReports', true);

      expect(store.filters.hasOpenReports).toBe(true);
      expect(listStub.calledOnce).toBe(true);
      expect(listStub.firstCall.args[0]).toMatchObject({ hasOpenReports: true });
    });

    it('should update sortBy filter and trigger a re-fetch', async () => {
      listStub.resolves(mockResponse([]));

      const store = useCalendarAdminStore();
      await store.setFilter('sortBy', 'eventCount');

      expect(store.filters.sortBy).toBe('eventCount');
      expect(listStub.calledOnce).toBe(true);
      expect(listStub.firstCall.args[0]).toMatchObject({ sortBy: 'eventCount' });
    });

    it('should reset to page 1 when a filter changes', async () => {
      listStub.resolves(mockResponse([]));

      const store = useCalendarAdminStore();
      store.page = 3;

      await store.setFilter('search', 'concert');

      expect(store.page).toBe(1);
      expect(listStub.firstCall.args[0]).toMatchObject({ page: 1 });
    });
  });

  describe('setPage', () => {
    it('should advance the page and trigger a re-fetch with the new page number', async () => {
      listStub.resolves(mockResponse([]));

      const store = useCalendarAdminStore();
      await store.setPage(4);

      expect(store.page).toBe(4);
      expect(listStub.calledOnce).toBe(true);
      expect(listStub.firstCall.args[0]).toMatchObject({ page: 4 });
    });
  });
});
