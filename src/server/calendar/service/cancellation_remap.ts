import { DateTime } from 'luxon';
import { CalendarEventSchedule, compareSchedulesByStart } from '@/common/model/events';
import { expandScheduleOccurrences } from '@/server/calendar/service/event_instance';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('calendar');

/**
 * The most occurrences one schedule is walked for, on either side of an
 * edit: five times the instance service's materialization cap (1000). A daily
 * series is covered for about 13.7 years, a weekly one for about 96. A row
 * the walk cannot reach is left untouched, never removed.
 */
export const REMAP_MAX_OCCURRENCES = 5000;

/**
 * The most single-date cancellation rows an edit remaps (equal to the
 * materialization cap). Above it every row is left untouched.
 */
export const REMAP_MAX_ROWS = 1000;

/** A cancellation row to move onto `start`, with the hidden state it ends with. */
export interface CancellationMove {
  id: string;
  start: DateTime;
  hidden: boolean;
}

export interface CancellationRemap {
  move: CancellationMove[];
  remove: string[];
}

/** One side of an edit: its positive schedules and the frame they expand in. */
interface Side {
  schedules: CalendarEventSchedule[];
  base: CalendarEventSchedule | null;
}

/**
 * A schedule's raw occurrences, indexed by instant. `reach` is the last
 * instant the walk can speak for: a walk cut short by the cap knows nothing
 * past its last occurrence.
 */
interface Walk {
  schedule: CalendarEventSchedule;
  indexByMillis: Map<number, number>;
  reach: number;
}

type Classification =
  | { kind: 'keep' }
  | { kind: 'untouched' }
  | { kind: 'remove' }
  | { kind: 'move'; target: DateTime }
  | { kind: 'shift'; successor: CalendarEventSchedule; position: number };

function sideOf(schedules: CalendarEventSchedule[]): Side {
  const candidates = schedules.filter(s => !s.isExclusion && s.startDate);
  candidates.sort(compareSchedulesByStart);
  return { schedules, base: candidates[0] ?? null };
}

function walk(side: Side, schedule: CalendarEventSchedule, until: Date): Walk {
  const occurrences = expandScheduleOccurrences(schedule, side.base, until, REMAP_MAX_OCCURRENCES);
  const indexByMillis = new Map<number, number>();
  occurrences.forEach((d, i) => {
    if (!indexByMillis.has(d.getTime())) indexByMillis.set(d.getTime(), i);
  });
  const reach = occurrences.length >= REMAP_MAX_OCCURRENCES
    ? occurrences[occurrences.length - 1].getTime()
    : until.getTime();
  return { schedule, indexByMillis, reach };
}

function frameZone(side: Side) {
  return side.base?.startDate?.zone ?? 'UTC';
}

function sameByDay(a: string[] | undefined, b: string[] | undefined): boolean {
  const left = [...(a ?? [])].sort();
  const right = [...(b ?? [])].sort();
  return left.length === right.length && left.every((d, i) => d === right[i]);
}

/**
 * Whether a recurring schedule's cancellations may follow it by position:
 * the same pattern, and either the same wall date in each side's own frame
 * zone or the same start instant.
 */
function passesShiftGate(oldSchedule: CalendarEventSchedule, newSchedule: CalendarEventSchedule, oldSide: Side, newSide: Side): boolean {
  if (!oldSchedule.startDate || !newSchedule.startDate) return false;
  if (oldSchedule.frequency !== newSchedule.frequency) return false;
  if (oldSchedule.interval !== newSchedule.interval) return false;
  if (!sameByDay(oldSchedule.byDay, newSchedule.byDay)) return false;
  const oldWallDate = oldSchedule.startDate.setZone(frameZone(oldSide)).toISODate();
  const newWallDate = newSchedule.startDate.setZone(frameZone(newSide)).toISODate();
  return oldWallDate === newWallDate
    || oldSchedule.startDate.toMillis() === newSchedule.startDate.toMillis();
}

/**
 * Decides where an event's single-date cancellations go when its positive
 * schedules are edited (DEC-023 rule 7). Pure: it reads the schedules it is
 * given and returns the writes to make.
 *
 * Each row is classified on its own:
 *   1. its instant is an occurrence of the new schedules → kept;
 *   2. no old schedule has it as an occurrence → untouched (already orphaned);
 *   3. its old schedule is a one-off still present by id → moved to that
 *      schedule's new start;
 *   4. its old schedule is recurring, still present by id, and passes the
 *      shift gate → moved to the new schedule's occurrence at the same
 *      position in the raw expansion, or removed past the new series' end;
 *   5. otherwise → removed.
 *
 * Then collisions resolve, independent of row order: kept and untouched
 * rows claim their instants first, a mover onto a claimed instant is
 * removed, and of several movers onto one free instant the lowest id
 * survives. A survivor is hidden if any row in its collision was, so a
 * collision never publishes a date the owner hid.
 *
 * Recurring cancellation rows, rows with no start, and rows a capped walk
 * cannot reach are left untouched. Every id returned is an id of a row in
 * `exclusions`.
 *
 * @param oldPositives - the event's positive schedules before the edit
 * @param newPositives - its positive schedules after the edit
 * @param exclusions - its stored cancellation rows
 * @param eventId - the event's id, used only to log a skipped remap
 */
export function remapCancellations(
  oldPositives: CalendarEventSchedule[],
  newPositives: CalendarEventSchedule[],
  exclusions: CalendarEventSchedule[],
  eventId: string,
): CancellationRemap {
  const rows = exclusions.filter(e => e.isExclusion && e.frequency === null && e.startDate);
  if (rows.length === 0) {
    return { move: [], remove: [] };
  }
  if (rows.length > REMAP_MAX_ROWS) {
    logger.warn({ eventId }, 'Too many cancellations to remap on schedule edit; left untouched');
    return { move: [], remove: [] };
  }

  const oldSide = sideOf(oldPositives);
  const newSide = sideOf(newPositives);
  const latest = new Date(Math.max(...rows.map(r => r.startDate!.toMillis())));
  const oldWalks = oldSide.schedules.map(s => walk(oldSide, s, latest));
  const newWalks = newSide.schedules.map(s => walk(newSide, s, latest));

  const classify = (row: CalendarEventSchedule): Classification => {
    const ms = row.startDate!.toMillis();
    if (newWalks.some(w => w.indexByMillis.has(ms))) {
      return { kind: 'keep' };
    }
    if (newWalks.some(w => ms > w.reach)) {
      // A new schedule might still have it; the walk cannot say.
      return { kind: 'untouched' };
    }
    const owner = oldWalks.find(w => w.indexByMillis.has(ms));
    if (!owner) {
      return { kind: 'untouched' };
    }
    const successor = newSide.schedules.find(s => s.id === owner.schedule.id);
    if (!successor?.startDate) {
      return { kind: 'remove' };
    }
    if (owner.schedule.frequency === null) {
      return { kind: 'move', target: successor.startDate };
    }
    if (!passesShiftGate(owner.schedule, successor, oldSide, newSide)) {
      return { kind: 'remove' };
    }
    return { kind: 'shift', successor, position: owner.indexByMillis.get(ms)! };
  };

  const classified = rows.map(row => ({ row, result: classify(row) }));

  // Walk each shifted schedule once, as far as its furthest position.
  const furthest = new Map<CalendarEventSchedule, number>();
  for (const { result } of classified) {
    if (result.kind === 'shift') {
      furthest.set(result.successor, Math.max(furthest.get(result.successor) ?? 0, result.position));
    }
  }
  const shifted = new Map<CalendarEventSchedule, Date[]>();
  for (const [schedule, position] of furthest) {
    shifted.set(schedule, expandScheduleOccurrences(schedule, newSide.base, null, position + 1));
  }

  // Phase 1: settle every row. Kept and untouched rows claim their instants.
  const claims = new Map<number, CalendarEventSchedule>();
  const moversByTarget = new Map<number, { target: DateTime; rows: CalendarEventSchedule[] }>();
  const remove: string[] = [];
  for (const { row, result: classification } of classified) {
    let result = classification;
    if (result.kind === 'shift') {
      const target = shifted.get(result.successor)![result.position];
      result = target
        ? { kind: 'move', target: DateTime.fromJSDate(target, { zone: 'utc' }) }
        : { kind: 'remove' };
    }
    if (result.kind === 'remove') {
      remove.push(row.id);
    }
    else if (result.kind === 'move') {
      const key = result.target.toMillis();
      const group = moversByTarget.get(key) ?? { target: result.target, rows: [] };
      group.rows.push(row);
      moversByTarget.set(key, group);
    }
    else if (!claims.has(row.startDate!.toMillis())) {
      claims.set(row.startDate!.toMillis(), row);
    }
  }

  // Phase 2: resolve movers against the claims and against each other.
  const move: CancellationMove[] = [];
  for (const [key, group] of moversByTarget) {
    const anyHidden = group.rows.some(r => r.hideFromPublic);
    const claimant = claims.get(key);
    if (claimant) {
      remove.push(...group.rows.map(r => r.id));
      if (anyHidden && !claimant.hideFromPublic) {
        move.push({ id: claimant.id, start: claimant.startDate!, hidden: true });
      }
      continue;
    }
    const [survivor, ...losers] = [...group.rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    remove.push(...losers.map(r => r.id));
    move.push({ id: survivor.id, start: group.target, hidden: anyHidden });
  }

  return { move, remove };
}
