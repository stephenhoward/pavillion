import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { Calendar } from '@/common/model/calendar';
import { CalendarInfo } from '@/common/model/calendar_info';
import {
  CURRENT_CALENDAR_STORAGE_KEY,
  resolveCurrentCalendar,
  readPersistedCalendarId,
  writePersistedCalendarId,
} from '@/client/service/current-calendar';

const owned = (id: string) => new CalendarInfo(new Calendar(id, `owned-${id}`), 'owner');
const edited = (id: string) => new CalendarInfo(new Calendar(id, `edited-${id}`), 'editor');

describe('resolveCurrentCalendar', () => {
  const cases: Array<[string, string | null, CalendarInfo[], string | null]> = [
    ['persisted null → first owned', null, [edited('e1'), owned('o1'), owned('o2')], 'o1'],
    ['persisted not in list → first owned', 'gone', [owned('o1'), owned('o2')], 'o1'],
    ['persisted edited calendar is honoured', 'e1', [owned('o1'), edited('e1')], 'e1'],
    ['edited listed before owned still resolves owned', null, [edited('e1'), owned('o1')], 'o1'],
    ['editor-only account → first edited', null, [edited('e1'), edited('e2')], 'e1'],
    ['empty list → null', 'o1', [], null],
  ];

  it.each(cases)('%s', (_label, persisted, infos, expectedId) => {
    const result = resolveCurrentCalendar(persisted, infos);
    expect(result?.calendar.id ?? null).toBe(expectedId);
  });
});

describe('persisted calendar id', () => {
  let sandbox: sinon.SinonSandbox;
  let storage: Storage;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    storage = {
      getItem: sandbox.stub(),
      setItem: sandbox.stub(),
      removeItem: sandbox.stub(),
      clear: sandbox.stub(),
      key: sandbox.stub(),
      length: 0,
    } as unknown as Storage;
  });

  afterEach(() => sandbox.restore());

  it('reads a stored id', () => {
    (storage.getItem as sinon.SinonStub).withArgs(CURRENT_CALENDAR_STORAGE_KEY).returns('cal-1');
    expect(readPersistedCalendarId(storage)).toBe('cal-1');
  });

  it('treats blank or missing as null', () => {
    (storage.getItem as sinon.SinonStub).returns('   ');
    expect(readPersistedCalendarId(storage)).toBeNull();
    (storage.getItem as sinon.SinonStub).returns(null);
    expect(readPersistedCalendarId(storage)).toBeNull();
  });

  it('returns null when storage throws', () => {
    (storage.getItem as sinon.SinonStub).throws(new Error('blocked'));
    expect(readPersistedCalendarId(storage)).toBeNull();
  });

  it('writes an id and removes on null', () => {
    writePersistedCalendarId('cal-2', storage);
    sinon.assert.calledWith(storage.setItem as sinon.SinonStub, CURRENT_CALENDAR_STORAGE_KEY, 'cal-2');
    writePersistedCalendarId(null, storage);
    sinon.assert.calledWith(storage.removeItem as sinon.SinonStub, CURRENT_CALENDAR_STORAGE_KEY);
  });

  it('swallows a write failure', () => {
    (storage.setItem as sinon.SinonStub).throws(new Error('quota'));
    expect(() => writePersistedCalendarId('cal-3', storage)).not.toThrow();
  });
});
