import type {
  EngineInterface,
  PluginOptions,
  Register,
  SessionRateLimit,
} from 'claude-code';

import type { BudgetWatchResume, BudgetWatchSample } from '../types';

// Policy-free by design: the mod reports facts as `[budget]` lines and the
// role's skill decides what to do with them. The only action it takes on its
// own is the resume after a rate-limit stop, and that is a config switch.

const MAIN = 'main';
const SAMPLE_WINDOW_MS = 60 * 60 * 1000;
const MIN_SAMPLE_SPAN_MS = 5 * 60 * 1000;
const RESUME_MARGIN_MS = 60 * 1000;
const LIMIT_HIT_PERCENT = 99;
const HOUR_MS = 60 * 60 * 1000;

type Config = {
  contextStart: number
  contextStep: number
  fiveHourBands: number[]
  sevenDayBands: number[]
  autoResume: boolean
  sevenDayResumeHours: number
  resumePrompt: string
};

const resumeRef = { plugin: 'budget-watch', key: 'resume' } as const;

// The armed resume timer. A hot reload drops timers with the old environment,
// and `session.start` re-arms from `$.state`, so a module variable is enough.
let pending: { cancel: () => void } | undefined;

export const register: Register = (on, options) => {
  const config = readConfig(options);

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'budget',
      description:
        'Shows the context and session budget readings and any planned resume; `/budget resume off` cancels the resume.',
    });
    const { value: plan } = await $.state.get(resumeRef);
    if (plan) {
      arm($, config, plan, await $.clock.now());
    }
    return next(e);
  });

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e);
    const usage = result.usage;
    if (usage) {
      const used =
        usage.input_tokens +
        usage.cache_read_input_tokens +
        usage.cache_creation_input_tokens +
        usage.output_tokens;
      const { context } = await $.session.usage();
      if (context.window > 0) {
        const percent = Math.floor((used / context.window) * 100);
        await noteContext($, config, e.agentId, percent);
      }
    }
    return result;
  });

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      const now = await $.clock.now();
      for (const limit of e.rateLimits) {
        await noteLimit($, config, limit, now);
      }
    }
    return next(e);
  });

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && e.reason === 'error' && config.autoResume) {
      await planResume($, config);
    }
    return next(e);
  });

  on('command.run', { command: 'budget' }, async ($, e) => {
    if (e.args.trim() === 'resume off') {
      pending?.cancel();
      pending = undefined;
      await $.state.set(resumeRef, null);
      return { text: 'Planned resume cancelled.' };
    }
    return { text: await report($, config) };
  });
};

async function noteContext(
  $: EngineInterface,
  config: Config,
  agentId: string | undefined,
  percent: number,
): Promise<void> {
  const id = agentId ?? MAIN;
  const band = contextBand(percent, config.contextStart, config.contextStep);
  if (!(await crossedContext($, id, band))) {
    return;
  }
  const who = agentId === undefined ? MAIN : await describeAgent($, agentId);
  const text = `[budget] context ${percent}% (${who})`;
  await append($, text, agentId);
  if (agentId === undefined) {
    $.ui.toast(text);
  }
}

async function noteLimit(
  $: EngineInterface,
  config: Config,
  limit: SessionRateLimit,
  now: number,
): Promise<void> {
  const bands = bandsFor(config, limit.kind);
  if (bands === null) {
    return;
  }
  const samples = await recordSample($, limit.kind, limit.percentUsed, now);
  const band = listBand(limit.percentUsed, bands);
  if (!(await crossedSession($, limit.kind, band))) {
    return;
  }
  const text = describeLimit(limit, samples, now);
  await appendEverywhere($, text);
  $.ui.toast(text);
}

/**
 * Records the band now standing for a loop's context and says whether it
 * rose: the one case that earns a line. A drop (compaction) re-arms silently.
 */
async function crossedContext(
  $: EngineInterface,
  id: string,
  band: number | null,
): Promise<boolean> {
  const { value, version } = await $.state.get({ plugin: 'budget-watch', key: 'context', id });
  const last = value ?? null;
  if (band === last) {
    return false;
  }
  await $.state.set({ plugin: 'budget-watch', key: 'context', id }, band, { ifVersion: version });
  return rose(last, band);
}

/**
 * The same for a rate-limit window; a drop (the window reset) re-arms.
 */
async function crossedSession(
  $: EngineInterface,
  id: string,
  band: number | null,
): Promise<boolean> {
  const { value, version } = await $.state.get({ plugin: 'budget-watch', key: 'session', id });
  const last = value ?? null;
  if (band === last) {
    return false;
  }
  await $.state.set({ plugin: 'budget-watch', key: 'session', id }, band, { ifVersion: version });
  return rose(last, band);
}

function rose(last: number | null, band: number | null): boolean {
  return band !== null && (last === null || band > last);
}

async function recordSample(
  $: EngineInterface,
  kind: string,
  percent: number,
  now: number,
): Promise<BudgetWatchSample[]> {
  const { value } = await $.state.get({ plugin: 'budget-watch', key: 'samples', id: kind });
  const previous = value ?? [];
  const last = previous[previous.length - 1];
  const hasReset = last !== undefined && percent < last.percent;
  const kept = hasReset ? [] : previous.filter(sample => now - sample.at <= SAMPLE_WINDOW_MS);
  const samples = [...kept, { at: now, percent }];
  await $.state.set({ plugin: 'budget-watch', key: 'samples', id: kind }, samples);
  return samples;
}

/**
 * Appends the line to a loop's conversation as a user-role row the model
 * reads, and notes the same line and its destination in the debug log.
 */
async function append(
  $: EngineInterface,
  text: string,
  agentId?: string,
): Promise<void> {
  $.ui.log(`${text} -> ${agentId ?? MAIN}`, { to: 'debug' });
  try {
    await $.session.append({
      message: { type: 'user', content: [{ type: 'text', text }] },
      ...(agentId === undefined ? {} : { agentId }),
    });
  }
  catch {
    // The loop ended between the reading and the append; nothing to tell it.
  }
}

async function appendEverywhere($: EngineInterface, text: string): Promise<void> {
  await append($, text);
  const agents = await listAgents($);
  for (const agent of agents) {
    if (agent.status === 'running') {
      await append($, text, agent.id);
    }
  }
}

async function listAgents($: EngineInterface) {
  try {
    return await $.agent.list();
  }
  catch {
    return [];
  }
}

async function describeAgent($: EngineInterface, agentId: string): Promise<string> {
  const agent = (await listAgents($)).find(candidate => candidate.id === agentId);
  const short = agentId.slice(0, 8);
  return agent === undefined ? `agent ${short}` : `agent ${short}, ${agent.type}`;
}

async function report($: EngineInterface, config: Config): Promise<string> {
  const { context, rateLimits } = await $.session.usage();
  const now = await $.clock.now();
  const lines: string[] = [];
  const percent = context.percent === undefined ? 'unknown' : `${context.percent}%`;
  lines.push(
    `context: ${percent} of ${context.window} tokens (bands from ${config.contextStart}% every ${config.contextStep}%)`,
  );
  if (rateLimits.length === 0) {
    lines.push('session: no rate-limit reading yet');
  }
  for (const limit of rateLimits) {
    const bands = bandsFor(config, limit.kind);
    const bandText = bands === null ? 'not watched' : `bands ${bands.join(', ')}`;
    lines.push(`session: ${describeLimit(limit, [], now).replace('[budget] session ', '')} (${bandText})`);
  }
  const { value: plan } = await $.state.get(resumeRef);
  lines.push(
    plan
      ? `resume: planned at ${formatTime(plan.at, now)} after the ${plan.windows} limit`
      : `resume: none planned (auto-resume ${config.autoResume ? 'on' : 'off'})`,
  );
  return lines.join('\n');
}

function describeLimit(limit: SessionRateLimit, samples: BudgetWatchSample[], now: number): string {
  const parts = [`[budget] session ${labelFor(limit.kind)} ${limit.percentUsed}%`];
  const resetsAt = limit.resetsAt === undefined ? NaN : Date.parse(limit.resetsAt);
  if (!Number.isNaN(resetsAt)) {
    parts.push(`resets ${formatTime(resetsAt, now)}`);
  }
  const remaining = minutesRemaining(samples, limit.percentUsed);
  if (remaining !== null) {
    parts.push(`about ${formatDuration(remaining)} at current rate`);
  }
  return parts.join(', ');
}

/**
 * Minutes until the window fills at the rate the samples show, or null while
 * the samples are too few or too close together to say.
 */
function minutesRemaining(samples: BudgetWatchSample[], percent: number): number | null {
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (first === undefined || last === undefined) {
    return null;
  }
  const spanMs = last.at - first.at;
  const rise = last.percent - first.percent;
  if (spanMs < MIN_SAMPLE_SPAN_MS || rise <= 0) {
    return null;
  }
  const percentPerMinute = rise / (spanMs / 60000);
  return (100 - percent) / percentPerMinute;
}

function readConfig(options: PluginOptions): Config {
  return {
    contextStart: numberOption(options.contextStart, 40),
    contextStep: Math.max(1, numberOption(options.contextStep, 5)),
    fiveHourBands: bandList(options.fiveHourBands, [70, 80, 90, 95]),
    sevenDayBands: bandList(options.sevenDayBands, [90, 95]),
    autoResume: options.autoResume !== false,
    sevenDayResumeHours: numberOption(options.sevenDayResumeHours, 3),
    resumePrompt:
      typeof options.resumePrompt === 'string' && options.resumePrompt.trim() !== ''
        ? options.resumePrompt
        : 'The session rate limit has reset. Resume the work in progress from the handoff on the active bead. If there is no handoff, report the current state and stop.',
  };
}

function numberOption(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bandList(value: unknown, fallback: number[]): number[] {
  if (typeof value !== 'string') {
    return fallback;
  }
  const bands = value
    .split(',')
    .map(part => Number(part.trim()))
    .filter(n => Number.isFinite(n) && n > 0 && n <= 100)
    .sort((a, b) => a - b);
  return bands.length === 0 ? fallback : bands;
}

function bandsFor(config: Config, kind: string): number[] | null {
  if (kind === 'five_hour') {
    return config.fiveHourBands;
  }
  if (kind === 'seven_day') {
    return config.sevenDayBands;
  }
  return null;
}

function contextBand(percent: number, start: number, step: number): number | null {
  if (percent < start) {
    return null;
  }
  return start + Math.floor((percent - start) / step) * step;
}

function listBand(percent: number, bands: number[]): number | null {
  let band: number | null = null;
  for (const candidate of bands) {
    if (percent >= candidate) {
      band = candidate;
    }
  }
  return band;
}

function labelFor(kind: string): string {
  if (kind === 'five_hour') {
    return 'five-hour';
  }
  if (kind === 'seven_day') {
    return 'seven-day';
  }
  return kind.replace(/_/g, '-');
}

function formatTime(ms: number, now: number): string {
  const date = new Date(ms);
  try {
    const sameDay = date.toDateString() === new Date(now).toDateString();
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      ...(sameDay ? {} : { weekday: 'short' }),
    });
  }
  catch {
    return date.toISOString().slice(11, 16);
  }
}

function formatDuration(minutes: number): string {
  if (minutes < 90) {
    return `${Math.max(1, Math.round(minutes))} min`;
  }
  const hours = minutes / 60;
  return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} h`;
}

function arm(
  $: EngineInterface,
  cfg: Config,
  plan: BudgetWatchResume,
  now: number,
): void {
  pending?.cancel();
  pending = $.clock.after(Math.max(plan.at - now, 0), () => {
    pending = undefined;
    void fire($, cfg);
  });
  $.ui.toast(`[budget] session limit hit; resuming at ${formatTime(plan.at, now)}`);
}

async function fire($: EngineInterface, cfg: Config): Promise<void> {
  const { value: plan } = await $.state.get(resumeRef);
  if (!plan) {
    return;
  }
  await $.state.set(resumeRef, null);
  await $.prompt.submit({ text: cfg.resumePrompt });
}

async function planResume($: EngineInterface, cfg: Config): Promise<void> {
  const { rateLimits } = await $.session.usage();
  const now = await $.clock.now();
  const hit = rateLimits.filter(limit => limit.percentUsed >= LIMIT_HIT_PERCENT);
  if (hit.length === 0) {
    return;
  }
  let at: number | null = null;
  for (const limit of hit) {
    const resetsAt = limit.resetsAt === undefined ? NaN : Date.parse(limit.resetsAt);
    if (limit.kind !== 'five_hour' && limit.kind !== 'seven_day') {
      $.ui.toast(`[budget] ${labelFor(limit.kind)} limit hit; not resuming automatically`);
      return;
    }
    if (Number.isNaN(resetsAt)) {
      continue;
    }
    if (limit.kind === 'seven_day' && resetsAt - now > cfg.sevenDayResumeHours * HOUR_MS) {
      $.ui.toast(
        `[budget] seven-day limit hit, resets ${formatTime(resetsAt, now)}; not resuming automatically`,
      );
      return;
    }
    at = Math.max(at ?? 0, resetsAt);
  }
  if (at === null) {
    return;
  }
  const plan: BudgetWatchResume = {
    at: at + RESUME_MARGIN_MS,
    windows: hit.map(limit => labelFor(limit.kind)).join('+'),
  };
  await $.state.set(resumeRef, plan);
  arm($, cfg, plan, now);
}
