import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { readFileSync } from 'fs';
import path from 'path';
import {
  CURRENT_CALENDAR_STORAGE_KEY,
  readPersistedCalendarId,
  writePersistedCalendarId,
} from '@/client/service/current-calendar-storage';

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

describe('current-calendar-storage module', () => {
  // The calendar store and authn.ts both import this module; any dependency
  // here could reintroduce the store <-> current-calendar cycle or tie
  // authn.ts to the calendar store.
  it('has no static import, re-export, require() or dynamic import()', () => {
    const source = readFileSync(path.resolve(__dirname, '../../service/current-calendar-storage.ts'), 'utf-8');
    expect(source).not.toMatch(/^\s*import\b|\bfrom\s+['"]|\brequire\(|\bimport\s*\(/m);
  });
});
