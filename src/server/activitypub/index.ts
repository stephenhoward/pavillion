import { Application } from 'express';
import ActivityPubInterface from '@/server/activitypub/interface';
import ActivityPubEventHandlers from '@/server/activitypub/events';
import ActivityPubAPI from '@/server/activitypub/api/v1';
import { EventEmitter } from 'stream';
import CalendarInterface from '../calendar/interface';
import AccountsInterface from '../accounts/interface';
import ModerationInterface from '../moderation/interface';
import HousekeepingInterface from '../housekeeping/interface';
import type { ProcessInboxMessagesOptions } from '@/server/activitypub/service/inbox';
import { logError } from '@/server/common/helper/error-logger';

/** How often the web process drains unprocessed inbox rows. */
export const INBOX_DRAIN_INTERVAL_MS = 5_000;

/**
 * Interval ticks leave rows written this recently to the live
 * `inboxMessageAdded` handler, which dispatches without a claim; on
 * PostgreSQL a tick taking the same fresh row would dispatch it twice.
 */
export const INBOX_DRAIN_SKIP_NEWER_THAN_MS = 10_000;

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
   * every row, then every {@link INBOX_DRAIN_INTERVAL_MS}, leaving rows
   * written within {@link INBOX_DRAIN_SKIP_NEWER_THAN_MS} to live dispatch.
   * This is what dispatches rows the worker's backfill writes, and rows a
   * restart left behind.
   *
   * Called by the web process once every domain has installed its handlers,
   * never from {@link initialize}, so test suites that initialize the domain
   * get no running timer.
   *
   * @returns A function that stops the interval
   */
  public startInboxDrain(): () => void {
    if (!this.eventHandlers) {
      throw new Error('ActivityPubDomain.startInboxDrain called before installEventHandlers');
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

    drain({});
    const interval = setInterval(
      () => drain({ skipNewerThanMs: INBOX_DRAIN_SKIP_NEWER_THAN_MS }),
      INBOX_DRAIN_INTERVAL_MS,
    );
    return () => clearInterval(interval);
  }

}
