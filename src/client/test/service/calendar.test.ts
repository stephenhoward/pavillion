// filepath: /Users/stephen/dev/pavillion/src/client/test/service/calendar.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import axios from 'axios';
import CalendarService from '@/client/service/calendar';
import ModelService from '@/client/service/models';
import { Calendar } from '@/common/model/calendar';
import { EmptyValueError, UnknownError } from '@/common/exceptions';
import { UrlNameAlreadyExistsError, InvalidUrlNameError } from '@/common/exceptions/calendar';
import { useCalendarStore } from '@/client/stores/calendarStore';

// Mock axios
vi.mock('axios');

describe('loadCalendars', () => {
  const sandbox = sinon.createSandbox();
  let mockStore: ReturnType<typeof useCalendarStore>;
  let service: CalendarService;

  beforeEach(() => {
    // Create a mock store before each test
    mockStore = {
      setCalendars: sandbox.stub(),
      loaded: false,
    };
    // Stub the useCalendarStore function to always return our mock
    service = new CalendarService(mockStore);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should return calendars from store if loaded and not forced to reload', async () => {
    // Arrange
    const calendars = [
      new Calendar('cal1', 'calendar-1'),
      new Calendar('cal2', 'calendar-2'),
    ];
    mockStore.calendars = calendars;
    mockStore.loaded = true;
    const mockListModels = sandbox.stub(ModelService, 'listModels');
    mockListModels.resolves([]);

    // Act
    const result = await service.loadCalendars();

    // Assert
    expect(mockListModels.called).toBe(false);
    expect(result).toBe(calendars);
  });

  it('should fetch calendars from API when not loaded', async () => {
    // Arrange
    const calendars = [
      new Calendar('cal1', 'calendar-1'),
      new Calendar('cal2', 'calendar-2'),
    ];
    const mockListModels = sandbox.stub(ModelService, 'listModels');
    mockListModels.resolves(calendars.map(calendar => calendar.toObject()));

    // Ensure the store appears empty/not loaded
    mockStore.loaded = false;
    mockStore.calendars = [];

    // Act
    const result = await service.loadCalendars();

    // Assert
    expect(mockListModels.called).toBe(true);
    expect(result).toEqual(calendars);  // Use toEqual instead of toBe for object comparison
  });

  it('should fetch calendars from API when forced to reload', async () => {
    // Arrange
    const calendars = [
      new Calendar('cal1', 'calendar-1'),
      new Calendar('cal2', 'calendar-2'),
    ];
    mockStore.setCalendars(calendars);
    const mockListModels = sandbox.stub(ModelService, 'listModels');
    mockListModels.resolves(calendars.map(calendar => calendar.toObject()));

    // Act
    const result = await service.loadCalendars(true);

    // Assert
    expect(mockListModels.called).toBe(true);
    expect(result).toEqual(calendars); // Use toEqual instead of toBe for object comparison
  });

  it('should throw an error when loading calendars fails', async () => {
    // Arrange
    const mockError = new Error('API Error');
    const mockListModels = sandbox.stub(ModelService, 'listModels');
    mockListModels.rejects(mockError);

    // Act & Assert
    await expect(service.loadCalendars())
      .rejects.toThrow('API Error');
  });
});

describe('createCalendar', () => {
  const sandbox = sinon.createSandbox();
  let mockStore: ReturnType<typeof useCalendarStore>;
  let service: CalendarService;
  let mockCreate: sinon.SinonStub;

  beforeEach(() => {
    // Create a mock store before each test
    mockStore = {
      addCalendar: sandbox.stub(),
    };
    // Stub the useCalendarStore function to always return our mock
    service = new CalendarService(mockStore);
    mockCreate = sandbox.stub(ModelService,'createModel');
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should create a calendar with valid url name', async () => {
    // Arrange
    const urlName = 'test-calendar';
    const mockCreatedCalendar = { id: 'cal1', urlName };
    mockCreate.resolves(mockCreatedCalendar);

    // Act
    const result = await service.createCalendar(urlName);

    // Assert
    expect(mockCreate.called).toBe(true);
    expect(result.urlName).toBe(urlName);
    expect(mockStore.addCalendar.called).toBe(true);
  });

  it('should throw EmptyValueError when url name is empty', async () => {
    // Act & Assert
    await expect(service.createCalendar('')).rejects.toThrow(EmptyValueError);
    expect(mockCreate.called).toBe(false);
  });

  it('should throw EmptyValueError when url name is only whitespace', async () => {
    // Act & Assert
    await expect(service.createCalendar('   ')).rejects.toThrow(EmptyValueError);
    expect(mockCreate.called).toBe(false);
  });

  it('should handle UrlNameAlreadyExistsError from API', async () => {
    // Arrange
    const urlName = 'existing-calendar';
    const mockError = {
      response: {
        data: {
          errorName: 'UrlNameAlreadyExistsError',
        },
      },
    };
    mockCreate.rejects(mockError);

    // Act & Assert
    await expect(service.createCalendar(urlName)).rejects.toThrow(UrlNameAlreadyExistsError);
    expect(mockCreate.called).toBe(true);
  });

  it('should handle InvalidUrlNameError from API', async () => {
    // Arrange
    mockCreate.rejects({
      response: {
        data: {
          errorName: 'InvalidUrlNameError',
        },
      },
    });

    // Act & Assert
    await expect(service.createCalendar('invalid-name')).rejects.toThrow(InvalidUrlNameError);
    expect(mockCreate.called).toBe(true);
  });

  it('should throw UnknownError for unexpected errors', async () => {
    // Arrange
    (ModelService.createModel as sinon.SinonStub).rejects(new Error('Unexpected error'));

    // Act & Assert
    await expect(service.createCalendar('test-calendar')).rejects.toThrow(UnknownError);
    expect(mockCreate.called).toBe(true);
  });
});

describe('getCalendarByUrlName', () => {
  const sandbox = sinon.createSandbox();
  let mockStore: ReturnType<typeof useCalendarStore>;
  let service: CalendarService;

  beforeEach(() => {
    // Create a mock store before each test
    mockStore = {
      getCalendarByUrlName: sandbox.stub(),
    };
    service = new CalendarService(mockStore);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should return calendar from store if found', async () => {
    // Arrange
    const urlName = 'test-calendar';
    const mockCalendar = new Calendar('cal1', urlName);
    mockStore.getCalendarByUrlName.returns(mockCalendar);
    const loadCalendarsStub = sandbox.stub(service, 'loadCalendars').resolves([mockCalendar]);

    // Act
    const result = await service.getCalendarByUrlName(urlName);

    // Assert
    sinon.assert.called(loadCalendarsStub);
    sinon.assert.calledWith(mockStore.getCalendarByUrlName, urlName);
    expect(result).toBe(mockCalendar);
  });

  it('should return null if calendar not found', async () => {
    // Arrange
    const urlName = 'non-existent-calendar';
    mockStore.getCalendarByUrlName.returns(null);
    const loadCalendarsStub = sandbox.stub(service, 'loadCalendars').resolves([]);

    // Act
    const result = await service.getCalendarByUrlName(urlName);

    // Assert
    sinon.assert.called(loadCalendarsStub);
    sinon.assert.calledWith(mockStore.getCalendarByUrlName, urlName);
    expect(result).toBeNull();
  });
});

describe('updateCalendar', () => {
  const sandbox = sinon.createSandbox();
  let mockStore: ReturnType<typeof useCalendarStore>;
  let service: CalendarService;
  let mockUpdate: sinon.SinonStub;

  beforeEach(() => {
    // Create a mock store before each test
    mockStore = {
      updateCalendar: sandbox.stub(),
    };
    // Stub the useCalendarStore function to always return our mock
    service = new CalendarService(mockStore);
    mockUpdate = sandbox.stub(ModelService,'updateModel');
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should update an existing calendar', async () => {
    // Arrange
    const calendar = new Calendar('cal1', 'updated-calendar');
    const mockUpdatedCalendar = { id: 'cal1', urlName: 'updated-calendar' };
    mockUpdate.resolves(mockUpdatedCalendar);

    // Act
    const result = await service.updateCalendar(calendar);

    // Assert
    sinon.assert.calledWith(
      ModelService.updateModel as sinon.SinonStub,
      calendar,
      '/api/v1/calendars',
    );
    expect(result.id).toBe('cal1');
    expect(mockStore.updateCalendar.called).toBe(true);
  });

  it('should throw an error when updating calendar fails', async () => {
    // Arrange
    mockUpdate.rejects(new Error('API Error'));

    // Act & Assert
    await expect(service.updateCalendar(new Calendar('cal1', 'updated-calendar'))).rejects.toThrow('API Error');
  });
});

describe('deleteCalendar', () => {
  const sandbox = sinon.createSandbox();
  let mockStore: ReturnType<typeof useCalendarStore>;
  let service: CalendarService;
  let deleteModel: sinon.SinonStub;

  beforeEach(() => {
    // Create a mock store before each test
    mockStore = {
      removeCalendar: sandbox.stub(),
    };
    // Stub the useCalendarStore function to always return our mock
    service = new CalendarService(mockStore);
    deleteModel = sandbox.stub(ModelService,'deleteModel');
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should delete a calendar', async () => {
    // Arrange
    deleteModel.resolves({ success: true });

    // Act
    await service.deleteCalendar(new Calendar('cal1', 'delete-me'));

    // Assert
    expect(deleteModel.called).toBe(true);
    expect(mockStore.removeCalendar.called).toBe(true);
  });

  it('should throw an error when deleting calendar fails', async () => {
    // Arrange
    deleteModel.rejects(new Error('API Error'));

    // Act & Assert
    await expect(service.deleteCalendar(new Calendar('cal1', 'delete-me'))).rejects.toThrow('API Error');
  });
});

describe('listCalendarEditors', () => {
  const sandbox = sinon.createSandbox();
  let mockStore: ReturnType<typeof useCalendarStore>;
  let service: CalendarService;

  beforeEach(() => {
    mockStore = {};
    service = new CalendarService(mockStore);
  });

  afterEach(() => {
    sandbox.restore();
    vi.clearAllMocks();
  });

  it('should list calendar editors successfully', async () => {
    // Arrange
    const calendarId = 'cal1';
    const editorsData = [
      { id: 'editor1', calendarId, email: 'user1' },
      { id: 'editor2', calendarId, email: 'user2' },
    ];
    const axiosGet = vi.mocked(axios.get);
    axiosGet.mockResolvedValue({ data: editorsData });

    // Act
    const result = await service.listCalendarEditors(calendarId);

    // Assert
    expect(axiosGet).toHaveBeenCalledWith(`/api/v1/calendars/${calendarId}/editors`);
    expect(result).toHaveLength(2);
    expect(result[0].email).toBe('user1');
    expect(result[1].email).toBe('user2');
  });

  it('should handle permission error when listing editors', async () => {
    // Arrange
    const calendarId = 'cal1';
    const axiosGet = vi.mocked(axios.get);
    axiosGet.mockRejectedValue({
      response: {
        data: { errorName: 'CalendarEditorPermissionError' },
      },
    });

    // Act & Assert
    await expect(service.listCalendarEditors(calendarId))
      .rejects.toThrow('Permission denied: only calendar owner can manage editors');
  });

  it('should handle calendar not found error when listing editors', async () => {
    // Arrange
    const calendarId = 'nonexistent';
    const axiosGet = vi.mocked(axios.get);
    axiosGet.mockRejectedValue({
      response: {
        data: { errorName: 'CalendarNotFoundError' },
      },
    });

    // Act & Assert
    await expect(service.listCalendarEditors(calendarId))
      .rejects.toThrow('Calendar not found');
  });
});

describe('grantEditAccess', () => {
  const sandbox = sinon.createSandbox();
  let mockStore: ReturnType<typeof useCalendarStore>;
  let service: CalendarService;

  beforeEach(() => {
    mockStore = {};
    service = new CalendarService(mockStore);
  });

  afterEach(() => {
    sandbox.restore();
    vi.clearAllMocks();
  });

  it('should grant edit access successfully', async () => {
    // Arrange
    const calendarId = 'cal1';
    const email = 'user1';
    const editorData = { id: 'editor1', calendarId, email };
    const axiosPost = vi.mocked(axios.post);
    axiosPost.mockResolvedValue({ data: editorData });

    // Act
    const result = await service.grantEditAccess(calendarId, email);

    // Assert
    expect(axiosPost).toHaveBeenCalledWith(`/api/v1/calendars/${calendarId}/editors`, { email });
    expect(result.email).toBe(email);
    expect(result.calendarId).toBe(calendarId);
  });

  it('should throw EmptyValueError when accountId is empty', async () => {
    // Act & Assert
    await expect(service.grantEditAccess('cal1', '')).rejects.toThrow('accountId is empty');
  });

  it('should throw EmptyValueError when accountId is only whitespace', async () => {
    // Act & Assert
    await expect(service.grantEditAccess('cal1', '   ')).rejects.toThrow('accountId is empty');
  });

  it('should handle editor already exists error', async () => {
    // Arrange
    const calendarId = 'cal1';
    const accountId = 'user1';
    const axiosPost = vi.mocked(axios.post);
    axiosPost.mockRejectedValue({
      response: {
        data: { errorName: 'EditorAlreadyExistsError' },
      },
    });

    // Act & Assert
    await expect(service.grantEditAccess(calendarId, accountId))
      .rejects.toThrow('Editor relationship already exists');
  });

  it('should handle permission error when granting access', async () => {
    // Arrange
    const calendarId = 'cal1';
    const email = 'user1';
    const axiosPost = vi.mocked(axios.post);
    axiosPost.mockRejectedValue({
      response: {
        data: { errorName: 'CalendarEditorPermissionError' },
      },
    });

    // Act & Assert
    await expect(service.grantEditAccess(calendarId, email))
      .rejects.toThrow('Permission denied: only calendar owner can manage editors');
  });
});

describe('revokeEditAccess', () => {
  const sandbox = sinon.createSandbox();
  let mockStore: ReturnType<typeof useCalendarStore>;
  let service: CalendarService;

  beforeEach(() => {
    mockStore = {};
    service = new CalendarService(mockStore);
  });

  afterEach(() => {
    sandbox.restore();
    vi.clearAllMocks();
  });

  it('should revoke edit access successfully', async () => {
    // Arrange
    const calendarId = 'cal1';
    const editorId = 'editor1';
    const axiosDelete = vi.mocked(axios.delete);
    axiosDelete.mockResolvedValue({});

    // Act
    await service.revokeEditAccess(calendarId, editorId);

    // Assert
    expect(axiosDelete).toHaveBeenCalledWith(`/api/v1/calendars/${calendarId}/editors/${editorId}`);
  });

  it('should throw EmptyValueError when editorId is empty', async () => {
    // Act & Assert
    await expect(service.revokeEditAccess('cal1', '')).rejects.toThrow('editorId is empty');
  });

  it('should throw EmptyValueError when editorId is only whitespace', async () => {
    // Act & Assert
    await expect(service.revokeEditAccess('cal1', '   ')).rejects.toThrow('editorId is empty');
  });

  it('should handle editor not found error', async () => {
    // Arrange
    const calendarId = 'cal1';
    const email = 'user1';
    const axiosDelete = vi.mocked(axios.delete);
    axiosDelete.mockRejectedValue({
      response: {
        data: { errorName: 'EditorNotFoundError' },
      },
    });

    // Act & Assert
    await expect(service.revokeEditAccess(calendarId, email))
      .rejects.toThrow('Editor relationship not found');
  });

  it('should handle permission error when revoking access', async () => {
    // Arrange
    const calendarId = 'cal1';
    const editorId = 'user1';
    const axiosDelete = vi.mocked(axios.delete);
    axiosDelete.mockRejectedValue({
      response: {
        data: { errorName: 'CalendarEditorPermissionError' },
      },
    });

    // Act & Assert
    await expect(service.revokeEditAccess(calendarId, editorId))
      .rejects.toThrow('Permission denied: only calendar owner can manage editors');
  });
});
