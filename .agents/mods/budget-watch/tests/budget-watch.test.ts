import { expect, mock, test } from 'claude-code/testing';
import type { Engine } from 'claude-code/testing';
import type { On, SessionRateLimit, TurnStepResult } from 'claude-code';

const WINDOW = 200_000;
const HOUR = 60 * 60 * 1000;

type Appended = { text: string; agentId?: string };

/**
 * The engine beneath the mod: a session whose window is WINDOW tokens and
 * whose rate-limit readings the test sets, recording what the mod appends
 * and submits.
 */
function world(on: On, rateLimits: SessionRateLimit[] = []) {
  const appended: Appended[] = [];
  const prompts: string[] = [];
  const agents: { id: string; type: string; status: string; description: string }[] = [];

  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: WINDOW, tokens: 0, percent: 0 }, rateLimits },
  }));
  on('agent.list', () => ({ value: agents }));
  // A plugin's own session.append never reaches a test hook in this build
  // (the kit has no store beneath it), so the recorder reads the debug-log
  // line the mod writes beside every append: the text, then its destination.
  on('ui.log', ($, e) => {
    const match = /^(.*) -> (\S+)$/.exec(e.text);
    if (match !== null && e.to === 'debug') {
      const [, text = '', target = ''] = match;
      appended.push({ text, ...(target === 'main' ? {} : { agentId: target }) });
    }
    return { value: undefined };
  });
  on('ui.toast', () => ({ value: undefined }));
  on('prompt.submit', ($, e) => {
    prompts.push(e.text);
    return { text: e.text };
  });
  on('session.measure', ($, e) => ({ changed: e.changed }));
  on('turn.complete', ($, e) => ({ text: e.answer }));
  on('command.run', () => ({ text: '' }));

  let percentNext = 0;
  on('turn.step', async function* ($, e) {
    const result: TurnStepResult = {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn',
      usage: {
        model: e.model,
        input_tokens: Math.round((WINDOW * percentNext) / 100),
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    };
    return result;
  });

  return {
    appended,
    prompts,
    agents,
    rateLimits,
    /** Runs one model step of a loop whose response reports `percent` of the window used. */
    async step($: Engine, percent: number, agentId?: string) {
      percentNext = percent;
      const stream = $.turn.step({
        turnId: 'turn-1',
        index: 0,
        model: 'test-model',
        messageCount: 1,
        ...(agentId === undefined ? {} : { agentId }),
      });
      for await (const _chunk of stream) {
        // drain
      }
      return stream.result;
    },
    async measure($: Engine, readings: SessionRateLimit[]) {
      rateLimits.splice(0, rateLimits.length, ...readings);
      return $.session.measure({ context: { window: WINDOW }, rateLimits: readings, changed: ['rateLimits'] });
    },
  };
}

const texts = (rows: Appended[]) => rows.map(row => row.text);
const command = (args: string) => ({
  command: 'budget',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 80 },
});

test('context: a line at the first band, one per band after, none between', async ($, on) => {
  const w = world(on);
  await w.step($, 12);
  await w.step($, 39);
  expect(w.appended).toHaveLength(0);

  await w.step($, 41);
  expect(texts(w.appended)).toEqual(['[budget] context 41% (main)']);

  await w.step($, 44);
  expect(w.appended).toHaveLength(1);

  await w.step($, 47);
  expect(texts(w.appended)).toEqual(['[budget] context 41% (main)', '[budget] context 47% (main)']);
});

test('context: a jump over several bands appends one line', async ($, on) => {
  const w = world(on);
  await w.step($, 10);
  await w.step($, 63);
  expect(texts(w.appended)).toEqual(['[budget] context 63% (main)']);
});

test('context: a drop re-arms the bands without a line', async ($, on) => {
  const w = world(on);
  await w.step($, 52);
  expect(w.appended).toHaveLength(1);

  await w.step($, 20);
  expect(w.appended).toHaveLength(1);

  await w.step($, 45);
  expect(texts(w.appended)[1]).toBe('[budget] context 45% (main)');
});

test('context: a subagent loop is tracked apart and its line goes to that loop', async ($, on) => {
  const w = world(on);
  w.agents.push({ id: 'agent-abcdef12-rest', type: 'implementer', status: 'running', description: 'x' });
  await w.step($, 55);
  await w.step($, 42, 'agent-abcdef12-rest');
  expect(w.appended).toEqual([
    { text: '[budget] context 55% (main)' },
    { text: '[budget] context 42% (agent agent-ab, implementer)', agentId: 'agent-abcdef12-rest' },
  ]);

  await w.step($, 56);
  expect(w.appended).toHaveLength(2);
});

test('context: the first band and the step come from userConfig', { options: { contextStart: 60, contextStep: 10 } }, async ($, on) => {
  const w = world(on);
  await w.step($, 45);
  await w.step($, 59);
  expect(w.appended).toHaveLength(0);
  await w.step($, 61);
  await w.step($, 68);
  await w.step($, 71);
  expect(texts(w.appended)).toEqual(['[budget] context 61% (main)', '[budget] context 71% (main)']);
});

test('session: five-hour bands fire once each, re-arm on reset, and reach running agents', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 2, 12, 0) });
  const w = world(on);
  const resetsAt = new Date(clock.now() + 2 * HOUR).toISOString();

  await w.measure($, [{ kind: 'five_hour', percentUsed: 65, resetsAt }]);
  expect(w.appended).toHaveLength(0);

  await w.measure($, [{ kind: 'five_hour', percentUsed: 72, resetsAt }]);
  expect(w.appended).toHaveLength(1);
  expect(w.appended[0]?.text).toMatch(/^\[budget\] session five-hour 72%, resets .+/);
  expect(w.appended[0]?.text).not.toMatch(/at current rate/);

  await w.measure($, [{ kind: 'five_hour', percentUsed: 78, resetsAt }]);
  expect(w.appended).toHaveLength(1);

  w.agents.push({ id: 'agent-1', type: 'implementer', status: 'running', description: 'x' });
  w.agents.push({ id: 'agent-2', type: 'Explore', status: 'completed', description: 'y' });
  await w.measure($, [{ kind: 'five_hour', percentUsed: 83, resetsAt }]);
  expect(w.appended).toHaveLength(3);
  expect(w.appended[1]?.agentId).toBeUndefined();
  expect(w.appended[2]?.agentId).toBe('agent-1');

  await w.measure($, [{ kind: 'five_hour', percentUsed: 3, resetsAt }]);
  expect(w.appended).toHaveLength(3);

  // The 70 band fires again after the reset, to main and the running agent.
  await w.measure($, [{ kind: 'five_hour', percentUsed: 71, resetsAt }]);
  expect(w.appended).toHaveLength(5);
  expect(w.appended[3]?.text).toMatch(/^\[budget\] session five-hour 71%/);
  expect(w.appended[4]?.agentId).toBe('agent-1');
});

test('session: the burn-rate estimate appears once the samples span five minutes', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 2, 12, 0) });
  const w = world(on);
  const resetsAt = new Date(clock.now() + 3 * HOUR).toISOString();

  await w.measure($, [{ kind: 'five_hour', percentUsed: 60, resetsAt }]);
  await clock.advance(10 * 60 * 1000);
  await w.measure($, [{ kind: 'five_hour', percentUsed: 70, resetsAt }]);
  // 10 points in 10 minutes: 30 points left is about 30 minutes.
  expect(w.appended[0]?.text).toMatch(/about 30 min at current rate$/);
});

test('session: an unwatched window kind appends nothing', async ($, on) => {
  const w = world(on);
  await w.measure($, [{ kind: 'spend_limit', percentUsed: 95 }]);
  expect(w.appended).toHaveLength(0);
});

test('resume: a turn that dies on a five-hour limit submits the resume prompt at the reset', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 2, 12, 0) });
  const resetsAt = new Date(clock.now() + HOUR).toISOString();
  const w = world(on, [{ kind: 'five_hour', percentUsed: 100, resetsAt }]);

  await $.turn.complete({ turnId: 'turn-1', answer: '', durationMs: 1, isAborted: false, reason: 'error' });
  expect(w.prompts).toHaveLength(0);

  await clock.advance(HOUR - 1000);
  await clock.settle();
  expect(w.prompts).toHaveLength(0);

  await clock.advance(2 * 60 * 1000);
  await clock.settle();
  expect(w.prompts).toHaveLength(1);
  expect(w.prompts[0]).toMatch(/^The session rate limit has reset/);
});

test('resume: a subagent turn or a non-limit error plans nothing', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 2, 12, 0) });
  const resetsAt = new Date(clock.now() + HOUR).toISOString();
  const w = world(on, [{ kind: 'five_hour', percentUsed: 100, resetsAt }]);

  await $.turn.complete({ turnId: 'turn-1', agentId: 'agent-1', answer: '', durationMs: 1, isAborted: false, reason: 'error' });
  w.rateLimits.splice(0, 1, { kind: 'five_hour', percentUsed: 40, resetsAt });
  await $.turn.complete({ turnId: 'turn-2', answer: '', durationMs: 1, isAborted: false, reason: 'error' });
  await $.turn.complete({ turnId: 'turn-3', answer: 'done', durationMs: 1, isAborted: false, reason: 'answer' });

  await clock.advance(3 * HOUR);
  await clock.settle();
  expect(w.prompts).toHaveLength(0);
});

test('resume: a seven-day limit resumes only when its reset is within the horizon', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 2, 12, 0) });
  const far = new Date(clock.now() + 20 * HOUR).toISOString();
  const w = world(on, [{ kind: 'seven_day', percentUsed: 100, resetsAt: far }]);

  await $.turn.complete({ turnId: 'turn-1', answer: '', durationMs: 1, isAborted: false, reason: 'error' });
  await clock.advance(21 * HOUR);
  await clock.settle();
  expect(w.prompts).toHaveLength(0);

  const near = new Date(clock.now() + 2 * HOUR).toISOString();
  w.rateLimits.splice(0, 1, { kind: 'seven_day', percentUsed: 100, resetsAt: near });
  await $.turn.complete({ turnId: 'turn-2', answer: '', durationMs: 1, isAborted: false, reason: 'error' });
  await clock.advance(2 * HOUR + 2 * 60 * 1000);
  await clock.settle();
  expect(w.prompts).toHaveLength(1);
});

test('resume: autoResume off plans nothing, and /budget resume off cancels a plan', { options: { autoResume: false } }, async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 2, 12, 0) });
  const resetsAt = new Date(clock.now() + HOUR).toISOString();
  const w = world(on, [{ kind: 'five_hour', percentUsed: 100, resetsAt }]);

  await $.turn.complete({ turnId: 'turn-1', answer: '', durationMs: 1, isAborted: false, reason: 'error' });
  await clock.advance(2 * HOUR);
  await clock.settle();
  expect(w.prompts).toHaveLength(0);
});

test('resume: /budget resume off cancels the planned resume', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 2, 12, 0) });
  const resetsAt = new Date(clock.now() + HOUR).toISOString();
  const w = world(on, [{ kind: 'five_hour', percentUsed: 100, resetsAt }]);

  await $.turn.complete({ turnId: 'turn-1', answer: '', durationMs: 1, isAborted: false, reason: 'error' });
  const cancelled = await $.command.run(command('resume off'));
  expect(cancelled.text).toBe('Planned resume cancelled.');

  await clock.advance(2 * HOUR);
  await clock.settle();
  expect(w.prompts).toHaveLength(0);
});

test('/budget reports the readings and the resume state', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 2, 12, 0) });
  const resetsAt = new Date(clock.now() + HOUR).toISOString();
  const w = world(on, [{ kind: 'five_hour', percentUsed: 55, resetsAt }]);
  await w.step($, 10);

  const shown = await $.command.run(command(''));
  expect(shown.text).toMatch(/^context: 0% of 200000 tokens \(bands from 40% every 5%\)/m);
  expect(shown.text).toMatch(/^session: five-hour 55%, resets .+ \(bands 70, 80, 90, 95\)/m);
  expect(shown.text).toMatch(/^resume: none planned \(auto-resume on\)/m);
});
