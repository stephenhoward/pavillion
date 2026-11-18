import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import CalendarInterface from '@/server/calendar/interface';
import SyncService from '@/server/calendar/service/import/sync';
import type MediaInterface from '@/server/media/interface';

describe('CalendarInterface media wiring for ICS sync', () => {
  let sandbox: sinon.SinonSandbox;
  let calendarInterface: CalendarInterface;
  const mediaInterface = {} as MediaInterface;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    calendarInterface = new CalendarInterface(new EventEmitter());
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('forwards setMediaInterface to the shared sync service setter', () => {
    const setterStub = sandbox.stub(SyncService.prototype, 'setMediaInterface');

    calendarInterface.setMediaInterface(mediaInterface);

    expect(setterStub.calledOnce).toBe(true);
    expect(setterStub.firstCall.args[0]).toBe(mediaInterface);
  });

  it('passes the stored reference to services built by createSyncService afterwards', () => {
    calendarInterface.setMediaInterface(mediaInterface);

    const service = calendarInterface.createSyncService();

    expect((service as unknown as { mediaInterface?: MediaInterface }).mediaInterface).toBe(mediaInterface);
  });

  it('leaves mediaInterface unset on createSyncService before injection', () => {
    const service = calendarInterface.createSyncService();

    expect((service as unknown as { mediaInterface?: MediaInterface }).mediaInterface).toBeUndefined();
  });
});
