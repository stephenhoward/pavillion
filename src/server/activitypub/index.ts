import { Application } from 'express';
import config from 'config';
import ActivityPubInterface from '@/server/activitypub/interface';
import ActivityPubEventHandlers from '@/server/activitypub/events';
import ActivityPubAPI from '@/server/activitypub/api/v1';
import { EventEmitter } from 'stream';
import CalendarInterface from '../calendar/interface';
import AccountsInterface from '../accounts/interface';
import ModerationInterface from '../moderation/interface';
import HousekeepingInterface from '../housekeeping/interface';
import type { ProcessInboxMessagesOptions } from '@/server/activitypub/service/inbox';
import type { ProcessOutboxMessagesOptions } from '@/server/activitypub/service/outbox';
import { logError } from '@/server/common/helper/error-logger';

/**
 * Interval ticks leave rows written this recently to the live
 * `inboxMessageAdded` handler, which dispatches without a claim; on
 * PostgreSQL a tick taking the same fresh row would dispatch it twice.
 */
export const INBOX_DRAIN_SKIP_NEWER_THAN_MS = 10_000;

/**
 * Interval ticks leave outbox rows written this recently to the live
 * `outboxMessageAdded` handler, which delivers without a claim; on PostgreSQL
 * a tick taking a row still in live delivery would deliver it twice. Fifteen
 * minutes, not the inbox's ten seconds: each recipient can cost two HTTP
 * timeouts (actor fetch, then POST), so one fan-out with a dead peer routinely
 * runs past ten seconds. Every outbox row has a live handler, so no row waits
 * on a tick to be delivered; only rows a restart stranded do, and the boot
 * drain takes those regardless of age.
 */
export const OUTBOX_DRAIN_SKIP_NEWER_THAN_MS = 900_000;

/**
 * ActivityPub domain entry point
 * Manages social federation protocols and ActivityPub message handling
 */
export default class ActivityPubDomain {
  public readonly interface: ActivityPubInterface;
  private readonly calendarInterface: CalendarInterface;
  private readonly accountsInterface: AccountsInterface;
  private readonly moderationInterface?: ModerationInterface;
  private readonly housekeepingInterface: HousekeepingInterface;
  private readonly eventBus: EventEmitter;
  private eventHandlers: ActivityPubEventHandlers | null = null;
  /** The drain in flight, if any; a tick that finds one does nothing. */
  private inboxDrain: Promise<void> | null = null;
  /** The outbox drain in flight, if any; a tick that finds one does nothing. */
  private outboxDrain: Promise<void> | null = null;

  constructor(
    eventBus: EventEmitter,
    calendarInterface: CalendarInterface,
    accountsInterface: AccountsInterface,
    housekeepingInterface: HousekeepingInterface,
    moderationInterface?: ModerationInterface,
  ) {
    this.eventBus = eventBus;
    this.calendarInterface = calendarInterface;
    this.accountsInterface = accountsInterface;
    this.moderationInterface = moderationInterface;
    this.housekeepingInterface = housekeepingInterface;
    this.interface = new ActivityPubInterface(eventBus, calendarInterface, accountsInterface, moderationInterface);
  }

  public initialize(app: Application): void {
    this.installAPI(app);
    this.installEventHandlers();
  }

  public installAPI(app: Application) {
    ActivityPubAPI.install(app, this.interface, this.calendarInterface);
  }

  public installEventHandlers() {
    this.eventHandlers = new ActivityPubEventHandlers(this.interface, this.calendarInterface, this.housekeepingInterface);
    this.eventHandlers.install(this.eventBus);
  }

  /**
   * Start draining unprocessed inbox rows in this process: once now, taking
   * every row, then every `activitypub.inboxDrain.intervalMs`, leaving rows
   * written within {@link INBOX_DRAIN_SKIP_NEWER_THAN_MS} to live dispatch.
   * This is what dispatches rows the worker's backfill writes, and rows a
   * restart left behind. The interval is a latency choice; the skip window
   * is the correctness choice and does not move with it.
   *
   * Called by the web process once every domain has installed its handlers,
   * never from {@link initialize}, so test suites that initialize the domain
   * get no running timer. Refuses to start without a moderation interface,
   * since the drain would then dispatch rows past no blocked-instance gate.
   *
   * @returns A function that stops the interval
   */
  public startInboxDrain(): () => void {
    if (!this.eventHandlers) {
      throw new Error('ActivityPubDomain.startInboxDrain called before installEventHandlers');
    }
    if (!this.moderationInterface) {
      throw new Error('ActivityPubDomain.startInboxDrain called without a moderation interface');
    }
    const eventHandlers = this.eventHandlers;

    const drain = (options: ProcessInboxMessagesOptions): void => {
      if (this.inboxDrain) {
        return;
      }
      this.inboxDrain = eventHandlers
        .runSerialized(() => this.interface.processInboxMessages(options))
        .catch((error) => logError(error, '[ActivityPub] Inbox drain failed'))
        .finally(() => { this.inboxDrain = null; });
    };

    const intervalMs = config.get<number>('activitypub.inboxDrain.intervalMs');
    drain({});
    const interval = setInterval(
      () => drain({ skipNewerThanMs: INBOX_DRAIN_SKIP_NEWER_THAN_MS }),
      intervalMs,
    );
    return () => clearInterval(interval);
  }

  /**
   * Start draining unprocessed outbox rows in this process: once now, taking
   * every row, then every `activitypub.outboxDrain.intervalMs`, leaving rows
   * written within {@link OUTBOX_DRAIN_SKIP_NEWER_THAN_MS} to live delivery.
   * This is what delivers rows whose `outboxMessageAdded` emit went to a
   * process that stopped before handling it. Delivery is at-least-once: a row
   * a restart cut off mid-fan-out is delivered again from the start.
   *
   * Called by the web process once every domain has installed its handlers,
   * never from {@link initialize} and never from the worker: delivering a row
   * runs local dispatch, which needs the full handler set. Unlike the inbox
   * drain it needs no moderation interface, since outbound delivery has no
   * blocked-instance gate on the live path either.
   *
   * @returns A function that stops the interval; a drain in flight finishes
   */
  public startOutboxDrain(): () => void {
    if (!this.eventHandlers) {
      throw new Error('ActivityPubDomain.startOutboxDrain called before installEventHandlers');
    }
    const eventHandlers = this.eventHandlers;

    const drain = (options: ProcessOutboxMessagesOptions): void => {
      if (this.outboxDrain) {
        return;
      }
      this.outboxDrain = eventHandlers
        .runSerialized(() => this.interface.processOutboxMessages(options))
        .catch((error) => logError(error, '[ActivityPub] Outbox drain failed'))
        .finally(() => { this.outboxDrain = null; });
    };

    const intervalMs = config.get<number>('activitypub.outboxDrain.intervalMs');
    drain({});
    const interval = setInterval(
      () => drain({ skipNewerThanMs: OUTBOX_DRAIN_SKIP_NEWER_THAN_MS }),
      intervalMs,
    );
    return () => clearInterval(interval);
  }

}
