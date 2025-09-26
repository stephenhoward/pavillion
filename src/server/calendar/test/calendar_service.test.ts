import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

import { Account } from '@/common/model/account';
import { Calendar, CalendarContent } from '@/common/model/calendar';
import { CalendarEditor } from '@/common/model/calendar_editor';
import { CalendarEntity, CalendarContentEntity } from '@/server/calendar/entity/calendar';
import { CalendarEditorEntity } from '@/server/calendar/entity/calendar_editor';
import CalendarService from '@/server/calendar/service/calendar';
import { UrlNameAlreadyExistsError, InvalidUrlNameError, CalendarNotFoundError } from '@/common/exceptions/calendar';

describe('isValidUrlName', () => {

  let sandbox = sinon.createSandbox();
  let service: CalendarService;
  beforeEach(() => {
    service = new CalendarService();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should return false if urlName is invalid', async () => {
    const tests: [string,boolean][] = [
      ['_noleadunderscore', false],
      ['thisisamuchtoolongusername', false],
      ['no spaces allowed', false],
      ['illegal@character', false],
      ['legalusername', true],
      ['9alsolegal', true],
      ['alsolegal_', true],
    ];
    for( let test of tests) {
      expect(service.isValidUrlName(test[0])).toBe(test[1]);
    }
  });
});

describe('setUrlName', () => {
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let service: CalendarService;
  let editableCalendarsStub: sinon.SinonStub;
  let cal: Calendar;
  let acct: Account;

  beforeEach(() => {
    cal = new Calendar('testCalendarId', 'testme');
    acct = new Account('testAccountId', 'testme', 'testme');
    service = new CalendarService();
    editableCalendarsStub = sandbox.stub(service, 'userCanModifyCalendar');
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should skip permission check if user is admin', async () => {
    const calendarFindStub = sandbox.stub(CalendarEntity, 'findByPk');
    const calendarCheckExistingStub = sandbox.stub(CalendarEntity, 'findOne');
    const calendarUpdateStub = sandbox.stub(CalendarEntity.prototype, 'update');
    calendarFindStub.resolves(CalendarEntity.fromModel(cal));

    acct.roles = ['admin'];
    await service.setUrlName(acct, cal, 'validname');

    expect(editableCalendarsStub.called).toBe(false);
    expect(calendarCheckExistingStub.called).toBe(true);
    expect(calendarUpdateStub.called).toBe(true);
  });

  it('should fail if user not allowed to edit calendar', async () => {
    editableCalendarsStub.resolves(false);
    await expect( () => service.setUrlName(acct, cal, 'validname') ).rejects.toThrowError('Permission denied');
    expect(editableCalendarsStub.called).toBe(true);
  });

  it('should throw an error if urlName is invalid', async () => {
    editableCalendarsStub.resolves(true);
    await expect( () => service.setUrlName(acct, cal, '_noleadunderscore') ).rejects.toThrowError('Invalid Calendar URL name');
  });

  it('should throw an error if urlName already exists', async () => {
    const calendarFindStub = sandbox.stub(CalendarEntity, 'findByPk');
    const calendarCheckStub = sandbox.stub(CalendarEntity, 'findOne');
    calendarFindStub.resolves(CalendarEntity.fromModel(cal));
    calendarCheckStub.resolves(CalendarEntity.build({ id: 'otherCalendarId', url_name: 'validname' }));
    editableCalendarsStub.resolves(true);

    await expect( () => service.setUrlName(acct, cal, 'validname') ).rejects.toThrowError('Calendar URL name already exists');
  });

  it('should throw an error if calendar not found', async () => {
    const calendarFindStub = sandbox.stub(CalendarEntity, 'findByPk');
    calendarFindStub.resolves(null);
    editableCalendarsStub.resolves(true);

    await expect( () => service.setUrlName(acct, cal, 'validname') ).rejects.toThrowError(CalendarNotFoundError);
  });

  it('should return without work if name already matches', async () => {
    cal.urlName = 'validname';

    const calendarFindStub = sandbox.stub(CalendarEntity, 'findByPk');
    const calendarCheckStub = sandbox.stub(CalendarEntity, 'findOne');
    const calendarUpdateStub = sandbox.stub(CalendarEntity.prototype, 'update');
    calendarFindStub.resolves(CalendarEntity.fromModel(cal));
    calendarCheckStub.resolves(undefined);
    editableCalendarsStub.resolves(true);

    await service.setUrlName(acct, cal, 'validname');
    expect(calendarUpdateStub.called).toBe(false);
  });

  it('should update url name of calendar', async () => {
    const calendarFindStub = sandbox.stub(CalendarEntity, 'findByPk');
    const calendarCheckStub = sandbox.stub(CalendarEntity, 'findOne');
    const calendarUpdateStub = sandbox.stub(CalendarEntity.prototype, 'update');
    calendarFindStub.resolves(CalendarEntity.fromModel(cal));
    calendarCheckStub.resolves(undefined);
    editableCalendarsStub.resolves(true);

    await service.setUrlName(acct, cal, 'validname');

    expect(calendarUpdateStub.calledWith({ url_name: 'validname' })).toBe(true);
    expect(cal.urlName).toBe('validname');
  });

});

describe('getCalendar', () => {
  let sandbox: sinon.SinonSandbox;
  let service: CalendarService;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new CalendarService();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should return a Calendar model if found', async () => {
    const cal = new Calendar('testCalendarId', 'testme');
    const calendarFindStub = sandbox.stub(CalendarEntity, 'findByPk');
    calendarFindStub.resolves(CalendarEntity.fromModel(cal));

    const result = await service.getCalendar('testCalendarId');

    expect(result).not.toBeNull();
    expect(result?.id).toBe('testCalendarId');
    expect(result?.urlName).toBe('testme');
    expect(calendarFindStub.calledWith('testCalendarId')).toBe(true);
  });

  it('should return null if calendar not found', async () => {
    const calendarFindStub = sandbox.stub(CalendarEntity, 'findByPk');
    calendarFindStub.resolves(null);

    const result = await service.getCalendar('nonExistentId');

    expect(result).toBeNull();
    expect(calendarFindStub.calledWith('nonExistentId')).toBe(true);
  });
});

describe('editableCalendarsForUser', () => {
  let sandbox: sinon.SinonSandbox;
  let acct: Account;
  let service: CalendarService;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new CalendarService();
    acct = new Account('testAccountId', 'testme', 'testme');
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should return list of calendars for user', async () => {
    const cal1 = new Calendar('cal1', 'calendar1');
    const cal2 = new Calendar('cal2', 'calendar2');

    const calendarFindAllStub = sandbox.stub(CalendarEntity, 'findAll');
    calendarFindAllStub.resolves([
      CalendarEntity.fromModel(cal1),
      CalendarEntity.fromModel(cal2),
    ]);

    // Stub CalendarEditorEntity to return empty array (no editor relationships)
    const editorFindAllStub = sandbox.stub(CalendarEditorEntity, 'findAll');
    editorFindAllStub.resolves([]);

    const result = await service.editableCalendarsForUser(acct);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('cal1');
    expect(result[1].id).toBe('cal2');
  });

  it('should return empty array if no calendars found', async () => {
    const calendarFindAllStub = sandbox.stub(CalendarEntity, 'findAll');
    calendarFindAllStub.resolves([]);

    // Stub CalendarEditorEntity to return empty array (no editor relationships)
    const editorFindAllStub = sandbox.stub(CalendarEditorEntity, 'findAll');
    editorFindAllStub.resolves([]);

    const result = await service.editableCalendarsForUser(acct);

    expect(result).toHaveLength(0);
  });

  it('should combine owned calendars and editor relationships', async () => {
    const cal1 = new Calendar('cal1', 'calendar1');
    const cal2 = new Calendar('cal2', 'calendar2');

    const calendarFindAllStub = sandbox.stub(CalendarEntity, 'findAll');
    calendarFindAllStub.resolves([
      CalendarEntity.fromModel(cal1), // Owned calendar
    ]);

    // Stub CalendarEditorEntity to return one editor relationship
    const editorFindAllStub = sandbox.stub(CalendarEditorEntity, 'findAll');
    const editorEntity = CalendarEditorEntity.fromModel(new CalendarEditor(
      'editorId',
      'cal2',
      'testAccountId',
    ));
    editorEntity.calendar = CalendarEntity.fromModel(cal2);

    editorFindAllStub.resolves([ editorEntity ]);

    const result = await service.editableCalendarsForUser(acct);

    expect(result).toHaveLength(2);
    expect(result.map(c => c.id)).toContain('cal1');
    expect(result.map(c => c.id)).toContain('cal2');
  });
});

describe('userCanModifyCalendar', () => {
  let sandbox: sinon.SinonSandbox;
  let acct: Account;
  let cal: Calendar;
  let service: CalendarService;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new CalendarService();
    acct = new Account('testAccountId', 'testme', 'testme');
    cal = new Calendar('testCalendarId', 'testme');
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should return true if user is admin', async () => {
    acct.roles = ['admin'];
    const editableCalendarsStub = sandbox.stub(service, 'editableCalendarsForUser');

    const result = await service.userCanModifyCalendar(acct, cal);

    expect(result).toBe(true);
    expect(editableCalendarsStub.called).toBe(false);
  });

  it('should return true if user owns the calendar', async () => {
    const editableCalendarsStub = sandbox.stub(service, 'editableCalendarsForUser');
    editableCalendarsStub.resolves([cal]);

    const result = await service.userCanModifyCalendar(acct, cal);

    expect(result).toBe(true);
    expect(editableCalendarsStub.calledWith(acct)).toBe(true);
  });

  it('should return false if user has no calendars', async () => {
    const editableCalendarsStub = sandbox.stub(service, 'editableCalendarsForUser');
    editableCalendarsStub.resolves([]);

    const result = await service.userCanModifyCalendar(acct, cal);

    expect(result).toBe(false);
    expect(editableCalendarsStub.calledWith(acct)).toBe(true);
  });

  it('should return false if user does not own the calendar', async () => {
    const otherCal = new Calendar('otherCalendarId', 'othercal');
    const editableCalendarsStub = sandbox.stub(service, 'editableCalendarsForUser');
    editableCalendarsStub.resolves([otherCal]);

    const result = await service.userCanModifyCalendar(acct, cal);

    expect(result).toBe(false);
    expect(editableCalendarsStub.calledWith(acct)).toBe(true);
  });
});

describe('getCalendarByName', () => {
  let sandbox: sinon.SinonSandbox;
  let service: CalendarService;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new CalendarService();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should return a Calendar model if found by name', async () => {
    const cal = new Calendar('testCalendarId', 'testme');
    const calendarFindOneStub = sandbox.stub(CalendarEntity, 'findOne');
    calendarFindOneStub.resolves(CalendarEntity.fromModel(cal));

    const result = await service.getCalendarByName('testme');

    expect(result).not.toBeNull();
    expect(result?.id).toBe('testCalendarId');
    expect(result?.urlName).toBe('testme');
  });

  it('should return null if calendar not found by name', async () => {
    const calendarFindOneStub = sandbox.stub(CalendarEntity, 'findOne');
    calendarFindOneStub.resolves(null);

    const result = await service.getCalendarByName('nonexistent');

    expect(result).toBeNull();
  });
});

describe('getPrimaryCalendarForUser', () => {
  let sandbox: sinon.SinonSandbox;
  let acct: Account;
  let service: CalendarService;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new CalendarService();
    acct = new Account('testAccountId', 'testme', 'testme');
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should return primary calendar for user if found', async () => {
    const cal = new Calendar('testCalendarId', 'testme');
    const calendarFindOneStub = sandbox.stub(CalendarEntity, 'findOne');
    calendarFindOneStub.resolves(CalendarEntity.fromModel(cal));

    const result = await service.getPrimaryCalendarForUser(acct);

    expect(result).not.toBeNull();
    expect(result?.id).toBe('testCalendarId');
    expect(calendarFindOneStub.calledWith({
      where: { account_id: 'testAccountId' },
    })).toBe(true);
  });

  it('should return null if no calendar found for user', async () => {
    const calendarFindOneStub = sandbox.stub(CalendarEntity, 'findOne');
    calendarFindOneStub.resolves(null);

    const result = await service.getPrimaryCalendarForUser(acct);

    expect(result).toBeNull();
    expect(calendarFindOneStub.calledWith({
      where: { account_id: 'testAccountId' },
    })).toBe(true);
  });
});

describe('createCalendar', () => {
  let sandbox: sinon.SinonSandbox;
  let acct: Account;
  let service: CalendarService;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new CalendarService();
    acct = new Account('testAccountId', 'testme', 'testme');
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should throw error if URL name is invalid', async () => {
    const isValidUrlNameStub = sandbox.stub(service, 'isValidUrlName').returns(false);

    await expect(() => service.createCalendar(acct, '_invalid')).rejects.toThrow(InvalidUrlNameError);
    expect(isValidUrlNameStub.calledWith('_invalid')).toBe(true);
  });

  it('should throw error if URL name already exists', async () => {
    sandbox.stub(service, 'isValidUrlName').returns(true);
    const existingCalendar = CalendarEntity.build({ id: 'existingId', url_name: 'existingname' });
    const calendarFindOneStub = sandbox.stub(CalendarEntity, 'findOne').resolves(existingCalendar);

    await expect(() => service.createCalendar(acct, 'existingname')).rejects.toThrow(UrlNameAlreadyExistsError);
    expect(calendarFindOneStub.calledWith({ where: { url_name: 'existingname' } })).toBe(true);
  });

  it('should create calendar with specified URL name', async () => {
    sandbox.stub(service, 'isValidUrlName').returns(true);
    sandbox.stub(CalendarEntity, 'findOne').resolves(null);
    const calendarCreateStub = sandbox.stub(CalendarEntity, 'create');
    const createdCalendarEntity = CalendarEntity.build({
      id: 'newCalendarId',
      account_id: 'testAccountId',
      url_name: 'newcal',
      languages: 'en',
    });
    calendarCreateStub.resolves(createdCalendarEntity);

    const result = await service.createCalendar(acct, 'newcal');

    expect(result).not.toBeNull();
    expect(result.id).toBe('newCalendarId');
    expect(result.urlName).toBe('newcal');
    expect(calendarCreateStub.calledOnce).toBe(true);
    const createArgs = calendarCreateStub.firstCall.args[0];
    expect(createArgs).toHaveProperty('account_id', 'testAccountId');
    expect(createArgs).toHaveProperty('url_name', 'newcal');
  });

  it('should create calendar with name if provided', async () => {
    sandbox.stub(service, 'isValidUrlName').returns(true);
    sandbox.stub(CalendarEntity, 'findOne').resolves(null);
    const calendarCreateStub = sandbox.stub(CalendarEntity, 'create');
    const createdCalendarEntity = CalendarEntity.build({
      id: 'newCalendarId',
      account_id: 'testAccountId',
      url_name: 'newcal',
      languages: 'en',
    });
    calendarCreateStub.resolves(createdCalendarEntity);
    const createCalendarContentStub = sandbox.stub(service, 'createCalendarContent').resolves({} as any);

    const result = await service.createCalendar(acct, 'newcal', 'My Calendar');

    expect(result).not.toBeNull();
    expect(result.id).toBe('newCalendarId');
    expect(createCalendarContentStub.calledOnce).toBe(true);
    const contentArg = createCalendarContentStub.firstCall.args[1];
    expect(contentArg.name).toBe('My Calendar');
  });
});

describe('createCalendarContent', () => {
  let sandbox: sinon.SinonSandbox;
  let calendarContent: CalendarContent;
  let service: CalendarService;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new CalendarService();
    calendarContent = new CalendarContent('en', 'Test Calendar', 'A test calendar');
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should update existing content if found for language', async () => {
    const existingContent = CalendarContentEntity.build({
      id: 'existingContentId',
      calendar_id: 'calendarId',
      language: 'en',
      name: 'Old Name',
      description: 'Old description',
    });

    const contentFindOneStub = sandbox.stub(CalendarContentEntity, 'findOne').resolves(existingContent);
    const contentUpdateStub = sandbox.stub(existingContent, 'update').resolves(existingContent);

    const result = await service.createCalendarContent('calendarId', calendarContent);

    expect(contentFindOneStub.calledWith({
      where: {
        calendar_id: 'calendarId',
        language: 'en',
      },
    })).toBe(true);

    expect(contentUpdateStub.calledWith({
      name: 'Test Calendar',
      description: 'A test calendar',
    })).toBe(true);

    expect(result).toBe(existingContent);
  });

  it('should create new content if none exists for language', async () => {
    const contentFindOneStub = sandbox.stub(CalendarContentEntity, 'findOne').resolves(null);
    const contentCreateStub = sandbox.stub(CalendarContentEntity, 'create');
    const newContent = CalendarContentEntity.build({
      id: 'newContentId',
      calendar_id: 'calendarId',
      language: 'en',
      name: 'Test Calendar',
      description: 'A test calendar',
    });
    contentCreateStub.resolves(newContent);

    await service.createCalendarContent('calendarId', calendarContent);

    expect(contentFindOneStub.calledWith({
      where: {
        calendar_id: 'calendarId',
        language: 'en',
      },
    })).toBe(true);

    expect(contentCreateStub.calledOnce).toBe(true);
    const createArg = contentCreateStub.firstCall.args[0];
    expect(createArg).toHaveProperty('calendar_id', 'calendarId');
    expect(createArg).toHaveProperty('language', 'en');
    expect(createArg).toHaveProperty('name', 'Test Calendar');
    expect(createArg).toHaveProperty('description', 'A test calendar');
  });
});
describe('Calendar Ownership and Editor Permissions', () => {
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let service: CalendarService;
  let calendar: Calendar;
  let owner: Account;
  let nonOwner: Account;
  let admin: Account;
  let mockAccountsInterface: any;

  beforeEach(() => {
    // Create mock AccountsInterface
    mockAccountsInterface = {
      getAccountById: sandbox.stub(),
    };

    service = new CalendarService(mockAccountsInterface);
    calendar = new Calendar('cal-id', 'test-calendar');
    owner = new Account('owner-id', 'owner', 'owner@test.com');
    nonOwner = new Account('user-id', 'user', 'user@test.com');
    admin = new Account('admin-id', 'admin', 'admin@test.com');
    admin.roles = ['admin'];

    // Set up default account lookups
    mockAccountsInterface.getAccountById.withArgs('owner-id').resolves(owner);
    mockAccountsInterface.getAccountById.withArgs('user-id').resolves(nonOwner);
    mockAccountsInterface.getAccountById.withArgs('admin-id').resolves(admin);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('isCalendarOwner', () => {
    it('should return true for calendar owner', async () => {
      const calendarEntityStub = sandbox.stub(CalendarEntity, 'findByPk');
      const mockEntity = { account_id: 'owner-id' } as CalendarEntity;
      calendarEntityStub.resolves(mockEntity);

      const result = await service.isCalendarOwner(owner, calendar);
      expect(result).toBe(true);
      expect(calendarEntityStub.calledWith('cal-id')).toBe(true);
    });

    it('should return false for non-owner', async () => {
      const calendarEntityStub = sandbox.stub(CalendarEntity, 'findByPk');
      const mockEntity = { account_id: 'owner-id' } as CalendarEntity;
      calendarEntityStub.resolves(mockEntity);

      const result = await service.isCalendarOwner(nonOwner, calendar);
      expect(result).toBe(false);
    });

    it('should return false when calendar not found', async () => {
      const calendarEntityStub = sandbox.stub(CalendarEntity, 'findByPk');
      calendarEntityStub.resolves(null);

      const result = await service.isCalendarOwner(owner, calendar);
      expect(result).toBe(false);
    });
  });

  describe('canViewCalendarEditors', () => {
    it('should return true for admin', async () => {
      const getCalendarStub = sandbox.stub(service, 'getCalendar');
      getCalendarStub.resolves(calendar);

      const result = await service.canViewCalendarEditors(admin, calendar.id);
      expect(result).toBe(true);
    });

    it('should return true for calendar owner', async () => {
      const getCalendarStub = sandbox.stub(service, 'getCalendar');
      const isOwnerStub = sandbox.stub(service, 'isCalendarOwner');
      getCalendarStub.resolves(calendar);
      isOwnerStub.resolves(true);

      const result = await service.canViewCalendarEditors(owner, calendar.id);
      expect(result).toBe(true);
      expect(isOwnerStub.calledWith(owner, calendar)).toBe(true);
    });

    it('should return false for non-owner non-admin', async () => {
      const getCalendarStub = sandbox.stub(service, 'getCalendar');
      const isOwnerStub = sandbox.stub(service, 'isCalendarOwner');
      getCalendarStub.resolves(calendar);
      isOwnerStub.resolves(false);

      const result = await service.canViewCalendarEditors(nonOwner, calendar.id);
      expect(result).toBe(false);
    });
  });

  describe('grantEditAccess', () => {
    it('should succeed for calendar owner', async () => {
      const getCalendarStub = sandbox.stub(service, 'getCalendar');
      const isOwnerStub = sandbox.stub(service, 'isCalendarOwner');
      const findOneStub = sandbox.stub(CalendarEditorEntity, 'findOne');
      const createStub = sandbox.stub(CalendarEditorEntity, 'create');
      const mockEditor = { toModel: () => new CalendarEditor('editor-id', 'cal-id', 'user-id') };
      const mockSendEmailStub = sandbox.stub(service as any, 'sendEditorNotificationEmail');

      getCalendarStub.resolves(calendar);
      isOwnerStub.resolves(true);
      findOneStub.resolves(null); // No existing editor
      createStub.resolves(mockEditor as any);

      const result = await service.grantEditAccess(owner, 'cal-id', 'user-id');
      expect(result).toBeInstanceOf(CalendarEditor);
      expect(createStub.called).toBe(true);
      expect(mockSendEmailStub.called).toBe(true);
    });

    it('should fail for non-owner non-admin', async () => {
      const getCalendarStub = sandbox.stub(service, 'getCalendar');
      const isOwnerStub = sandbox.stub(service, 'isCalendarOwner');

      getCalendarStub.resolves(calendar);
      isOwnerStub.resolves(false);

      await expect(service.grantEditAccess(nonOwner, 'cal-id', 'owner-id'))
        .rejects.toThrow('Permission denied: only calendar owner can grant edit access');
    });

    it('should succeed for admin even if not owner', async () => {
      const getCalendarStub = sandbox.stub(service, 'getCalendar');
      const findOneStub = sandbox.stub(CalendarEditorEntity, 'findOne');
      const createStub = sandbox.stub(CalendarEditorEntity, 'create');
      const mockEditor = { toModel: () => new CalendarEditor('editor-id', 'cal-id', 'user-id') };
      const mockSendEmailStub = sandbox.stub(service as any, 'sendEditorNotificationEmail');

      getCalendarStub.resolves(calendar);
      findOneStub.resolves(null); // No existing editor
      createStub.resolves(mockEditor as any);

      const result = await service.grantEditAccess(admin, 'cal-id', 'user-id');
      expect(result).toBeInstanceOf(CalendarEditor);
      expect(createStub.called).toBe(true);
      expect(mockSendEmailStub.called).toBe(true);
    });
  });

  describe('removeEditAccess', () => {
    it('should succeed for calendar owner', async () => {
      const getCalendarStub = sandbox.stub(service, 'getCalendar');
      const isOwnerStub = sandbox.stub(service, 'isCalendarOwner');
      const destroyStub = sandbox.stub(CalendarEditorEntity, 'destroy');

      getCalendarStub.resolves(calendar);
      isOwnerStub.withArgs(owner, calendar).resolves(true);
      isOwnerStub.withArgs(nonOwner, calendar).resolves(false);
      destroyStub.resolves(1); // One record deleted

      const result = await service.removeEditAccess(owner, 'cal-id', 'user-id');
      expect(result).toBe(true);
      expect(destroyStub.called).toBe(true);
    });

    it('should fail for non-owner non-admin attempting to revoke another user', async () => {
      const getCalendarStub = sandbox.stub(service, 'getCalendar');
      const isOwnerStub = sandbox.stub(service, 'isCalendarOwner');

      getCalendarStub.resolves(calendar);
      isOwnerStub.resolves(false);

      await expect(service.removeEditAccess(nonOwner, 'cal-id', 'owner-id'))
        .rejects.toThrow('Permission denied: only calendar owner or the editor themselves can revoke edit access');
    });

    it('should allow self-revocation for non-owner editors', async () => {
      const getCalendarStub = sandbox.stub(service, 'getCalendar');
      const isOwnerStub = sandbox.stub(service, 'isCalendarOwner');
      const destroyStub = sandbox.stub(CalendarEditorEntity, 'destroy');

      getCalendarStub.resolves(calendar);
      isOwnerStub.resolves(false); // User is not the calendar owner
      destroyStub.resolves(1); // One record deleted

      // User removing themselves (same account ID)
      const result = await service.removeEditAccess(nonOwner, 'cal-id', nonOwner.id);

      expect(result).toBe(true);
      expect(destroyStub.called).toBe(true);
    });

    it('should prevent self-revocation for calendar owners', async () => {
      const getCalendarStub = sandbox.stub(service, 'getCalendar');
      const isOwnerStub = sandbox.stub(service, 'isCalendarOwner');

      getCalendarStub.resolves(calendar);
      isOwnerStub.withArgs(owner, calendar).resolves(true); // User is owner trying to remove themselves

      // Owner trying to remove themselves
      await expect(service.removeEditAccess(owner, 'cal-id', owner.id))
        .rejects.toThrow('Calendar owners cannot remove themselves from their own calendar');
    });

    it('should succeed for admin even if not owner', async () => {
      const getCalendarStub = sandbox.stub(service, 'getCalendar');
      const destroyStub = sandbox.stub(CalendarEditorEntity, 'destroy');
      const isOwnerStub = sandbox.stub(service, 'isCalendarOwner');

      isOwnerStub.resolves(false); // Admin is not the owner
      getCalendarStub.resolves(calendar);
      destroyStub.resolves(1); // One record deleted

      const result = await service.removeEditAccess(admin, 'cal-id', 'user-id');
      expect(result).toBe(true);
      expect(destroyStub.called).toBe(true);
    });
  });

  describe('listCalendarEditors', () => {
    it('should return active editors and pending invitations for calendar owner', async () => {
      // Mock the calendar and permission checks
      const getCalendarStub = sandbox.stub(service, 'getCalendar');
      const canViewEditorsStub = sandbox.stub(service as any, 'canViewCalendarEditors');

      getCalendarStub.resolves(calendar);
      canViewEditorsStub.resolves(true);

      // Mock active editors
      const mockEditor = {
        toModel: () => new CalendarEditor('editor-id', 'cal-id', 'user-id'),
      };
      const findAllStub = sandbox.stub(CalendarEditorEntity, 'findAll');
      findAllStub.resolves([mockEditor as any]);

      // Mock pending invitations
      const mockInvitation = {
        id: 'invite-id',
        email: 'invitee@example.com',
        expiration_time: new Date('2025-10-01'),
        calendar_id: 'cal-id',
      };
      mockAccountsInterface.getAccountById.withArgs('owner-id').resolves(owner);

      const result = await service.listCalendarEditors(owner, 'cal-id');

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(CalendarEditor);
      expect(getCalendarStub.calledWith('cal-id')).toBe(true);
      expect(canViewEditorsStub.calledWith(owner, 'cal-id')).toBe(true);
    });

    it('should throw CalendarNotFoundError when calendar does not exist', async () => {
      const getCalendarStub = sandbox.stub(service, 'getCalendar');
      getCalendarStub.resolves(null);

      await expect(service.listCalendarEditors(owner, 'non-existent-id'))
        .rejects.toThrow('Calendar not found');
    });

    it('should throw CalendarEditorPermissionError for non-owner', async () => {
      const getCalendarStub = sandbox.stub(service, 'getCalendar');
      const canViewEditorsStub = sandbox.stub(service as any, 'canViewCalendarEditors');
      const findAllStub = sandbox.stub(CalendarEditorEntity, 'findAll');

      getCalendarStub.resolves(calendar);
      canViewEditorsStub.resolves(false);
      findAllStub.resolves([]); // This shouldn't be called, but stub it anyway

      await expect(service.listCalendarEditors(nonOwner, 'cal-id'))
        .rejects.toThrow('Permission denied: only calendar owner can view editors');
    });
  });
});
