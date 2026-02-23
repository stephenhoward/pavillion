import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import CalendarInterface from '@/server/calendar/interface';
import CategoryMappingService from '@/server/calendar/service/category_mapping';

describe('CalendarInterface.assignManualRepostCategories', () => {
  let sandbox: sinon.SinonSandbox;
  let calendarInterface: CalendarInterface;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    calendarInterface = new CalendarInterface(new EventEmitter());
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should delegate to categoryMappingService.assignManualRepostCategories', async () => {
    const delegateStub = sandbox
      .stub(CategoryMappingService.prototype, 'assignManualRepostCategories')
      .resolves();

    await calendarInterface.assignManualRepostCategories('event-uuid-1', ['cat-1', 'cat-2']);

    expect(delegateStub.calledOnce).toBe(true);
    expect(delegateStub.firstCall.args).toEqual(['event-uuid-1', ['cat-1', 'cat-2']]);
  });

  it('should pass empty categoryIds array to the service', async () => {
    const delegateStub = sandbox
      .stub(CategoryMappingService.prototype, 'assignManualRepostCategories')
      .resolves();

    await calendarInterface.assignManualRepostCategories('event-uuid-1', []);

    expect(delegateStub.calledOnce).toBe(true);
    expect(delegateStub.firstCall.args).toEqual(['event-uuid-1', []]);
  });

  it('should return void and not throw when delegation succeeds', async () => {
    sandbox
      .stub(CategoryMappingService.prototype, 'assignManualRepostCategories')
      .resolves();

    await expect(
      calendarInterface.assignManualRepostCategories('event-uuid-1', ['cat-1']),
    ).resolves.toBeUndefined();
  });
});
