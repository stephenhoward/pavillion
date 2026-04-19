import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import CalendarService from '@/server/calendar/service/calendar';
import { CalendarMemberEntity } from '@/server/calendar/entity/calendar_member';
import { ValidationError } from '@/common/exceptions/base';
import FundingInterface from '@/server/funding/interface';
import type ModerationInterface from '@/server/moderation/interface';

/**
 * Unit tests for CalendarService.listAllCalendarsForAdmin.
 *
 * These tests stub the underlying CalendarMemberEntity calls (count + findAll)
 * plus the two cross-domain decoration methods on FundingInterface /
 * ModerationInterface. They verify sort whitelisting, pagination math,
 * decoration fall-backs, and pre-filter behavior.
 */
describe('CalendarService.listAllCalendarsForAdmin', () => {
  let sandbox: sinon.SinonSandbox;
  let service: CalendarService;
  let countStub: sinon.SinonStub;
  let findAllStub: sinon.SinonStub;
  let fundingInterface: FundingInterface;
  let moderationInterface: ModerationInterface;
  let getPlanStatusStub: sinon.SinonStub;
  let getOpenReportCountsStub: sinon.SinonStub;
  let calendarIdsWithOpenReportsStub: sinon.SinonStub;

  /**
   * Helper to build a fake CalendarMemberEntity row for findAll results.
   * Includes Sequelize's `get(key)` accessor for decoration-subquery values.
   */
  const buildRow = (opts: {
    calendarId: string;
    urlName: string;
    title?: string;
    ownerId?: string;
    ownerDisplayName?: string | null;
    ownerUsername?: string;
    upcomingEventCount?: number;
    lastActivityAt?: Date | null;
  }) => {
    const calendar = {
      id: opts.calendarId,
      url_name: opts.urlName,
      contentEntities: opts.title
        ? [{ language: 'en', name: opts.title }]
        : [],
    };
    const account = {
      id: opts.ownerId ?? 'account-default',
      display_name: opts.ownerDisplayName ?? null,
      username: opts.ownerUsername ?? 'someuser',
    };
    const subqueryValues: Record<string, unknown> = {
      upcoming_event_count: opts.upcomingEventCount ?? 0,
      last_activity_at: opts.lastActivityAt ?? null,
    };
    return {
      calendar_id: opts.calendarId,
      calendar,
      account,
      get: (key: string) => subqueryValues[key],
    };
  };

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    countStub = sandbox.stub(CalendarMemberEntity, 'count');
    findAllStub = sandbox.stub(CalendarMemberEntity, 'findAll');

    // FundingInterface with getPlanStatusForCalendars stubbed.
    fundingInterface = new FundingInterface(new EventEmitter());
    getPlanStatusStub = sandbox.stub(fundingInterface, 'getPlanStatusForCalendars');
    getPlanStatusStub.resolves(new Map());

    // Minimal moderation interface double — only the two methods the
    // service reaches through are stubbed, so we don't need to build a
    // full ModerationInterface graph.
    getOpenReportCountsStub = sandbox.stub().resolves(new Map());
    calendarIdsWithOpenReportsStub = sandbox.stub().resolves([]);
    moderationInterface = {
      getOpenReportCountsForCalendars: getOpenReportCountsStub,
      calendarIdsWithOpenReports: calendarIdsWithOpenReportsStub,
    } as unknown as ModerationInterface;

    service = new CalendarService(undefined, undefined, new EventEmitter(), fundingInterface);
    service.setModerationInterface(moderationInterface);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('sort whitelist', () => {
    it('throws ValidationError for an unknown sortBy value', async () => {
      await expect(
        service.listAllCalendarsForAdmin({ sortBy: 'nope' as any }),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError for an unknown sortDir value', async () => {
      await expect(
        service.listAllCalendarsForAdmin({ sortDir: 'sideways' as any }),
      ).rejects.toThrow(ValidationError);
    });

    it('accepts each valid sortBy/sortDir combination without throwing', async () => {
      countStub.resolves(0);
      findAllStub.resolves([]);

      const sortKeys = ['created', 'lastActivity', 'eventCount'] as const;
      const dirs = ['asc', 'desc'] as const;

      for (const sortBy of sortKeys) {
        for (const sortDir of dirs) {
          await expect(
            service.listAllCalendarsForAdmin({ sortBy, sortDir }),
          ).resolves.toBeTruthy();
        }
      }
    });
  });

  describe('pagination', () => {
    it('clamps limit to 100 even when caller asks for more', async () => {
      countStub.resolves(0);
      findAllStub.resolves([]);

      const result = await service.listAllCalendarsForAdmin({ limit: 500 });
      expect(result.pagination.limit).toBe(100);
    });

    it('clamps page to a minimum of 1 even when caller passes 0 or negative', async () => {
      countStub.resolves(0);
      findAllStub.resolves([]);

      const zeroResult = await service.listAllCalendarsForAdmin({ page: 0 });
      expect(zeroResult.pagination.currentPage).toBe(1);

      const negativeResult = await service.listAllCalendarsForAdmin({ page: -3 });
      expect(negativeResult.pagination.currentPage).toBe(1);
    });

    it('returns correct totalPages based on totalCount and limit', async () => {
      countStub.resolves(45);
      findAllStub.resolves([
        buildRow({ calendarId: 'cal-1', urlName: 'first' }),
      ]);

      const result = await service.listAllCalendarsForAdmin({ page: 2, limit: 20 });
      expect(result.pagination).toEqual({
        currentPage: 2,
        totalPages: Math.ceil(45 / 20), // 3
        totalCount: 45,
        limit: 20,
      });
    });

    it('returns empty envelope with totalPages=0 when count is zero', async () => {
      countStub.resolves(0);
      findAllStub.resolves([]);

      const result = await service.listAllCalendarsForAdmin({});
      expect(result.items).toEqual([]);
      expect(result.pagination).toEqual({
        currentPage: 1,
        totalPages: 0,
        totalCount: 0,
        limit: 20,
      });
    });
  });

  describe('search', () => {
    it('passes the trimmed search value through to the count and findAll calls', async () => {
      countStub.resolves(1);
      findAllStub.resolves([buildRow({ calendarId: 'cal-1', urlName: 'test' })]);

      await service.listAllCalendarsForAdmin({ search: '  test  ' });

      const countArgs = countStub.firstCall.args[0];
      expect(countArgs.replacements).toEqual({ search: '%test%' });

      const findArgs = findAllStub.firstCall.args[0];
      expect(findArgs.replacements).toEqual({ search: '%test%' });
    });

    it('truncates a search value longer than 200 characters', async () => {
      countStub.resolves(0);
      findAllStub.resolves([]);

      const longSearch = 'x'.repeat(250);
      await service.listAllCalendarsForAdmin({ search: longSearch });

      const countArgs = countStub.firstCall.args[0];
      expect(countArgs.replacements.search.length).toBe(200 + 2); // %...%
      expect(countArgs.replacements.search).toBe(`%${'x'.repeat(200)}%`);
    });

    it('does not set replacements when search is empty or whitespace', async () => {
      countStub.resolves(0);
      findAllStub.resolves([]);

      await service.listAllCalendarsForAdmin({ search: '   ' });

      const countArgs = countStub.firstCall.args[0];
      expect(countArgs.replacements).toBeUndefined();
    });
  });

  describe('hasOpenReports filter', () => {
    it('pre-filters via calendarIdsWithOpenReports before the main query', async () => {
      calendarIdsWithOpenReportsStub.resolves(['cal-a', 'cal-b']);
      countStub.resolves(2);
      findAllStub.resolves([
        buildRow({ calendarId: 'cal-a', urlName: 'aaa' }),
        buildRow({ calendarId: 'cal-b', urlName: 'bbb' }),
      ]);

      await service.listAllCalendarsForAdmin({ hasOpenReports: true });

      expect(calendarIdsWithOpenReportsStub.calledOnce).toBe(true);

      const countArgs = countStub.firstCall.args[0];
      // The pre-filter IDs should end up in the WHERE clause as calendar_id IN [...]
      expect(countArgs.where.calendar_id).toBeDefined();
    });

    it('short-circuits to an empty result when no calendars have open reports', async () => {
      calendarIdsWithOpenReportsStub.resolves([]);

      const result = await service.listAllCalendarsForAdmin({ hasOpenReports: true });

      expect(result.items).toEqual([]);
      expect(result.pagination.totalCount).toBe(0);
      expect(countStub.called).toBe(false);
      expect(findAllStub.called).toBe(false);
    });
  });

  describe('decoration (partial maps)', () => {
    it("defaults fundingStatus to 'none' when the funding map omits the calendar id", async () => {
      countStub.resolves(2);
      findAllStub.resolves([
        buildRow({ calendarId: 'cal-1', urlName: 'one' }),
        buildRow({ calendarId: 'cal-2', urlName: 'two' }),
      ]);
      // Only one ID present in the funding map.
      getPlanStatusStub.resolves(new Map([['cal-1', 'subscribed' as const]]));

      const result = await service.listAllCalendarsForAdmin({});

      expect(result.items[0].fundingStatus).toBe('subscribed');
      expect(result.items[1].fundingStatus).toBe('none');
    });

    it('defaults openReportCount to 0 when the report map omits the calendar id', async () => {
      countStub.resolves(2);
      findAllStub.resolves([
        buildRow({ calendarId: 'cal-1', urlName: 'one' }),
        buildRow({ calendarId: 'cal-2', urlName: 'two' }),
      ]);
      // Only one ID present in the report map.
      getOpenReportCountsStub.resolves(new Map([['cal-1', 4]]));

      const result = await service.listAllCalendarsForAdmin({});

      expect(result.items[0].openReportCount).toBe(4);
      expect(result.items[1].openReportCount).toBe(0);
    });

    it('defaults to 0 / none everywhere when both decoration maps are empty', async () => {
      countStub.resolves(1);
      findAllStub.resolves([buildRow({ calendarId: 'cal-1', urlName: 'one' })]);
      getPlanStatusStub.resolves(new Map());
      getOpenReportCountsStub.resolves(new Map());

      const result = await service.listAllCalendarsForAdmin({});

      expect(result.items[0].fundingStatus).toBe('none');
      expect(result.items[0].openReportCount).toBe(0);
    });
  });

  describe('row shape', () => {
    it('returns the documented fields and omits owner email', async () => {
      const lastActivity = new Date('2026-04-01T12:00:00Z');
      countStub.resolves(1);
      findAllStub.resolves([
        buildRow({
          calendarId: 'cal-42',
          urlName: 'my-cal',
          title: 'My Calendar',
          ownerId: 'acct-7',
          ownerDisplayName: 'Alice',
          ownerUsername: 'alice',
          upcomingEventCount: 12,
          lastActivityAt: lastActivity,
        }),
      ]);
      getPlanStatusStub.resolves(new Map([['cal-42', 'grant' as const]]));
      getOpenReportCountsStub.resolves(new Map([['cal-42', 2]]));

      const result = await service.listAllCalendarsForAdmin({});

      expect(result.items).toHaveLength(1);
      const row = result.items[0];
      expect(row).toEqual({
        id: 'cal-42',
        urlName: 'my-cal',
        title: 'My Calendar',
        owner: {
          accountId: 'acct-7',
          displayName: 'Alice',
        },
        upcomingEventCount: 12,
        lastActivityAt: lastActivity,
        fundingStatus: 'grant',
        openReportCount: 2,
      });
      // Owner email must not leak.
      expect((row.owner as any).email).toBeUndefined();
    });

    it('falls back to username when display_name is null', async () => {
      countStub.resolves(1);
      findAllStub.resolves([
        buildRow({
          calendarId: 'cal-1',
          urlName: 'x',
          ownerDisplayName: null,
          ownerUsername: 'bob',
        }),
      ]);

      const result = await service.listAllCalendarsForAdmin({});
      expect(result.items[0].owner.displayName).toBe('bob');
    });

    it('parses string subquery values into numbers', async () => {
      // PostgreSQL may surface COUNT(*) as a string; ensure we coerce.
      const row = buildRow({ calendarId: 'cal-1', urlName: 'x' });
      (row as any).get = (key: string) => (key === 'upcoming_event_count' ? '17' : null);
      countStub.resolves(1);
      findAllStub.resolves([row]);

      const result = await service.listAllCalendarsForAdmin({});
      expect(result.items[0].upcomingEventCount).toBe(17);
    });
  });
});
