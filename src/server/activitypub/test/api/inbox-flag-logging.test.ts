/**
 * Logging-hygiene tests for the inbound Flag path.
 *
 * A Flag carries two things nothing else on the inbox route carries: the
 * remote reporter's actor URI, and the free text of a moderation report.
 * Everywhere downstream both are reduced to a bare instance host before
 * anything durable is written (see `anonymizeFlagActor` and the
 * `forwardedFromInstance` column). The inbox route's unconditional
 * body log predates Flag support and would bypass that reduction entirely,
 * so it is special-cased — these tests pin that behavior.
 *
 * The logger module is mocked wholesale because `createLogger` returns a new
 * pino child per call; there is no shared instance a spy could attach to.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

const { logCalls } = vi.hoisted(() => ({ logCalls: [] as unknown[][] }));

vi.mock('@/server/common/helper/logger', () => {
  const record = (level: string) => (...args: unknown[]) => { logCalls.push([level, ...args]); };
  const stub: Record<string, unknown> = {
    trace: record('trace'),
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    fatal: record('fatal'),
    level: 'silent',
  };
  stub.child = () => stub;
  return { createLogger: () => stub, default: stub };
});

import { Calendar } from '@/common/model/calendar';
import ActivityPubServerRoutes from '@/server/activitypub/api/v1/server';
import ActivityPubInterface from '@/server/activitypub/interface';
import CalendarInterface from '@/server/calendar/interface';

const REPORTER_ACTOR_URI = 'https://remote.example.com/calendars/reporter';
const REPORT_TEXT = 'Reporter narrative that must never reach the logs';

describe('addToInbox logging hygiene for Flag activities', () => {
  let routes: ActivityPubServerRoutes;
  let sandbox: sinon.SinonSandbox;
  let activityPubInterface: ActivityPubInterface;
  let calendarAPI: CalendarInterface;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    logCalls.length = 0;

    const eventBus = new EventEmitter();
    activityPubInterface = new ActivityPubInterface(eventBus);
    calendarAPI = new CalendarInterface(eventBus);
    routes = new ActivityPubServerRoutes(activityPubInterface, calendarAPI);

    sandbox.stub(calendarAPI, 'getCalendarByName').resolves(new Calendar('testId', 'testuser'));
    sandbox.stub(activityPubInterface, 'addToInbox').resolves();
  });

  afterEach(() => {
    sandbox.restore();
  });

  const post = async (body: Record<string, unknown>) => {
    const req = { params: { urlname: 'testuser' }, body };
    const res = { status: sinon.stub(), send: sinon.stub(), json: sinon.stub() };
    res.status.returns(res);
    await routes.addToInbox(req as any, res as any);
    return res;
  };

  it('logs neither the reporter actor URI nor the report text for an accepted Flag', async () => {
    const res = await post({
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Flag',
      id: 'https://remote.example.com/flags/log-1',
      actor: REPORTER_ACTOR_URI,
      object: 'https://local.example.com/events/6b1f0a5e-0000-4000-8000-000000000001',
      content: REPORT_TEXT,
      summary: 'Event report: spam',
      tag: [{ type: 'Hashtag', name: '#spam' }],
    });

    expect(res.status.calledWith(200)).toBe(true);

    const logged = JSON.stringify(logCalls);
    expect(logged, 'report free text must not be logged').not.toContain(REPORT_TEXT);
    expect(logged, 'reporter actor URI must not be logged').not.toContain(REPORTER_ACTOR_URI);
  });

  it('still logs the full body for a non-Flag activity', async () => {
    // Guards against the redaction being applied indiscriminately: the body
    // log is a federation debugging aid for every other activity type.
    await post({
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Follow',
      id: 'https://remote.example.com/activities/follow-1',
      actor: REPORTER_ACTOR_URI,
      object: 'https://local.example.com/calendars/testuser',
    });

    const logged = JSON.stringify(logCalls);
    expect(logged).toContain('activityBody');
    expect(logged).toContain(REPORTER_ACTOR_URI);
  });

  it('does not log the report text when a Flag is rejected as invalid', async () => {
    const res = await post({
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Flag',
      id: 'https://remote.example.com/flags/log-2',
      actor: REPORTER_ACTOR_URI,
      // No `object` — the schema rejects this, and the rejection log must not
      // echo the offending body back into the logs.
      content: REPORT_TEXT,
    });

    expect(res.status.calledWith(400)).toBe(true);

    const logged = JSON.stringify(logCalls);
    expect(logged).not.toContain(REPORT_TEXT);
    expect(logged).not.toContain(REPORTER_ACTOR_URI);
  });
});
