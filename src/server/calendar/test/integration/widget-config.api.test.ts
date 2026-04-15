import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import CalendarInterface from '@/server/calendar/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import AccountService from '@/server/accounts/service/account';
import { TestEnvironment } from '@/server/test/lib/test_environment';
import { CalendarWidgetConfigEntity } from '@/server/calendar/entity/calendar_widget_config';
import { WIDGET_CONFIG_DEFAULTS } from '@/common/model/widget_config';

/**
 * Integration tests for the admin widget-config REST endpoints:
 *   GET  /api/v1/calendars/:calendarId/widget/config
 *   PUT  /api/v1/calendars/:calendarId/widget/config
 *
 * These exercise the full Express pipeline (auth middleware, rate limiting,
 * service validation, and error serialization) against an in-memory SQLite DB.
 * The existing unit test in test/api/widget_config.test.ts covers the domain
 * handler in isolation; this file covers the HTTP contract end-to-end.
 */
describe('Widget Config Admin API Integration Tests', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let eventBus: EventEmitter;

  let ownerAccount: Account;
  let ownedCalendar: Calendar;
  let ownerToken: string;
  let otherToken: string;

  const ownerEmail = 'widgetcfg-owner@pavillion.dev';
  const otherEmail = 'widgetcfg-other@pavillion.dev';
  const password = 'testpassword';

  const MISSING_UUID = '00000000-0000-4000-8000-000000000000';

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    const ownerInfo = await accountService._setupAccount(ownerEmail, password);
    ownerAccount = ownerInfo.account;
    await accountService._setupAccount(otherEmail, password);

    ownerToken = await env.login(ownerEmail, password);
    otherToken = await env.login(otherEmail, password);

    ownedCalendar = await calendarInterface.createCalendar(ownerAccount, 'widgetcfg-cal');
  });

  afterAll(async () => {
    if (eventBus) {
      eventBus.removeAllListeners();
    }
    await env.cleanup();
  });

  beforeEach(async () => {
    // Reset widget config rows between tests so GET/PUT cases start clean.
    await CalendarWidgetConfigEntity.destroy({
      where: { calendar_id: ownedCalendar.id },
    });
  });

  describe('GET /api/v1/calendars/:calendarId/widget/config', () => {
    it('returns defaults when no row exists', async () => {
      const response = await env.authGet(
        ownerToken,
        `/api/v1/calendars/${ownedCalendar.id}/widget/config`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        view: WIDGET_CONFIG_DEFAULTS.view,
        accentColor: WIDGET_CONFIG_DEFAULTS.accentColor,
        colorMode: WIDGET_CONFIG_DEFAULTS.colorMode,
      });
    });

    it('returns stored values after PUT', async () => {
      const putResponse = await env.authPut(
        ownerToken,
        `/api/v1/calendars/${ownedCalendar.id}/widget/config`,
        { view: 'week', accentColor: '#123456', colorMode: 'dark' },
      );
      expect(putResponse.status).toBe(200);

      const getResponse = await env.authGet(
        ownerToken,
        `/api/v1/calendars/${ownedCalendar.id}/widget/config`,
      );

      expect(getResponse.status).toBe(200);
      expect(getResponse.body).toEqual({
        view: 'week',
        accentColor: '#123456',
        colorMode: 'dark',
      });
    });

    it('returns 403 for a non-editor account', async () => {
      const response = await env.authGet(
        otherToken,
        `/api/v1/calendars/${ownedCalendar.id}/widget/config`,
      );

      expect(response.status).toBe(403);
      expect(response.body.errorName).toBe('CalendarEditorPermissionError');
    });

    it('returns 400 for a malformed calendarId UUID', async () => {
      const response = await env.authGet(
        ownerToken,
        '/api/v1/calendars/not-a-uuid/widget/config',
      );

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
      expect(response.body.error).toContain('invalid calendarId format');
    });

    it('returns 404 when calendar does not exist', async () => {
      const response = await env.authGet(
        ownerToken,
        `/api/v1/calendars/${MISSING_UUID}/widget/config`,
      );

      expect(response.status).toBe(404);
      expect(response.body.errorName).toBe('CalendarNotFoundError');
    });
  });

  describe('PUT /api/v1/calendars/:calendarId/widget/config', () => {
    it('returns 200 on first call (creates row)', async () => {
      const response = await env.authPut(
        ownerToken,
        `/api/v1/calendars/${ownedCalendar.id}/widget/config`,
        { view: 'month', accentColor: '#abcdef', colorMode: 'light' },
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        view: 'month',
        accentColor: '#abcdef',
        colorMode: 'light',
      });

      const rowCount = await CalendarWidgetConfigEntity.count({
        where: { calendar_id: ownedCalendar.id },
      });
      expect(rowCount).toBe(1);
    });

    it('returns 200 on second call with different values (updates row) and never creates a second row', async () => {
      const firstResponse = await env.authPut(
        ownerToken,
        `/api/v1/calendars/${ownedCalendar.id}/widget/config`,
        { view: 'list', accentColor: '#111111', colorMode: 'light' },
      );
      expect(firstResponse.status).toBe(200);

      const secondResponse = await env.authPut(
        ownerToken,
        `/api/v1/calendars/${ownedCalendar.id}/widget/config`,
        { view: 'week', accentColor: '#222222', colorMode: 'dark' },
      );
      expect(secondResponse.status).toBe(200);
      expect(secondResponse.body).toEqual({
        view: 'week',
        accentColor: '#222222',
        colorMode: 'dark',
      });

      // Assert exactly one row exists — upsert round-trip, no duplicates.
      const rows = await CalendarWidgetConfigEntity.findAll({
        where: { calendar_id: ownedCalendar.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].view).toBe('week');
      expect(rows[0].accent_color).toBe('#222222');
      expect(rows[0].color_mode).toBe('dark');
    });

    it('returns 403 for a non-editor account', async () => {
      const response = await env.authPut(
        otherToken,
        `/api/v1/calendars/${ownedCalendar.id}/widget/config`,
        { view: 'week', accentColor: '#abcdef', colorMode: 'dark' },
      );

      expect(response.status).toBe(403);
      expect(response.body.errorName).toBe('CalendarEditorPermissionError');
    });

    it('returns 400 with camelCase fields map for invalid payload', async () => {
      const response = await env.authPut(
        ownerToken,
        `/api/v1/calendars/${ownedCalendar.id}/widget/config`,
        { view: 'week', accentColor: 'not-a-hex', colorMode: 'dark' },
      );

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
      expect(response.body.fields).toBeDefined();
      expect(response.body.fields.accentColor).toBeDefined();
      expect(Array.isArray(response.body.fields.accentColor)).toBe(true);
      // Critical contract: camelCase keys only, never snake_case.
      expect(response.body.fields).not.toHaveProperty('accent_color');
    });

    it('returns 400 with multiple invalid fields flagged in fields map', async () => {
      const response = await env.authPut(
        ownerToken,
        `/api/v1/calendars/${ownedCalendar.id}/widget/config`,
        { view: 'bogus', accentColor: 'not-a-hex', colorMode: 'neon' },
      );

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
      expect(response.body.fields.view).toBeDefined();
      expect(response.body.fields.accentColor).toBeDefined();
      expect(response.body.fields.colorMode).toBeDefined();
      // Neither the snake_case DB column name nor the stringly-typed raw key should leak.
      expect(response.body.fields).not.toHaveProperty('accent_color');
      expect(response.body.fields).not.toHaveProperty('color_mode');
    });

    it('returns 400 for malformed calendarId UUID', async () => {
      const response = await env.authPut(
        ownerToken,
        '/api/v1/calendars/not-a-uuid/widget/config',
        { view: 'week', accentColor: '#abcdef', colorMode: 'dark' },
      );

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
      expect(response.body.error).toContain('invalid calendarId format');
    });

    it('returns 404 when calendar does not exist', async () => {
      const response = await env.authPut(
        ownerToken,
        `/api/v1/calendars/${MISSING_UUID}/widget/config`,
        { view: 'week', accentColor: '#abcdef', colorMode: 'dark' },
      );

      expect(response.status).toBe(404);
      expect(response.body.errorName).toBe('CalendarNotFoundError');
    });
  });
});
