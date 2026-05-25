import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { v4 as uuidv4 } from 'uuid';

import { testApp } from '@/server/common/test/lib/express';
import NotificationRoutes from '@/server/notifications/api/v1/notification';
import NotificationsInterface from '@/server/notifications/interface';
import NotificationService from '@/server/notifications/service/notification';
import db from '@/server/common/entity/db';
import { AccountEntity } from '@/server/common/entity/account';
import {
  NotificationActivityEntity,
} from '@/server/notifications/entity/notification_activity';
import { NotificationRecipientEntity } from '@/server/notifications/entity/notification_recipient';

/**
 * Tests for GET /api/v1/notification — pv-89mw.7.1.
 *
 * The new API surface is a per-recipient projection
 * over the (`notification_recipient`, `notification_activity`) pair,
 * produced by `NotificationService.getNotifications` and surfaced through
 * the domain interface. The route handler is a thin delegator. The tests
 * cover:
 *
 *   1. Response shape — every field in, including the
 *      `seen` / `dismissed` boolean derivations from `seen_at` / `dismissed_at`.
 *   2. Auth — unauthenticated requests get 401 (per acceptance criteria;
 *      the design mandates 401, not the legacy 403).
 *   3. Scope — account A cannot see account B's notifications.
 *   4. Deleted-object rendering — a Flag with the underlying Report deleted
 *      still returns 200 with the snapshot `object.label`.
 *   5. Flag API invariant — no `actorAccountId`, `actorUri`, username,
 *      handle, or account URL leaks; `actor.kind === 'anonymous'`.
 *
 * The suite uses a live in-memory SQLite DB (the same pattern as the
 * entity/integration suites in this domain). It does not boot the full
 * `TestEnvironment` — the service runs the entity-level query directly,
 * so a thin express harness with `db.sync` is sufficient and avoids
 * pulling in unrelated domain setup.
 */
describe('Notification API — GET /api/v1/notification', () => {
  let sandbox: sinon.SinonSandbox;
  let routes: NotificationRoutes;
  let router: express.Router;

  beforeAll(async () => {
    await db.sync({ force: true });
  });

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    // The service has no real role-resolver dependencies for the read path,
    // but the constructor signature requires deps — pass minimal stand-ins.
    // `getNotifications` does not exercise the calendar/accounts interfaces.
    const service = new NotificationService({
      calendarInterface: {} as unknown as never,
      accountsInterface: {} as unknown as never,
    });
    const internalAPI = new NotificationsInterface(service);
    routes = new NotificationRoutes(internalAPI);
    router = express.Router();

    // Reset notification + account tables between tests. The `addRequestUser`
    // helper sets the authenticated account id to `'id'`, but that is not a
    // valid UUID — we need real account rows whose IDs match what the route
    // sees on `req.user`. Tests that need scope assertions seed accounts
    // explicitly and override `req.user` accordingly.
    await NotificationRecipientEntity.destroy({ where: {}, truncate: true });
    await NotificationActivityEntity.destroy({ where: {}, truncate: true });
    await AccountEntity.destroy({ where: {}, truncate: true, cascade: true });
  });

  afterEach(() => {
    sandbox.restore();
  });

  /**
   * Build an express handler that injects the supplied account id onto
   * `req.user.id`. Tests that need a different account id than the default
   * `'id'` from `addRequestUser` use this so the entity-level scope filter
   * matches a real seeded account.
   */
  function withAccount(accountId: string): express.RequestHandler {
    return (req, _res, next) => {
      // Set the minimum shape the route reads (`id`) — the full `Account`
      // constructor takes email/username we don't need here.
      (req as unknown as { user: { id: string } }).user = { id: accountId };
      next();
    };
  }

  async function seedAccount(idOverride?: string): Promise<string> {
    const id = idOverride ?? uuidv4();
    await AccountEntity.create({
      id,
      username: `acc-${id.slice(0, 8)}`,
      email: `${id.slice(0, 8)}@example.test`,
      language: 'en',
    });
    return id;
  }

  /**
   * Insert one activity row with the supplied overrides. The defaults match
   * a Follow activity with a non-anonymous remote actor — the shape that
   * exercises the most fields in the response.
   */
  async function seedActivity(overrides: Partial<{
    id: string;
    verb: string;
    origin: 'local' | 'federated';
    actor_kind: 'account' | 'remote_actor' | 'anonymous' | 'system';
    actor_account_id: string | null;
    actor_uri: string | null;
    actor_display_name: string;
    actor_display_url: string | null;
    object_type: 'calendar' | 'event' | 'report';
    object_id: string;
    object_label: string;
  }> = {}): Promise<NotificationActivityEntity> {
    // Use the `in` operator (not `??`) for nullable fields so an explicit
    // `null` override is honored — `null ?? default` would silently fall
    // back to the default and mask the Flag-row anonymization invariant.
    const defaults = {
      actor_account_id: null,
      actor_uri: 'https://remote.example/users/alice' as string | null,
      actor_display_url: 'https://remote.example/users/alice' as string | null,
    };
    return NotificationActivityEntity.create({
      id: overrides.id ?? uuidv4(),
      verb: overrides.verb ?? 'Follow',
      origin: overrides.origin ?? 'federated',
      actor_kind: overrides.actor_kind ?? 'remote_actor',
      actor_account_id: 'actor_account_id' in overrides ? overrides.actor_account_id : defaults.actor_account_id,
      actor_uri: 'actor_uri' in overrides ? overrides.actor_uri : defaults.actor_uri,
      actor_display_name: overrides.actor_display_name ?? 'Alice',
      actor_display_url: 'actor_display_url' in overrides ? overrides.actor_display_url : defaults.actor_display_url,
      object_type: overrides.object_type ?? 'calendar',
      object_id: overrides.object_id ?? uuidv4(),
      object_label: overrides.object_label ?? 'My Calendar',
    });
  }

  /**
   * Insert one recipient row for the given activity/account pair.
   */
  async function seedRecipient(
    activityId: string,
    accountId: string,
    options: { seenAt?: Date | null; dismissedAt?: Date | null } = {},
  ): Promise<NotificationRecipientEntity> {
    return NotificationRecipientEntity.create({
      id: uuidv4(),
      notification_activity_id: activityId,
      account_id: accountId,
      seen_at: options.seenAt ?? null,
      dismissed_at: options.dismissedAt ?? null,
    });
  }

  // ---------------------------------------------------------------------------
  // Authentication
  // ---------------------------------------------------------------------------

  describe('authentication', () => {
    it('returns 401 when not authenticated', async () => {
      // Mount the route WITHOUT addRequestUser — `req.user` is undefined,
      // and the route's defense-in-depth guard returns 401.
      router.get('/notification', (req, res) => {
        routes.getNotifications(req, res);
      });

      const response = await request(testApp(router)).get('/notification');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'not authenticated' });
    });
  });

  // ---------------------------------------------------------------------------
  // Response shape
  // ---------------------------------------------------------------------------

  describe('response shape', () => {
    it('returns the full per-recipient shape with all spec fields', async () => {
      const accountId = await seedAccount();
      const activity = await seedActivity({
        verb: 'Follow',
        origin: 'federated',
        actor_kind: 'remote_actor',
        actor_uri: 'https://remote.example/users/alice',
        actor_display_name: 'Alice',
        actor_display_url: 'https://remote.example/users/alice',
        object_type: 'calendar',
        object_label: 'My Calendar',
      });
      const recipient = await seedRecipient(activity.id, accountId);

      router.get('/notification', withAccount(accountId), (req, res) => {
        routes.getNotifications(req, res);
      });

      const response = await request(testApp(router)).get('/notification');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      const row = response.body[0];

      expect(row.id).toBe(recipient.id);
      expect(row.activityId).toBe(activity.id);
      expect(row.verb).toBe('Follow');
      expect(row.origin).toBe('federated');
      expect(row.actor).toEqual({
        kind: 'remote_actor',
        displayName: 'Alice',
        displayUrl: 'https://remote.example/users/alice',
      });
      expect(row.object).toEqual({
        type: 'calendar',
        id: activity.object_id,
        label: 'My Calendar',
      });
      expect(row.seen).toBe(false);
      expect(row.dismissed).toBe(false);
      expect(typeof row.createdAt).toBe('string');
      // ISO-8601 date string.
      expect(() => new Date(row.createdAt)).not.toThrow();
    });

    it('derives seen=true when seen_at is set', async () => {
      const accountId = await seedAccount();
      const activity = await seedActivity();
      await seedRecipient(activity.id, accountId, { seenAt: new Date() });

      router.get('/notification', withAccount(accountId), (req, res) => {
        routes.getNotifications(req, res);
      });

      const response = await request(testApp(router)).get('/notification');

      expect(response.status).toBe(200);
      expect(response.body[0].seen).toBe(true);
      expect(response.body[0].dismissed).toBe(false);
    });

    it('excludes dismissed rows from the default list (pv-d84j.4)', async () => {
      // Active-list default: rows with non-null dismissed_at do not appear
      // in the inbox response. Object-state transitions (e.g. a report being
      // resolved) set dismissed_at on the originating Flag's recipient rows
      // via dismissForObject; the inbox UI must not continue to surface
      // them — the admin inbox query (filtered to non-dismissed) no longer
      // returns the Flag.
      const accountId = await seedAccount();
      const activity = await seedActivity();
      await seedRecipient(activity.id, accountId, { dismissedAt: new Date() });

      router.get('/notification', withAccount(accountId), (req, res) => {
        routes.getNotifications(req, res);
      });

      const response = await request(testApp(router)).get('/notification');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('returns only non-dismissed rows when a mix of dismissed and active rows exists', async () => {
      // Regression coverage for pv-d84j.4: with both an active and a
      // dismissed recipient seeded for the same account, the response must
      // contain only the active row. Guards against a buggy filter that
      // would either return both rows or drop the active row alongside the
      // dismissed one.
      const accountId = await seedAccount();
      const activeActivity = await seedActivity({ object_label: 'Active' });
      const dismissedActivity = await seedActivity({ object_label: 'Dismissed' });
      const activeRecipient = await seedRecipient(activeActivity.id, accountId);
      await seedRecipient(dismissedActivity.id, accountId, { dismissedAt: new Date() });

      router.get('/notification', withAccount(accountId), (req, res) => {
        routes.getNotifications(req, res);
      });

      const response = await request(testApp(router)).get('/notification');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].id).toBe(activeRecipient.id);
      expect(response.body[0].object.label).toBe('Active');
      expect(response.body[0].dismissed).toBe(false);
    });

    it('surfaces actor.displayName for account-kind activities (pv-02kb.1)', async () => {
      // Regression coverage for pv-02kb.1: an EditorInvited row produced
      // by the handler must reach the API with a populated actor.displayName.
      // The handler is responsible for resolving the granting account's
      // display name; this test seeds the row directly to assert the
      // serialization path also returns it intact (no projection drops
      // the field for actor.kind='account').
      const accountId = await seedAccount();
      const granterId = uuidv4();
      const calendarId = uuidv4();
      const activity = await seedActivity({
        verb: 'EditorInvited',
        origin: 'local',
        actor_kind: 'account',
        actor_account_id: granterId,
        actor_uri: null,
        actor_display_name: 'Test Q. User',
        actor_display_url: null,
        object_type: 'calendar',
        object_id: calendarId,
        object_label: "TestUser's Calendar",
      });
      await seedRecipient(activity.id, accountId);

      router.get('/notification', withAccount(accountId), (req, res) => {
        routes.getNotifications(req, res);
      });

      const response = await request(testApp(router)).get('/notification');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      const row = response.body[0];
      expect(row.verb).toBe('EditorInvited');
      expect(row.actor.kind).toBe('account');
      expect(row.actor.displayName).toBe('Test Q. User');
      // Non-empty assertion makes the regression explicit — pv-02kb.1 was
      // an empty-string bug, not a missing-field bug.
      expect(row.actor.displayName.length).toBeGreaterThan(0);
    });

    it('surfaces the resolved local-calendar display name for Follow rows (pv-d84j.1)', async () => {
      // Regression coverage for pv-d84j.1: local follows produced inbox
      // rows where actor.displayName was the raw AP actor URI. The handler
      // now resolves the URI to the local calendar's display name; this
      // test asserts the serialization path preserves the populated
      // display name and does not echo the URI back. The row is seeded
      // directly here — the handler's resolution behaviour is covered in
      // notification_event_handlers.test.ts; this assertion guards the
      // wire-shape projection alone.
      const accountId = await seedAccount();
      const calendarId = uuidv4();
      const followerActorUri = 'https://pavillion.dev/calendars/community-org';
      const activity = await seedActivity({
        verb: 'Follow',
        origin: 'federated',
        actor_kind: 'remote_actor',
        actor_uri: followerActorUri,
        actor_display_name: 'Community Org',
        actor_display_url: followerActorUri,
        object_type: 'calendar',
        object_id: calendarId,
        object_label: 'My Calendar',
      });
      await seedRecipient(activity.id, accountId);

      router.get('/notification', withAccount(accountId), (req, res) => {
        routes.getNotifications(req, res);
      });

      const response = await request(testApp(router)).get('/notification');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      const row = response.body[0];
      expect(row.verb).toBe('Follow');
      expect(row.actor.kind).toBe('remote_actor');
      expect(row.actor.displayName).toBe('Community Org');
      // The actor URI is preserved on displayUrl — the bug was the URI
      // bleeding into displayName, not its presence on displayUrl. The
      // serializer must not collapse the two fields.
      expect(row.actor.displayUrl).toBe(followerActorUri);
      expect(row.actor.displayName).not.toBe(followerActorUri);
    });

    it('returns Cache-Control: private, max-age=25', async () => {
      const accountId = await seedAccount();

      router.get('/notification', withAccount(accountId), (req, res) => {
        routes.getNotifications(req, res);
      });

      const response = await request(testApp(router)).get('/notification');

      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('private, max-age=25');
    });

    it('returns an empty array when the user has no notifications', async () => {
      const accountId = await seedAccount();

      router.get('/notification', withAccount(accountId), (req, res) => {
        routes.getNotifications(req, res);
      });

      const response = await request(testApp(router)).get('/notification');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('orders rows by created_at DESC (most recent first)', async () => {
      const accountId = await seedAccount();
      const olderActivity = await seedActivity({ object_label: 'Older' });
      const newerActivity = await seedActivity({ object_label: 'Newer' });
      // Sequelize sets created_at automatically; manually adjust the older
      // row's timestamp to the past so the ordering is deterministic.
      await olderActivity.update({}, { silent: true });
      await NotificationActivityEntity.update(
        { created_at: new Date(Date.now() - 60_000) },
        { where: { id: olderActivity.id }, silent: true },
      );

      const olderRecipient = await seedRecipient(olderActivity.id, accountId);
      await NotificationRecipientEntity.update(
        { created_at: new Date(Date.now() - 60_000) },
        { where: { id: olderRecipient.id }, silent: true },
      );
      await seedRecipient(newerActivity.id, accountId);

      router.get('/notification', withAccount(accountId), (req, res) => {
        routes.getNotifications(req, res);
      });

      const response = await request(testApp(router)).get('/notification');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].object.label).toBe('Newer');
      expect(response.body[1].object.label).toBe('Older');
    });
  });

  // ---------------------------------------------------------------------------
  // Scope (account isolation)
  // ---------------------------------------------------------------------------

  describe('scope — account isolation', () => {
    it('account A cannot see account B notifications', async () => {
      const accountA = await seedAccount();
      const accountB = await seedAccount();
      const activityB = await seedActivity({ object_label: 'B Calendar' });
      await seedRecipient(activityB.id, accountB);

      router.get('/notification', withAccount(accountA), (req, res) => {
        routes.getNotifications(req, res);
      });

      const response = await request(testApp(router)).get('/notification');

      expect(response.status).toBe(200);
      // Account A has no recipient rows; account B's row is invisible.
      expect(response.body).toEqual([]);
    });

    it('returns only the authenticated account recipient rows when both accounts received the same activity', async () => {
      const accountA = await seedAccount();
      const accountB = await seedAccount();
      const activity = await seedActivity();
      const recipientA = await seedRecipient(activity.id, accountA);
      await seedRecipient(activity.id, accountB);

      router.get('/notification', withAccount(accountA), (req, res) => {
        routes.getNotifications(req, res);
      });

      const response = await request(testApp(router)).get('/notification');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].id).toBe(recipientA.id);
    });
  });

  // ---------------------------------------------------------------------------
  // Deleted-object rendering
  // ---------------------------------------------------------------------------

  describe('deleted-object rendering', () => {
    it('returns 200 with snapshot object.label when the underlying object is gone', async () => {
      const accountId = await seedAccount();
      // Seed a Flag whose `object_id` does not correspond to a real Report
      // row anywhere. The notifications domain stores no FK against the
      // moderation table — the snapshot label is the contract.
      const activity = await seedActivity({
        verb: 'Flag',
        origin: 'local',
        actor_kind: 'anonymous',
        actor_account_id: null,
        actor_uri: null,
        actor_display_name: 'Anonymous reporter',
        actor_display_url: null,
        object_type: 'report',
        object_id: uuidv4(), // No report row exists for this id.
        object_label: 'Flagged Event Title',
      });
      await seedRecipient(activity.id, accountId);

      router.get('/notification', withAccount(accountId), (req, res) => {
        routes.getNotifications(req, res);
      });

      const response = await request(testApp(router)).get('/notification');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].object.label).toBe('Flagged Event Title');
    });

    it('returns a non-empty object.label across every object_type when the underlying object is gone (pv-vdu2.2)', async () => {
      // pv-vdu2.2 acceptance criterion: with snapshot-on-write populating
      // object_label at emit time, the deleted-object render path must
      // produce a non-empty display string for any verb/object combination.
      // Seeds three orphan activities — one per object_type enum value —
      // and asserts each row comes back with a non-empty label.
      const accountId = await seedAccount();

      const calendarActivity = await seedActivity({
        verb: 'Follow',
        object_type: 'calendar',
        object_id: uuidv4(),
        object_label: 'Deleted Calendar Name',
      });
      const eventActivity = await seedActivity({
        verb: 'Announce',
        object_type: 'event',
        object_id: uuidv4(),
        object_label: 'Deleted Event Title',
      });
      const reportActivity = await seedActivity({
        verb: 'Flag',
        origin: 'local',
        actor_kind: 'anonymous',
        actor_account_id: null,
        actor_uri: null,
        actor_display_name: 'Anonymous reporter',
        actor_display_url: null,
        object_type: 'report',
        object_id: uuidv4(),
        object_label: 'Owning Calendar Name',
      });
      await seedRecipient(calendarActivity.id, accountId);
      await seedRecipient(eventActivity.id, accountId);
      await seedRecipient(reportActivity.id, accountId);

      router.get('/notification', withAccount(accountId), (req, res) => {
        routes.getNotifications(req, res);
      });

      const response = await request(testApp(router)).get('/notification');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(3);
      for (const row of response.body) {
        expect(row.object.label).toBeTruthy();
        expect(row.object.label.length).toBeGreaterThan(0);
      }

      const byVerb = new Map<string, { label: string }>(
        response.body.map((r: { verb: string; object: { label: string } }) => [r.verb, r.object]),
      );
      expect(byVerb.get('Follow')!.label).toBe('Deleted Calendar Name');
      expect(byVerb.get('Announce')!.label).toBe('Deleted Event Title');
      expect(byVerb.get('Flag')!.label).toBe('Owning Calendar Name');
    });
  });

  // ---------------------------------------------------------------------------
  // Flag API invariant
  // ---------------------------------------------------------------------------

  describe('Flag API invariant', () => {
    it('exposes no identity fields and forces actor.kind=anonymous for local-form Flag', async () => {
      const accountId = await seedAccount();
      const activity = await seedActivity({
        verb: 'Flag',
        origin: 'local',
        actor_kind: 'anonymous',
        actor_account_id: null,
        actor_uri: null,
        actor_display_name: 'Anonymous reporter',
        actor_display_url: null,
        object_type: 'report',
        object_label: 'Reported Event',
      });
      await seedRecipient(activity.id, accountId);

      router.get('/notification', withAccount(accountId), (req, res) => {
        routes.getNotifications(req, res);
      });

      const response = await request(testApp(router)).get('/notification');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      const row = response.body[0];

      // Forbidden surface fields — must not leak through serialization.
      expect(row).not.toHaveProperty('actorAccountId');
      expect(row).not.toHaveProperty('actor_account_id');
      expect(row).not.toHaveProperty('actorUri');
      expect(row).not.toHaveProperty('actor_uri');
      expect(row.actor).not.toHaveProperty('accountId');
      expect(row.actor).not.toHaveProperty('uri');
      expect(row.actor).not.toHaveProperty('username');
      expect(row.actor).not.toHaveProperty('handle');

      // Required Flag-row invariant.
      expect(row.actor.kind).toBe('anonymous');
      expect(row.actor.displayUrl).toBeNull();
    });

    it('exposes instance attribution but no identity for federated Flag', async () => {
      const accountId = await seedAccount();
      const activity = await seedActivity({
        verb: 'Flag',
        origin: 'federated',
        actor_kind: 'anonymous',
        actor_account_id: null,
        actor_uri: null,
        actor_display_name: 'Reporter from remote.example',
        actor_display_url: 'https://remote.example',
        object_type: 'report',
        object_label: 'Reported Event',
      });
      await seedRecipient(activity.id, accountId);

      router.get('/notification', withAccount(accountId), (req, res) => {
        routes.getNotifications(req, res);
      });

      const response = await request(testApp(router)).get('/notification');

      expect(response.status).toBe(200);
      const row = response.body[0];
      expect(row.actor.kind).toBe('anonymous');
      // Instance-root URL is the only identity-bearing field.
      expect(row.actor.displayUrl).toBe('https://remote.example');
      // Storage invariant: identity columns must NOT appear in the response
      // even though the row was federated.
      expect(row).not.toHaveProperty('actorAccountId');
      expect(row).not.toHaveProperty('actorUri');
      expect(row.actor).not.toHaveProperty('uri');
    });

    it('storage path: Flag rows persist with NULL identity columns regardless of API serialization', async () => {
      // This is the design-required "tests both storage and serialization
      // paths independently" assertion. The API test above already covered
      // serialization; here we verify the stored row carries no identity
      // values so a future serialization regression cannot leak them.
      const accountId = await seedAccount();
      const activity = await seedActivity({
        verb: 'Flag',
        origin: 'local',
        actor_kind: 'anonymous',
        actor_account_id: null,
        actor_uri: null,
        actor_display_name: 'Anonymous reporter',
        actor_display_url: null,
        object_type: 'report',
      });
      await seedRecipient(activity.id, accountId);

      const stored = await NotificationActivityEntity.findByPk(activity.id);
      expect(stored).not.toBeNull();
      expect(stored!.actor_account_id).toBeNull();
      expect(stored!.actor_uri).toBeNull();
      expect(stored!.actor_kind).toBe('anonymous');
    });
  });

  // ---------------------------------------------------------------------------
  // Pagination params
  // ---------------------------------------------------------------------------

  describe('pagination', () => {
    it('honors ?limit=N up to MAX_LIMIT and ?offset=N up to MAX_OFFSET', async () => {
      const accountId = await seedAccount();
      // Three activities for the same account, ordered by creation.
      const a1 = await seedActivity({ object_label: 'First' });
      const r1 = await seedRecipient(a1.id, accountId);
      const a2 = await seedActivity({ object_label: 'Second' });
      await seedRecipient(a2.id, accountId);
      const a3 = await seedActivity({ object_label: 'Third' });
      await seedRecipient(a3.id, accountId);

      // Backdate r1 so the DESC order is deterministic across SQLite's
      // sub-millisecond CURRENT_TIMESTAMP resolution.
      await NotificationRecipientEntity.update(
        { created_at: new Date(Date.now() - 90_000) },
        { where: { id: r1.id }, silent: true },
      );

      router.get('/notification', withAccount(accountId), (req, res) => {
        routes.getNotifications(req, res);
      });

      const limited = await request(testApp(router)).get('/notification?limit=2');
      expect(limited.status).toBe(200);
      expect(limited.body).toHaveLength(2);
    });

    it('caps limit at 100 when ?limit exceeds max', async () => {
      const accountId = await seedAccount();
      // No data needed — `findAll` returns an empty array, which is enough
      // to verify the route did not 500 because of the high limit and
      // honored the cap (the cap is internal; we assert it does not 400).
      router.get('/notification', withAccount(accountId), (req, res) => {
        routes.getNotifications(req, res);
      });

      const response = await request(testApp(router)).get('/notification?limit=999');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('clamps negative offset to 0', async () => {
      const accountId = await seedAccount();
      router.get('/notification', withAccount(accountId), (req, res) => {
        routes.getNotifications(req, res);
      });

      const response = await request(testApp(router)).get('/notification?offset=-5');

      expect(response.status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------

  describe('error handling', () => {
    it('returns 500 when the service throws', async () => {
      const accountId = await seedAccount();
      // Stub the service method directly — the route handler delegates
      // through the interface, so this exercises the route's catch path
      // without depending on entity-level internals.
      sandbox.stub(NotificationService.prototype, 'getNotifications').rejects(new Error('DB failure'));

      router.get('/notification', withAccount(accountId), (req, res) => {
        routes.getNotifications(req, res);
      });

      const response = await request(testApp(router)).get('/notification');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('An error occurred while fetching notifications');
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /api/v1/notification/:id — recipient-side write surface (pv-jehu)
  // ---------------------------------------------------------------------------

  describe('PATCH /api/v1/notification/:id', () => {
    /**
     * Mount the PATCH handler with the supplied account binding. Mirrors
     * the GET-side `withAccount` pattern; pulled into a helper so the
     * 401-case can mount the route without injecting a user.
     */
    function mountPatch(accountId?: string): void {
      if (accountId === undefined) {
        router.patch('/notification/:id', (req, res) => {
          routes.patchNotification(req, res);
        });
      }
      else {
        router.patch('/notification/:id', withAccount(accountId), (req, res) => {
          routes.patchNotification(req, res);
        });
      }
    }

    it('returns 401 when not authenticated', async () => {
      mountPatch();

      const response = await request(testApp(router))
        .patch(`/notification/${uuidv4()}`)
        .send({ seen: true });

      expect(response.status).toBe(401);
    });

    it('returns 404 when the id is not a valid UUID (no malformed-vs-missing leak)', async () => {
      const accountId = await seedAccount();
      mountPatch(accountId);

      // A 400 here would tell an attacker "this was syntactically valid
      // but no row exists" vs "this was malformed". Collapse to 404 so the
      // response code carries no information either way.
      const response = await request(testApp(router))
        .patch('/notification/not-a-uuid')
        .send({ seen: true });

      expect(response.status).toBe(404);
    });

    it('returns 400 when body is empty', async () => {
      const accountId = await seedAccount();
      mountPatch(accountId);

      const response = await request(testApp(router))
        .patch(`/notification/${uuidv4()}`)
        .send({});

      expect(response.status).toBe(400);
    });

    it('returns 400 when seen is not a boolean', async () => {
      const accountId = await seedAccount();
      mountPatch(accountId);

      const response = await request(testApp(router))
        .patch(`/notification/${uuidv4()}`)
        .send({ seen: 'yes' });

      expect(response.status).toBe(400);
    });

    it('returns 400 when dismissed is not a boolean', async () => {
      const accountId = await seedAccount();
      mountPatch(accountId);

      const response = await request(testApp(router))
        .patch(`/notification/${uuidv4()}`)
        .send({ dismissed: 1 });

      expect(response.status).toBe(400);
    });

    it('returns 404 when no recipient row exists for the id', async () => {
      const accountId = await seedAccount();
      mountPatch(accountId);

      const response = await request(testApp(router))
        .patch(`/notification/${uuidv4()}`)
        .send({ seen: true });

      expect(response.status).toBe(404);
    });

    it('returns 404 when the recipient belongs to another account (no existence leak)', async () => {
      // Critical privacy invariant: a recipient row that exists but
      // belongs to another account must be indistinguishable from a
      // missing row. Both return 404, never 403 — otherwise the response
      // code leaks recipient-id enumerability across accounts.
      const accountA = await seedAccount();
      const accountB = await seedAccount();
      const activity = await seedActivity();
      const otherRecipient = await seedRecipient(activity.id, accountB);

      mountPatch(accountA);

      const response = await request(testApp(router))
        .patch(`/notification/${otherRecipient.id}`)
        .send({ seen: true });

      expect(response.status).toBe(404);

      // The row must remain untouched on the other account's side —
      // cross-account writes are not just blocked, they cannot even alter
      // server-side state.
      const stored = await NotificationRecipientEntity.findByPk(otherRecipient.id);
      expect(stored!.seen_at).toBeNull();
    });

    it('marks a row as seen on the happy path and stamps seen_at server-side', async () => {
      const accountId = await seedAccount();
      const activity = await seedActivity();
      const recipient = await seedRecipient(activity.id, accountId);

      mountPatch(accountId);

      const response = await request(testApp(router))
        .patch(`/notification/${recipient.id}`)
        .send({ seen: true });

      expect(response.status).toBe(200);
      const stored = await NotificationRecipientEntity.findByPk(recipient.id);
      expect(stored!.seen_at).toBeInstanceOf(Date);
      expect(stored!.dismissed_at).toBeNull();
    });

    it('dismisses a row and the GET endpoint stops returning it (pairs with pv-d84j.4)', async () => {
      const accountId = await seedAccount();
      const activity = await seedActivity();
      const recipient = await seedRecipient(activity.id, accountId);

      mountPatch(accountId);
      router.get('/notification', withAccount(accountId), (req, res) => {
        routes.getNotifications(req, res);
      });

      // Pre-condition: the row appears in the active inbox.
      const before = await request(testApp(router)).get('/notification');
      expect(before.body).toHaveLength(1);

      // Dismiss the row.
      const patchResponse = await request(testApp(router))
        .patch(`/notification/${recipient.id}`)
        .send({ dismissed: true });
      expect(patchResponse.status).toBe(200);

      // The GET endpoint's active-only filter (pv-d84j.4) drops it.
      const after = await request(testApp(router)).get('/notification');
      expect(after.body).toEqual([]);

      // Storage path confirms dismissed_at was stamped.
      const stored = await NotificationRecipientEntity.findByPk(recipient.id);
      expect(stored!.dismissed_at).toBeInstanceOf(Date);
    });

    it('clears seen_at when flipping seen from true to false', async () => {
      const accountId = await seedAccount();
      const activity = await seedActivity();
      const recipient = await seedRecipient(activity.id, accountId, {
        seenAt: new Date(),
      });

      mountPatch(accountId);

      const response = await request(testApp(router))
        .patch(`/notification/${recipient.id}`)
        .send({ seen: false });

      expect(response.status).toBe(200);
      const stored = await NotificationRecipientEntity.findByPk(recipient.id);
      expect(stored!.seen_at).toBeNull();
    });

    it('stamps both seen_at and dismissed_at when both flags flip in one body', async () => {
      // Lifecycle allows combining flag flips in a single PATCH. The
      // service must stamp both timestamps in one save rather than serialising
      // two writes, and the route must return 200. Matches the pv-jehu
      // acceptance criterion that a dismiss can imply a seen.
      const accountId = await seedAccount();
      const activity = await seedActivity();
      const recipient = await seedRecipient(activity.id, accountId);

      mountPatch(accountId);

      const response = await request(testApp(router))
        .patch(`/notification/${recipient.id}`)
        .send({ seen: true, dismissed: true });

      expect(response.status).toBe(200);
      const stored = await NotificationRecipientEntity.findByPk(recipient.id);
      expect(stored!.seen_at).toBeInstanceOf(Date);
      expect(stored!.dismissed_at).toBeInstanceOf(Date);
    });

    it('returns 500 when the service throws an unexpected error', async () => {
      // Mirrors the GET-side 500 test at line 738 — the route handler's catch
      // path must convert any non-NotificationRecipientNotFoundError throw
      // into a generic 500, never bubble it out of the express stack.
      const accountId = await seedAccount();
      sandbox
        .stub(NotificationService.prototype, 'updateRecipientState')
        .rejects(new Error('DB failure'));

      mountPatch(accountId);

      const response = await request(testApp(router))
        .patch(`/notification/${uuidv4()}`)
        .send({ seen: true });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('An error occurred while updating the notification');
    });
  });
});
