import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { WidgetConfig, WIDGET_CONFIG_DEFAULTS } from '@/common/model/widget_config';
import { ValidationError } from '@/common/exceptions/base';
import { CalendarNotFoundError } from '@/common/exceptions/calendar';
import { CalendarEditorPermissionError } from '@/common/exceptions/editor';
import { CalendarWidgetConfigEntity } from '@/server/calendar/entity/calendar_widget_config';
import CalendarService from '@/server/calendar/service/calendar';
import WidgetConfigService from '@/server/calendar/service/widget_config';

describe('WidgetConfigService', () => {
  let sandbox: sinon.SinonSandbox;
  let calendarService: sinon.SinonStubbedInstance<CalendarService>;
  let service: WidgetConfigService;
  let logger: { warn: sinon.SinonSpy; info: sinon.SinonSpy; debug: sinon.SinonSpy; error: sinon.SinonSpy };
  let account: Account;
  const calendarId = 'calendar-uuid-1';
  const calendarUrlName = 'my-calendar';

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    calendarService = sandbox.createStubInstance(CalendarService);
    logger = {
      warn: sandbox.spy(),
      info: sandbox.spy(),
      debug: sandbox.spy(),
      error: sandbox.spy(),
    };
    service = new WidgetConfigService(calendarService as unknown as CalendarService, logger as any);
    account = new Account('account-id', 'tester', 'test@example.com');
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('getWidgetConfig (public widget path)', () => {
    it('returns fresh defaults when no row exists', async () => {
      const calendar = new Calendar(calendarId, calendarUrlName);
      calendarService.getCalendarByName.resolves(calendar);
      sandbox.stub(CalendarWidgetConfigEntity, 'findOne').resolves(null);

      const config = await service.getWidgetConfig(calendarUrlName);

      expect(config).toBeInstanceOf(WidgetConfig);
      expect(config.view).toBe(WIDGET_CONFIG_DEFAULTS.view);
      expect(config.accentColor).toBe(WIDGET_CONFIG_DEFAULTS.accentColor);
      expect(config.colorMode).toBe(WIDGET_CONFIG_DEFAULTS.colorMode);
    });

    it('returns stored config when row exists', async () => {
      const calendar = new Calendar(calendarId, calendarUrlName);
      calendarService.getCalendarByName.resolves(calendar);
      const entity = {
        view: 'week',
        accent_color: '#abcdef',
        color_mode: 'dark',
      } as any;
      sandbox.stub(CalendarWidgetConfigEntity, 'findOne').resolves(entity);

      const config = await service.getWidgetConfig(calendarUrlName);

      expect(config.view).toBe('week');
      expect(config.accentColor).toBe('#abcdef');
      expect(config.colorMode).toBe('dark');
    });

    it('throws CalendarNotFoundError when calendar does not exist', async () => {
      calendarService.getCalendarByName.resolves(null);

      await expect(service.getWidgetConfig('nope')).rejects.toThrow(CalendarNotFoundError);
    });

    it('falls back to defaults for corrupt fields and logs a warning (defense-in-depth)', async () => {
      const calendar = new Calendar(calendarId, calendarUrlName);
      calendarService.getCalendarByName.resolves(calendar);
      const entity = {
        view: 'banana',
        accent_color: '#ff9131',
        color_mode: 'dark',
      } as any;
      sandbox.stub(CalendarWidgetConfigEntity, 'findOne').resolves(entity);

      const config = await service.getWidgetConfig(calendarUrlName);

      expect(config.view).toBe(WIDGET_CONFIG_DEFAULTS.view);
      expect(config.accentColor).toBe('#ff9131');
      expect(config.colorMode).toBe('dark');
      expect(logger.warn.calledOnce).toBe(true);

      const [context, message] = logger.warn.firstCall.args;
      expect(context.calendarId).toBe(calendarId);
      expect(context.invalidFields).toHaveProperty('view', 'banana');
      expect(context.invalidFields).not.toHaveProperty('accentColor');
      expect(context.invalidFields).not.toHaveProperty('colorMode');
      expect(message).toMatch(/Corrupt widget config fields/);
    });
  });

  describe('getWidgetConfigForEditor', () => {
    it('throws CalendarEditorPermissionError when account lacks edit access', async () => {
      const calendar = new Calendar(calendarId, calendarUrlName);
      calendarService.getCalendar.resolves(calendar);
      calendarService.userCanModifyCalendar.resolves(false);

      await expect(
        service.getWidgetConfigForEditor(account, calendarId),
      ).rejects.toThrow(CalendarEditorPermissionError);
    });

    it('throws CalendarNotFoundError when calendar does not exist', async () => {
      calendarService.getCalendar.resolves(null);

      await expect(
        service.getWidgetConfigForEditor(account, calendarId),
      ).rejects.toThrow(CalendarNotFoundError);
    });

    it('returns fresh defaults when the calendar has no stored row', async () => {
      const calendar = new Calendar(calendarId, calendarUrlName);
      calendarService.getCalendar.resolves(calendar);
      calendarService.userCanModifyCalendar.resolves(true);
      sandbox.stub(CalendarWidgetConfigEntity, 'findOne').resolves(null);

      const config = await service.getWidgetConfigForEditor(account, calendarId);

      expect(config.view).toBe(WIDGET_CONFIG_DEFAULTS.view);
      expect(config.accentColor).toBe(WIDGET_CONFIG_DEFAULTS.accentColor);
      expect(config.colorMode).toBe(WIDGET_CONFIG_DEFAULTS.colorMode);
    });

    it('returns stored config when row exists', async () => {
      const calendar = new Calendar(calendarId, calendarUrlName);
      calendarService.getCalendar.resolves(calendar);
      calendarService.userCanModifyCalendar.resolves(true);
      const entity = {
        view: 'month',
        accent_color: '#123abc',
        color_mode: 'light',
      } as any;
      sandbox.stub(CalendarWidgetConfigEntity, 'findOne').resolves(entity);

      const config = await service.getWidgetConfigForEditor(account, calendarId);

      expect(config.view).toBe('month');
      expect(config.accentColor).toBe('#123abc');
      expect(config.colorMode).toBe('light');
    });
  });

  describe('setWidgetConfig', () => {
    it('throws CalendarEditorPermissionError when account lacks edit access', async () => {
      const calendar = new Calendar(calendarId, calendarUrlName);
      calendarService.getCalendar.resolves(calendar);
      calendarService.userCanModifyCalendar.resolves(false);

      await expect(
        service.setWidgetConfig(account, calendarId, { view: 'list' }),
      ).rejects.toThrow(CalendarEditorPermissionError);
    });

    it('throws ValidationError with camelCase field keys for invalid values', async () => {
      const calendar = new Calendar(calendarId, calendarUrlName);
      calendarService.getCalendar.resolves(calendar);
      calendarService.userCanModifyCalendar.resolves(true);

      try {
        await service.setWidgetConfig(account, calendarId, {
          view: 'bogus' as any,
          accentColor: 'not-a-color',
          colorMode: 'invisible' as any,
        });
        expect.fail('should have thrown ValidationError');
      }
      catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        const ve = err as ValidationError;
        expect(ve.fields).toBeDefined();
        expect(ve.fields).toHaveProperty('view');
        expect(ve.fields).toHaveProperty('accentColor');
        expect(ve.fields).toHaveProperty('colorMode');
        // And NOT snake_case variants
        expect(ve.fields).not.toHaveProperty('accent_color');
        expect(ve.fields).not.toHaveProperty('color_mode');
      }
    });

    it('rejects shorthand hex colors (#fff) via the strict regex', async () => {
      const calendar = new Calendar(calendarId, calendarUrlName);
      calendarService.getCalendar.resolves(calendar);
      calendarService.userCanModifyCalendar.resolves(true);

      try {
        await service.setWidgetConfig(account, calendarId, {
          view: 'list',
          accentColor: '#fff',
          colorMode: 'auto',
        });
        expect.fail('should have thrown ValidationError');
      }
      catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        const ve = err as ValidationError;
        expect(ve.fields).toHaveProperty('accentColor');
      }
    });

    it('persists a valid config by creating a new row when none exists', async () => {
      const calendar = new Calendar(calendarId, calendarUrlName);
      calendarService.getCalendar.resolves(calendar);
      calendarService.userCanModifyCalendar.resolves(true);
      sandbox.stub(CalendarWidgetConfigEntity, 'findOne').resolves(null);

      const saveStub = sandbox.stub().resolves();
      const buildStub = sandbox.stub(CalendarWidgetConfigEntity, 'build').returns({
        save: saveStub,
      } as any);

      const result = await service.setWidgetConfig(account, calendarId, {
        view: 'week',
        accentColor: '#abcdef',
        colorMode: 'dark',
      });

      expect(buildStub.calledOnce).toBe(true);
      const buildArgs = buildStub.firstCall.args[0];
      expect(buildArgs).toMatchObject({
        calendar_id: calendarId,
        view: 'week',
        accent_color: '#abcdef',
        color_mode: 'dark',
      });
      expect(saveStub.calledOnce).toBe(true);

      expect(result.view).toBe('week');
      expect(result.accentColor).toBe('#abcdef');
      expect(result.colorMode).toBe('dark');
    });

    it('persists a valid config by updating an existing row', async () => {
      const calendar = new Calendar(calendarId, calendarUrlName);
      calendarService.getCalendar.resolves(calendar);
      calendarService.userCanModifyCalendar.resolves(true);

      const updateStub = sandbox.stub().resolves();
      const existing = {
        view: 'list',
        accent_color: '#ff9131',
        color_mode: 'auto',
        update: updateStub,
      } as any;
      sandbox.stub(CalendarWidgetConfigEntity, 'findOne').resolves(existing);

      sandbox.stub(CalendarWidgetConfigEntity, 'build');

      const result = await service.setWidgetConfig(account, calendarId, {
        view: 'month',
        accentColor: '#112233',
        colorMode: 'light',
      });

      // Prove the update branch was taken (not the insert branch)
      expect(updateStub.calledOnce).toBe(true);
      expect(result.view).toBe('month');
      expect(result.accentColor).toBe('#112233');
      expect(result.colorMode).toBe('light');
    });

    it('happy-path round trip: write then read returns the same values', async () => {
      const calendar = new Calendar(calendarId, calendarUrlName);
      calendarService.getCalendar.resolves(calendar);
      calendarService.userCanModifyCalendar.resolves(true);

      let stored: any = null;
      const updateStub = sandbox.stub().callsFake(async (patch: any) => {
        Object.assign(stored, patch);
      });
      const saveStub = sandbox.stub().callsFake(async function (this: any) {
        stored = {
          view: this.view,
          accent_color: this.accent_color,
          color_mode: this.color_mode,
          update: updateStub,
        };
      });

      sandbox.stub(CalendarWidgetConfigEntity, 'findOne').callsFake(async () => stored);
      sandbox.stub(CalendarWidgetConfigEntity, 'build').callsFake((attrs: any) => ({
        ...attrs,
        save: saveStub,
      } as any));

      await service.setWidgetConfig(account, calendarId, {
        view: 'week',
        accentColor: '#aabbcc',
        colorMode: 'dark',
      });

      const read = await service.getWidgetConfigForEditor(account, calendarId);
      expect(read.view).toBe('week');
      expect(read.accentColor).toBe('#aabbcc');
      expect(read.colorMode).toBe('dark');
    });
  });
});
