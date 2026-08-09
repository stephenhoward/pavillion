import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import CalendarInterface from '@/server/calendar/interface';
import CalendarService from '@/server/calendar/service/calendar';

describe('CalendarInterface.getCalendarUrlNames', () => {
  let sandbox: sinon.SinonSandbox;
  let calendarInterface: CalendarInterface;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    calendarInterface = new CalendarInterface(new EventEmitter());
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should delegate to calendarService.getCalendarUrlNames with the set unchanged', async () => {
    const ids = new Set(['cal-1', 'cal-2']);
    const delegateStub = sandbox
      .stub(CalendarService.prototype, 'getCalendarUrlNames')
      .resolves(new Map());

    await calendarInterface.getCalendarUrlNames(ids);

    expect(delegateStub.calledOnce).toBe(true);
    expect(delegateStub.firstCall.args).toEqual([ids]);
    expect(delegateStub.firstCall.args[0]).toBe(ids);
  });

  it('should return the map produced by the service unchanged', async () => {
    const serviceResult = new Map([['cal-1', 'my-calendar']]);
    sandbox
      .stub(CalendarService.prototype, 'getCalendarUrlNames')
      .resolves(serviceResult);

    const result = await calendarInterface.getCalendarUrlNames(new Set(['cal-1']));

    expect(result).toBe(serviceResult);
    expect(result.get('cal-1')).toBe('my-calendar');
  });

  it('should pass an empty set through to the service', async () => {
    const delegateStub = sandbox
      .stub(CalendarService.prototype, 'getCalendarUrlNames')
      .resolves(new Map());

    const result = await calendarInterface.getCalendarUrlNames(new Set());

    expect(delegateStub.calledOnce).toBe(true);
    expect(delegateStub.firstCall.args[0].size).toBe(0);
    expect(result.size).toBe(0);
  });
});
