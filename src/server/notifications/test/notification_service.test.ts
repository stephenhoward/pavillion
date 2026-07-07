import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { Op, Transaction, UniqueConstraintError } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';

import db from '@/server/common/entity/db';
import { AccountEntity } from '@/server/common/entity/account';
import {
  NotificationActivityEntity,
  NotificationRecipientEntity,
} from '@/server/notifications/entity/notification_activity';
import NotificationService from '@/server/notifications/service/notification';
import { NotificationRecipientNotFoundError } from '@/common/exceptions/notifications';
import type CalendarInterface from '@/server/calendar/interface';
import type AccountsInterface from '@/server/accounts/interface';

/**
 * Unit tests for the recordActivity surface (pv-89mw.3.4).
 *
 * These tests stub the entity layer and the role resolver to assert the
 * service's branching logic (dedup keys, anonymization, audience
 * validation) without touching the DB. The full-stack invariants (single
 * transaction, concurrent dedup, empty audience, Flag anonymization
 * end-to-end) live in the integration suite under
 * `src/server/notifications/test/integration/`.
 */
describe('NotificationService.recordActivity', () => {
  let sandbox: sinon.SinonSandbox;
  let service: NotificationService;
  let calendarInterfaceStub: CalendarInterface;
  let accountsInterfaceStub: AccountsInterface;
  let resolveRoleAudienceStub: sinon.SinonStub;
  // Activity entity stubs.
  let findOneStub: sinon.SinonStub;
  let activityCreateStub: sinon.SinonStub;
  let recipientBulkCreateStub: sinon.SinonStub;
  let accountFindAllStub: sinon.SinonStub;
  let transactionStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // Cross-domain interface stubs — recordActivity only uses them via the
    // role resolver helper, which we stub directly below.
    calendarInterfaceStub = {} as CalendarInterface;
    accountsInterfaceStub = {} as AccountsInterface;

    // Role resolver stub — injected directly into the service rather than
    // patched on the module (ESM live bindings can't be monkey-patched
    // through sinon; the constructor option is the documented seam).
    resolveRoleAudienceStub = sandbox.stub();

    // Entity-layer stubs.
    findOneStub = sandbox.stub(NotificationActivityEntity, 'findOne');
    activityCreateStub = sandbox.stub(NotificationActivityEntity, 'create');
    recipientBulkCreateStub = sandbox.stub(NotificationRecipientEntity, 'bulkCreate');
    accountFindAllStub = sandbox.stub(AccountEntity, 'findAll');

    // Transaction stub: invoke the callback with a sentinel transaction object
    // so the service's `{ transaction }` options end up populated. The service
    // now calls `db.transaction({ isolationLevel: ... }, fn)`, so the stub
    // must accept either the (fn) or (options, fn) signature.
    transactionStub = sandbox.stub(db, 'transaction').callsFake(async (...args: any[]) => {
      const fn = typeof args[0] === 'function' ? args[0] : args[1];
      return fn({ id: 'tx-stub' });
    });

    service = new NotificationService(
      {
        calendarInterface: calendarInterfaceStub,
        accountsInterface: accountsInterfaceStub,
      },
      resolveRoleAudienceStub as any,
    );
  });

  afterEach(() => {
    sandbox.restore();
  });

  // ---------------------------------------------------------------------------
  // Per-verb dedup keys
  // ---------------------------------------------------------------------------

  describe('per-verb dedup keys', () => {
    it("Follow dedups on (verb, actor_kind, actor_account_id, object_type, object_id)", async () => {
      findOneStub.resolves(null);
      resolveRoleAudienceStub.resolves([]);
      activityCreateStub.resolves(buildActivityEntity({ verb: 'Follow' }));

      const accountId = uuidv4();
      const calendarId = uuidv4();
      await service.recordActivity({
        verb: 'Follow',
        actor: { kind: 'account', accountId },
        object: { type: 'calendar', id: calendarId, label: 'Test Calendar' },
        audience: { kind: 'role', role: 'calendar-editors', objectRef: { type: 'calendar', id: calendarId } },
        actorDisplayName: 'Alice',
      });

      const where = findOneStub.firstCall.args[0].where;
      expect(where.verb).toBe('Follow');
      expect(where.actor_kind).toBe('account');
      expect(where.actor_account_id).toBe(accountId);
      expect(where.object_type).toBe('calendar');
      expect(where.object_id).toBe(calendarId);
      // 10-minute window expressed as created_at >= cutoff.
      expect(where.created_at).toBeDefined();
      expect(where.created_at[Op.gte]).toBeInstanceOf(Date);
    });

    it("Announce by remote actor dedups on actor_uri (not actor_account_id)", async () => {
      findOneStub.resolves(null);
      resolveRoleAudienceStub.resolves([]);
      activityCreateStub.resolves(buildActivityEntity({ verb: 'Announce' }));

      const eventId = uuidv4();
      const calendarId = uuidv4();
      await service.recordActivity({
        verb: 'Announce',
        actor: { kind: 'remote_actor', uri: 'https://example.org/users/bob' },
        object: { type: 'event', id: eventId, label: 'Event Title' },
        audience: { kind: 'role', role: 'calendar-editors', objectRef: { type: 'calendar', id: calendarId } },
        actorDisplayName: 'Bob',
        origin: 'federated',
      });

      const where = findOneStub.firstCall.args[0].where;
      expect(where.verb).toBe('Announce');
      expect(where.actor_kind).toBe('remote_actor');
      expect(where.actor_uri).toBe('https://example.org/users/bob');
      expect(where.actor_account_id).toBeUndefined();
      expect(where.object_type).toBe('event');
      expect(where.object_id).toBe(eventId);
    });

    it("EditorInvited dedups on (verb, actor_kind, actor_account_id, object_type, object_id)", async () => {
      findOneStub.resolves(null);
      accountFindAllStub.resolves([{ id: 'invitee' }]);
      activityCreateStub.resolves(buildActivityEntity({ verb: 'EditorInvited' }));
      recipientBulkCreateStub.resolves([]);

      const inviterId = uuidv4();
      const calendarId = uuidv4();
      await service.recordActivity({
        verb: 'EditorInvited',
        actor: { kind: 'account', accountId: inviterId },
        object: { type: 'calendar', id: calendarId, label: 'Test Calendar' },
        audience: { kind: 'explicit', accountIds: ['invitee'] },
        actorDisplayName: 'Owner',
      });

      const where = findOneStub.firstCall.args[0].where;
      expect(where.verb).toBe('EditorInvited');
      expect(where.actor_kind).toBe('account');
      expect(where.actor_account_id).toBe(inviterId);
    });

    it('Flag dedups on (verb, object_type, object_id) only — no actor component', async () => {
      findOneStub.resolves(null);
      resolveRoleAudienceStub.resolves([]);
      activityCreateStub.resolves(buildActivityEntity({ verb: 'Flag' }));

      const reportId = uuidv4();
      const calendarId = uuidv4();
      await service.recordActivity({
        verb: 'Flag',
        actor: { kind: 'account', accountId: uuidv4() },
        object: { type: 'report', id: reportId, label: 'Flagged event title' },
        audience: { kind: 'role', role: 'calendar-owners', objectRef: { type: 'calendar', id: calendarId } },
      });

      const where = findOneStub.firstCall.args[0].where;
      expect(where.verb).toBe('Flag');
      expect(where.object_type).toBe('report');
      expect(where.object_id).toBe(reportId);
      // Critical: no actor component on Flag's dedup key.
      expect(where.actor_kind).toBeUndefined();
      expect(where.actor_account_id).toBeUndefined();
      expect(where.actor_uri).toBeUndefined();
    });

    it('ReportEscalated dedups on (verb, object_type, object_id) only', async () => {
      findOneStub.resolves(null);
      resolveRoleAudienceStub.resolves([]);
      activityCreateStub.resolves(buildActivityEntity({ verb: 'ReportEscalated' }));

      const reportId = uuidv4();
      await service.recordActivity({
        verb: 'ReportEscalated',
        actor: { kind: 'system' },
        object: { type: 'report', id: reportId, label: 'Escalated report' },
        audience: { kind: 'role', role: 'instance-admins' },
        actorDisplayName: 'System',
      });

      const where = findOneStub.firstCall.args[0].where;
      expect(where.verb).toBe('ReportEscalated');
      expect(where.actor_kind).toBeUndefined();
      expect(where.actor_account_id).toBeUndefined();
      expect(where.actor_uri).toBeUndefined();
    });

    it('ReportResolved dedups on (verb, object_type, object_id) only', async () => {
      findOneStub.resolves(null);
      accountFindAllStub.resolves([{ id: 'reporter' }]);
      activityCreateStub.resolves(buildActivityEntity({ verb: 'ReportResolved' }));
      recipientBulkCreateStub.resolves([]);

      const reportId = uuidv4();
      await service.recordActivity({
        verb: 'ReportResolved',
        actor: { kind: 'account', accountId: uuidv4() },
        object: { type: 'report', id: reportId, label: 'Resolved report' },
        audience: { kind: 'explicit', accountIds: ['reporter'] },
        actorDisplayName: 'Admin',
      });

      const where = findOneStub.firstCall.args[0].where;
      expect(where.verb).toBe('ReportResolved');
      expect(where.actor_kind).toBeUndefined();
    });

    it('skips insert when a matching row is in window (dedup hit)', async () => {
      const existing = buildActivityEntity({ id: 'existing-activity-id' });
      findOneStub.resolves(existing);

      const calendarId = uuidv4();
      await service.recordActivity({
        verb: 'Follow',
        actor: { kind: 'account', accountId: uuidv4() },
        object: { type: 'calendar', id: calendarId, label: 'Test Calendar' },
        audience: { kind: 'role', role: 'calendar-editors', objectRef: { type: 'calendar', id: calendarId } },
        actorDisplayName: 'Alice',
      });

      // Dedup outcome is observed through DB side effects: no new
      // activity row, no recipient fan-out. The dedup-winner's id is no
      // longer surfaced to the caller — log lines inside the service
      // carry it for ops visibility.
      expect(activityCreateStub.called).toBe(false);
      expect(recipientBulkCreateStub.called).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Explicit-audience validation
  // ---------------------------------------------------------------------------

  describe('explicit-audience validation', () => {
    it('throws synchronously when accountIds length exceeds 50', async () => {
      const accountIds = Array.from({ length: 51 }, () => uuidv4());

      await expect(
        service.recordActivity({
          verb: 'EditorInvited',
          actor: { kind: 'account', accountId: uuidv4() },
          object: { type: 'calendar', id: uuidv4(), label: 'Test Calendar' },
          audience: { kind: 'explicit', accountIds },
          actorDisplayName: 'Owner',
        }),
      ).rejects.toThrow(/exceeds max 50/);

      // The throw happens before any DB access — no transaction opened, no
      // dedup query issued.
      expect(transactionStub.called).toBe(false);
      expect(findOneStub.called).toBe(false);
    });

    it('drops nonexistent account IDs silently and inserts recipients only for found IDs', async () => {
      findOneStub.resolves(null);
      const realId = uuidv4();
      const ghostId = uuidv4();
      // Validation query returns only the real id; ghost is silently dropped.
      accountFindAllStub.resolves([{ id: realId }]);
      activityCreateStub.resolves(buildActivityEntity({ id: 'new-activity' }));
      recipientBulkCreateStub.resolves([]);

      await service.recordActivity({
        verb: 'EditorInvited',
        actor: { kind: 'account', accountId: uuidv4() },
        object: { type: 'calendar', id: uuidv4(), label: 'Test Calendar' },
        audience: { kind: 'explicit', accountIds: [realId, ghostId] },
        actorDisplayName: 'Owner',
      });

      const recipientRows = recipientBulkCreateStub.firstCall.args[0];
      expect(recipientRows).toHaveLength(1);
      expect(recipientRows[0].account_id).toBe(realId);
    });

    it('accepts a list of exactly 50 entries', async () => {
      findOneStub.resolves(null);
      const accountIds = Array.from({ length: 50 }, () => uuidv4());
      accountFindAllStub.resolves(accountIds.map((id) => ({ id })));
      activityCreateStub.resolves(buildActivityEntity({ id: 'new-activity' }));
      recipientBulkCreateStub.resolves([]);

      await service.recordActivity({
        verb: 'EditorInvited',
        actor: { kind: 'account', accountId: uuidv4() },
        object: { type: 'calendar', id: uuidv4(), label: 'Test Calendar' },
        audience: { kind: 'explicit', accountIds },
        actorDisplayName: 'Owner',
      });

      const recipientRows = recipientBulkCreateStub.firstCall.args[0];
      expect(recipientRows).toHaveLength(50);
    });

    it('deduplicates the explicit list against itself before the existence query', async () => {
      findOneStub.resolves(null);
      const realId = uuidv4();
      accountFindAllStub.resolves([{ id: realId }]);
      activityCreateStub.resolves(buildActivityEntity({ id: 'new-activity' }));
      recipientBulkCreateStub.resolves([]);

      await service.recordActivity({
        verb: 'EditorInvited',
        actor: { kind: 'account', accountId: uuidv4() },
        object: { type: 'calendar', id: uuidv4(), label: 'Test Calendar' },
        audience: { kind: 'explicit', accountIds: [realId, realId, realId] },
        actorDisplayName: 'Owner',
      });

      // Existence query must receive deduped IDs, not the raw triplicate list.
      const inWhere = accountFindAllStub.firstCall.args[0].where.id[Op.in];
      expect(inWhere).toHaveLength(1);
      expect(inWhere[0]).toBe(realId);
    });
  });

  // ---------------------------------------------------------------------------
  // Flag actor anonymization invariant
  // ---------------------------------------------------------------------------

  describe('Flag actor anonymization runs before sanitization', () => {
    it('strips actor identity on the Flag activity row regardless of input actor kind (account)', async () => {
      findOneStub.resolves(null);
      resolveRoleAudienceStub.resolves([]);
      activityCreateStub.resolves(buildActivityEntity({ verb: 'Flag' }));

      await service.recordActivity({
        verb: 'Flag',
        actor: { kind: 'account', accountId: uuidv4() },
        object: { type: 'report', id: uuidv4(), label: 'Flagged event title' },
        audience: { kind: 'role', role: 'instance-admins' },
        actorDisplayName: 'Real Name Should Not Survive',
        actorDisplayUrl: 'https://pavillion.dev/users/realname',
      });

      const inserted = activityCreateStub.firstCall.args[0];
      expect(inserted.verb).toBe('Flag');
      expect(inserted.actor_kind).toBe('anonymous');
      expect(inserted.actor_account_id).toBeNull();
      expect(inserted.actor_uri).toBeNull();
      // Caller's display name/url discarded; anonymization writes the
      // i18n token form.
      expect(inserted.actor_display_name).toBe('i18n:flag_actor_anonymous');
      expect(inserted.actor_display_url).toBeNull();
    });

    it('preserves only the normalized instance hostname for remote AP Flag actors', async () => {
      findOneStub.resolves(null);
      resolveRoleAudienceStub.resolves([]);
      activityCreateStub.resolves(buildActivityEntity({ verb: 'Flag' }));

      await service.recordActivity({
        verb: 'Flag',
        actor: { kind: 'remote_actor', uri: 'https://example.ORG/users/alice' },
        object: { type: 'report', id: uuidv4(), label: 'Flagged event title' },
        audience: { kind: 'role', role: 'instance-admins' },
      });

      const inserted = activityCreateStub.firstCall.args[0];
      expect(inserted.actor_kind).toBe('anonymous');
      expect(inserted.actor_account_id).toBeNull();
      expect(inserted.actor_uri).toBeNull();
      // Hostname is lowercased + NFKC-normalized per ap-actor-uri validator;
      // the i18n token carries it so render-time resolution can localize.
      expect(inserted.actor_display_name).toBe('i18n:flag_actor_remote{host:example.org}');
      expect(inserted.actor_display_url).toBe('https://example.org');
    });

    it('non-Flag verbs pass actor identity through unchanged', async () => {
      findOneStub.resolves(null);
      resolveRoleAudienceStub.resolves([]);
      activityCreateStub.resolves(buildActivityEntity({ verb: 'Follow' }));

      const accountId = uuidv4();
      await service.recordActivity({
        verb: 'Follow',
        actor: { kind: 'account', accountId },
        object: { type: 'calendar', id: uuidv4(), label: 'Test Calendar' },
        audience: { kind: 'role', role: 'calendar-editors', objectRef: { type: 'calendar', id: uuidv4() } },
        actorDisplayName: 'Alice',
        actorDisplayUrl: 'https://pavillion.dev/@alice',
      });

      const inserted = activityCreateStub.firstCall.args[0];
      expect(inserted.actor_kind).toBe('account');
      expect(inserted.actor_account_id).toBe(accountId);
      expect(inserted.actor_display_name).toBe('Alice');
      expect(inserted.actor_display_url).toBe('https://pavillion.dev/@alice');
    });

    // -------------------------------------------------------------------------
    // Guard: Flag verb does not accept actor.kind = 'system' (pv-vdu2.8).
    //
    // The earlier implementation silently collapsed 'system' into the
    // anonymous form via a default branch. That is wrong on two axes:
    // presentationally (system actors are not anonymous) and on the
    // privacy rationale (anonymization exists to prevent reporter
    // retaliation; system actors carry no retaliation risk). The guard
    // throws instead so the first misuse surfaces loudly rather than
    // producing wrong rows. The 'anonymous' regression test below pins
    // the simplification — removing the fall-through must not break the
    // legitimate web-form path.
    // -------------------------------------------------------------------------

    it("throws when verb='Flag' and actor.kind='system' instead of silently anonymizing", async () => {
      findOneStub.resolves(null);
      resolveRoleAudienceStub.resolves([]);

      await expect(
        service.recordActivity({
          verb: 'Flag',
          actor: { kind: 'system' },
          object: { type: 'report', id: uuidv4(), label: 'Flagged event title' },
          audience: { kind: 'role', role: 'instance-admins' },
        }),
      ).rejects.toThrow(/Flag verb does not support actor kind 'system'/);

      // The throw happens before the insert path, so no activity row is
      // created on a rejected Flag.
      expect(activityCreateStub.called).toBe(false);
    });

    it("still anonymizes verb='Flag' with actor.kind='anonymous' (regression guard for the system-throw simplification)", async () => {
      findOneStub.resolves(null);
      resolveRoleAudienceStub.resolves([]);
      activityCreateStub.resolves(buildActivityEntity({ verb: 'Flag' }));

      await service.recordActivity({
        verb: 'Flag',
        actor: { kind: 'anonymous' },
        object: { type: 'report', id: uuidv4(), label: 'Flagged event title' },
        audience: { kind: 'role', role: 'instance-admins' },
      });

      const inserted = activityCreateStub.firstCall.args[0];
      expect(inserted.actor_kind).toBe('anonymous');
      expect(inserted.actor_account_id).toBeNull();
      expect(inserted.actor_uri).toBeNull();
      expect(inserted.actor_display_name).toBe('i18n:flag_actor_anonymous');
      expect(inserted.actor_display_url).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Snapshot sanitization
  // ---------------------------------------------------------------------------

  describe('snapshot sanitization', () => {
    it('strips HTML from actor_display_name and object_label before insert', async () => {
      findOneStub.resolves(null);
      resolveRoleAudienceStub.resolves([]);
      activityCreateStub.resolves(buildActivityEntity({ verb: 'Follow' }));

      await service.recordActivity({
        verb: 'Follow',
        actor: { kind: 'account', accountId: uuidv4() },
        object: { type: 'calendar', id: uuidv4(), label: '<b>Concert</b>' },
        audience: { kind: 'role', role: 'calendar-editors', objectRef: { type: 'calendar', id: uuidv4() } },
        actorDisplayName: '<script>x</script>Alice',
      });

      const inserted = activityCreateStub.firstCall.args[0];
      expect(inserted.actor_display_name).toBe('xAlice');
      expect(inserted.object_label).toBe('Concert');
    });

    it('truncates actor_display_name to 256 chars and object_label to 512 chars', async () => {
      findOneStub.resolves(null);
      resolveRoleAudienceStub.resolves([]);
      activityCreateStub.resolves(buildActivityEntity({ verb: 'Follow' }));

      const longActor = 'A'.repeat(400);
      const longLabel = 'L'.repeat(700);

      await service.recordActivity({
        verb: 'Follow',
        actor: { kind: 'account', accountId: uuidv4() },
        object: { type: 'calendar', id: uuidv4(), label: longLabel },
        audience: { kind: 'role', role: 'calendar-editors', objectRef: { type: 'calendar', id: uuidv4() } },
        actorDisplayName: longActor,
      });

      const inserted = activityCreateStub.firstCall.args[0];
      expect(inserted.actor_display_name).toHaveLength(256);
      expect(inserted.object_label).toHaveLength(512);
    });
  });

  // ---------------------------------------------------------------------------
  // Reserved `i18n:` prefix is scrubbed on non-Flag verbs.
  //
  // The `i18n:` prefix on `actor_display_name` is reserved for the Flag
  // anonymization policy's server-generated tokens. A caller (or a
  // federated peer surfacing through an emitter that snapshots an AP
  // actor's display name) must never be able to inject the prefix on a
  // non-Flag verb — otherwise the client-side resolver would render the
  // Flag attribution string for a Follow / Announce / EditorInvited /
  // EditorRevoked notification (display spoofing, content confusion).
  // ---------------------------------------------------------------------------

  describe('reserved i18n: prefix scrubbing for non-Flag verbs', () => {
    it('blanks a caller-supplied actorDisplayName starting with `i18n:` on Follow (remote_actor)', async () => {
      findOneStub.resolves(null);
      resolveRoleAudienceStub.resolves([]);
      activityCreateStub.resolves(buildActivityEntity({ verb: 'Follow' }));

      await service.recordActivity({
        verb: 'Follow',
        actor: { kind: 'remote_actor', uri: 'https://victim.example/users/peer' },
        object: { type: 'calendar', id: uuidv4(), label: 'Test Calendar' },
        audience: { kind: 'role', role: 'calendar-editors', objectRef: { type: 'calendar', id: uuidv4() } },
        actorDisplayName: 'i18n:flag_actor_remote{host:victim.example}',
      });

      const inserted = activityCreateStub.firstCall.args[0];
      expect(inserted.actor_kind).toBe('remote_actor');
      expect(inserted.actor_display_name).toBe('');
      // The Flag token must not survive into the stored row.
      expect(inserted.actor_display_name.startsWith('i18n:')).toBe(false);
    });

    it('blanks an `i18n:`-prefixed actorDisplayName on Follow (account)', async () => {
      findOneStub.resolves(null);
      resolveRoleAudienceStub.resolves([]);
      activityCreateStub.resolves(buildActivityEntity({ verb: 'Follow' }));

      await service.recordActivity({
        verb: 'Follow',
        actor: { kind: 'account', accountId: uuidv4() },
        object: { type: 'calendar', id: uuidv4(), label: 'Test Calendar' },
        audience: { kind: 'role', role: 'calendar-editors', objectRef: { type: 'calendar', id: uuidv4() } },
        actorDisplayName: 'i18n:flag_actor_anonymous',
      });

      const inserted = activityCreateStub.firstCall.args[0];
      expect(inserted.actor_display_name).toBe('');
    });

    it('blanks an `i18n:`-prefixed actorDisplayName on EditorInvited (system)', async () => {
      findOneStub.resolves(null);
      accountFindAllStub.resolves([]);
      activityCreateStub.resolves(buildActivityEntity({ verb: 'EditorInvited' }));

      await service.recordActivity({
        verb: 'EditorInvited',
        actor: { kind: 'system' },
        object: { type: 'calendar', id: uuidv4(), label: 'Test Calendar' },
        audience: { kind: 'explicit', accountIds: [uuidv4()] },
        actorDisplayName: 'i18n:flag_actor_remote{host:victim.example}',
      });

      const inserted = activityCreateStub.firstCall.args[0];
      expect(inserted.actor_display_name).toBe('');
    });

    it('blanks an `i18n:`-prefixed actorDisplayName on Announce (anonymous)', async () => {
      findOneStub.resolves(null);
      resolveRoleAudienceStub.resolves([]);
      activityCreateStub.resolves(buildActivityEntity({ verb: 'Announce' }));

      await service.recordActivity({
        verb: 'Announce',
        actor: { kind: 'anonymous' },
        object: { type: 'event', id: uuidv4(), label: 'Some event' },
        audience: { kind: 'role', role: 'calendar-owners', objectRef: { type: 'calendar', id: uuidv4() } },
        actorDisplayName: 'i18n:flag_actor_anonymous',
      });

      const inserted = activityCreateStub.firstCall.args[0];
      expect(inserted.actor_display_name).toBe('');
    });

    it('leaves plain-text actorDisplayName values unchanged (regression guard)', async () => {
      findOneStub.resolves(null);
      resolveRoleAudienceStub.resolves([]);
      activityCreateStub.resolves(buildActivityEntity({ verb: 'Follow' }));

      await service.recordActivity({
        verb: 'Follow',
        actor: { kind: 'account', accountId: uuidv4() },
        object: { type: 'calendar', id: uuidv4(), label: 'Test Calendar' },
        audience: { kind: 'role', role: 'calendar-editors', objectRef: { type: 'calendar', id: uuidv4() } },
        actorDisplayName: 'Alice from i18n.example',
      });

      const inserted = activityCreateStub.firstCall.args[0];
      // The prefix scrub is strictly start-anchored — values that merely
      // contain `i18n` later in the string must survive.
      expect(inserted.actor_display_name).toBe('Alice from i18n.example');
    });

    it('does not interfere with Flag anonymization (the prefix is the legitimate output on the Flag path)', async () => {
      findOneStub.resolves(null);
      resolveRoleAudienceStub.resolves([]);
      activityCreateStub.resolves(buildActivityEntity({ verb: 'Flag' }));

      await service.recordActivity({
        verb: 'Flag',
        actor: { kind: 'remote_actor', uri: 'https://example.org/users/alice' },
        object: { type: 'report', id: uuidv4(), label: 'Flagged event title' },
        audience: { kind: 'role', role: 'instance-admins' },
        // Supply an `i18n:`-prefixed value — the exact shape the scrub
        // blanks on every non-Flag path. The Flag path discards the
        // caller-supplied display name entirely and computes its own
        // `i18n:flag_actor_remote{host:...}` token from the actor URI, and
        // that legitimate token must NOT be routed through the scrub. If a
        // refactor ever applied `scrubReservedI18nPrefix` to the Flag
        // anonymizer's output, the assertion below would observe '' instead
        // of the token — pinning the separation between the two code paths.
        actorDisplayName: 'i18n:flag_actor_remote{host:victim.example}',
      });

      const inserted = activityCreateStub.firstCall.args[0];
      expect(inserted.actor_display_name).toBe('i18n:flag_actor_remote{host:example.org}');
    });
  });

  // ---------------------------------------------------------------------------
  // Transaction wiring
  // ---------------------------------------------------------------------------

  describe('single transaction', () => {
    it('passes the transaction handle to all insert-path entity calls (dedup check, create, bulkCreate)', async () => {
      findOneStub.resolves(null);
      accountFindAllStub.resolves([{ id: 'a' }]);
      activityCreateStub.resolves(buildActivityEntity({ id: 'new-activity' }));
      recipientBulkCreateStub.resolves([]);

      await service.recordActivity({
        verb: 'EditorInvited',
        actor: { kind: 'account', accountId: uuidv4() },
        object: { type: 'calendar', id: uuidv4(), label: 'Test Calendar' },
        audience: { kind: 'explicit', accountIds: ['a'] },
        actorDisplayName: 'Owner',
      });

      // The insert-path mutations/reads (dedup-check findOne, activity
      // create, recipient bulkCreate) all run under the managed
      // transaction. The accounts existence query (AccountEntity.findAll
      // inside resolveAudience) is intentionally outside the transaction
      // per the audience-resolution-before-tx design note in
      // `recordActivity` — it is a read-only validation of caller-supplied
      // account ids, not part of the write path's atomicity guarantee.
      expect(findOneStub.firstCall.args[0].transaction).toEqual({ id: 'tx-stub' });
      expect(activityCreateStub.firstCall.args[1].transaction).toEqual({ id: 'tx-stub' });
      expect(recipientBulkCreateStub.firstCall.args[1].transaction).toEqual({ id: 'tx-stub' });
    });

    it('opens the transaction at SERIALIZABLE isolation', async () => {
      findOneStub.resolves(null);
      resolveRoleAudienceStub.resolves([]);
      activityCreateStub.resolves(buildActivityEntity({ id: 'new-activity' }));

      await service.recordActivity({
        verb: 'Follow',
        actor: { kind: 'account', accountId: uuidv4() },
        object: { type: 'calendar', id: uuidv4(), label: 'Test Calendar' },
        audience: { kind: 'role', role: 'calendar-editors', objectRef: { type: 'calendar', id: uuidv4() } },
        actorDisplayName: 'Alice',
      });

      // db.transaction is called with (options, fn) and the options object
      // carries the SERIALIZABLE isolation level. This is the design-
      // mandated mitigation that prevents two concurrent calls for the
      // same dedup tuple from each producing an activity row.
      expect(transactionStub.calledOnce).toBe(true);
      const opts = transactionStub.firstCall.args[0];
      expect(opts).toBeDefined();
      expect(opts.isolationLevel).toBe(Transaction.ISOLATION_LEVELS.SERIALIZABLE);
    });

    it('retries the transaction on Postgres serialization failure (SQLSTATE 40001) and succeeds on the second attempt', async () => {
      // Simulate a SERIALIZABLE conflict: the first transaction attempt
      // throws a Sequelize error wrapping a `code: '40001'` original; the
      // service retries; the second attempt succeeds. This proves the
      // retry loop is wired even though the SQLite test backend cannot
      // genuinely race two writers.
      findOneStub.resolves(null);
      resolveRoleAudienceStub.resolves([]);
      activityCreateStub.resolves(buildActivityEntity({ id: 'retry-winner' }));

      // Restore the default stub and re-stub with first-call rejection.
      transactionStub.restore();
      const realTxStub = sandbox.stub(db, 'transaction');
      const serializationError: any = new Error('could not serialize access');
      serializationError.original = { code: '40001' };
      realTxStub.onFirstCall().rejects(serializationError);
      realTxStub.onSecondCall().callsFake(async (...args: any[]) => {
        const fn = typeof args[0] === 'function' ? args[0] : args[1];
        return fn({ id: 'tx-retry' });
      });

      await service.recordActivity({
        verb: 'Follow',
        actor: { kind: 'account', accountId: uuidv4() },
        object: { type: 'calendar', id: uuidv4(), label: 'Test Calendar' },
        audience: { kind: 'role', role: 'calendar-editors', objectRef: { type: 'calendar', id: uuidv4() } },
        actorDisplayName: 'Alice',
      });

      // Retry succeeded — the activity insert was attempted on the
      // second transaction attempt.
      expect(activityCreateStub.calledOnce).toBe(true);
      expect(realTxStub.callCount).toBe(2);
      // Both call sites must request SERIALIZABLE isolation.
      expect(realTxStub.firstCall.args[0].isolationLevel)
        .toBe(Transaction.ISOLATION_LEVELS.SERIALIZABLE);
      expect(realTxStub.secondCall.args[0].isolationLevel)
        .toBe(Transaction.ISOLATION_LEVELS.SERIALIZABLE);
    });

    it('retries on SQLite BUSY/LOCKED and surfaces the failure when the retry budget exhausts', async () => {
      // Three consecutive SQLite BUSY errors must exhaust the 3-attempt
      // retry budget. The final error propagates so callers can decide
      // whether to alert.
      findOneStub.resolves(null);
      resolveRoleAudienceStub.resolves([]);

      transactionStub.restore();
      const realTxStub = sandbox.stub(db, 'transaction');
      const busyError: any = new Error('database is locked');
      busyError.original = { code: 'SQLITE_BUSY' };
      realTxStub.rejects(busyError);

      await expect(
        service.recordActivity({
          verb: 'Follow',
          actor: { kind: 'account', accountId: uuidv4() },
          object: { type: 'calendar', id: uuidv4(), label: 'Test Calendar' },
          audience: { kind: 'role', role: 'calendar-editors', objectRef: { type: 'calendar', id: uuidv4() } },
          actorDisplayName: 'Alice',
        }),
      ).rejects.toThrow(/database is locked/);

      // Exactly SERIALIZATION_RETRY_LIMIT (3) attempts before giving up.
      expect(realTxStub.callCount).toBe(3);
    });

    it('does NOT retry on a non-serialization error (e.g. constraint violation, programming error)', async () => {
      findOneStub.resolves(null);
      resolveRoleAudienceStub.resolves([]);

      transactionStub.restore();
      const realTxStub = sandbox.stub(db, 'transaction');
      const otherError: any = new Error('column does not exist');
      otherError.original = { code: '42703' };
      realTxStub.rejects(otherError);

      await expect(
        service.recordActivity({
          verb: 'Follow',
          actor: { kind: 'account', accountId: uuidv4() },
          object: { type: 'calendar', id: uuidv4(), label: 'Test Calendar' },
          audience: { kind: 'role', role: 'calendar-editors', objectRef: { type: 'calendar', id: uuidv4() } },
          actorDisplayName: 'Alice',
        }),
      ).rejects.toThrow(/column does not exist/);

      // Non-serialization errors bypass the retry loop entirely.
      expect(realTxStub.callCount).toBe(1);
    });

    it('falls back to dedup-winner lookup when activity insert raises UniqueConstraintError', async () => {
      // First dedup-check finds nothing; insert collides with a concurrent
      // writer; recovery lookup finds the winner row. This is the
      // secondary defense path that runs INSIDE a single SERIALIZABLE
      // transaction attempt when a unique partial index on the dedup
      // tuple is added in a future deployment.
      const winner = buildActivityEntity({ id: 'concurrent-winner' });
      findOneStub.onFirstCall().resolves(null);
      findOneStub.onSecondCall().resolves(winner);
      activityCreateStub.rejects(new UniqueConstraintError({}));
      resolveRoleAudienceStub.resolves([]);

      // Call resolves without throwing — the dedup-winner recovery
      // swallowed the constraint error. Fan-out is skipped because the
      // winner already addressed its audience.
      await expect(service.recordActivity({
        verb: 'Follow',
        actor: { kind: 'account', accountId: uuidv4() },
        object: { type: 'calendar', id: uuidv4(), label: 'Test Calendar' },
        audience: { kind: 'role', role: 'calendar-editors', objectRef: { type: 'calendar', id: uuidv4() } },
        actorDisplayName: 'Alice',
      })).resolves.toBeUndefined();

      // The recovery path issued the second dedup lookup (winner found).
      expect(findOneStub.callCount).toBe(2);
      expect(recipientBulkCreateStub.called).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Audience resolution branching
  // ---------------------------------------------------------------------------

  describe('audience resolution', () => {
    it('runs the role resolver for kind=role and passes through the objectRef', async () => {
      findOneStub.resolves(null);
      const calendarId = uuidv4();
      resolveRoleAudienceStub.resolves(['editor-1', 'editor-2']);
      activityCreateStub.resolves(buildActivityEntity({ id: 'new-activity' }));
      recipientBulkCreateStub.resolves([]);

      await service.recordActivity({
        verb: 'Follow',
        actor: { kind: 'remote_actor', uri: 'https://example.org/users/alice' },
        object: { type: 'calendar', id: calendarId, label: 'Test Calendar' },
        audience: { kind: 'role', role: 'calendar-editors', objectRef: { type: 'calendar', id: calendarId } },
        actorDisplayName: 'Alice',
        origin: 'federated',
      });

      expect(resolveRoleAudienceStub.calledOnce).toBe(true);
      const [role, objectRef] = resolveRoleAudienceStub.firstCall.args;
      expect(role).toBe('calendar-editors');
      expect(objectRef).toEqual({ type: 'calendar', id: calendarId });

      const recipientRows = recipientBulkCreateStub.firstCall.args[0];
      expect(recipientRows.map((r: any) => r.account_id)).toEqual(['editor-1', 'editor-2']);
    });

    it('inserts the activity row with zero recipients when role resolves to empty list', async () => {
      findOneStub.resolves(null);
      resolveRoleAudienceStub.resolves([]);
      activityCreateStub.resolves(buildActivityEntity({ id: 'new-activity' }));

      await service.recordActivity({
        verb: 'Follow',
        actor: { kind: 'remote_actor', uri: 'https://example.org/users/alice' },
        object: { type: 'calendar', id: uuidv4(), label: 'Test Calendar' },
        audience: { kind: 'role', role: 'calendar-editors', objectRef: { type: 'calendar', id: uuidv4() } },
        actorDisplayName: 'Alice',
        origin: 'federated',
      });

      // Critical contract: activity row IS still inserted (audit trail).
      expect(activityCreateStub.calledOnce).toBe(true);
      // No fan-out attempted at all.
      expect(recipientBulkCreateStub.called).toBe(false);
    });
  });
});

/**
 * Unit tests for the dismissForObject surface (pv-89mw.3.5).
 *
 * Only the actor-filter mutex contract is unit-testable cleanly — the
 * SQL behavior (object scope, actor scope, Flag no-op, idempotency)
 * requires real rows to assert against and lives in the integration suite
 * under `integration/dismiss-for-object.test.ts`. The mutex throw must
 * fire before any DB access, so the assertion is on the absence of a
 * transaction call.
 */
describe('NotificationService.dismissForObject', () => {
  let sandbox: sinon.SinonSandbox;
  let service: NotificationService;
  let transactionStub: sinon.SinonStub;
  let recipientUpdateStub: sinon.SinonStub;
  let activityFindAllStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // Stub db.transaction so a mutex throw can be asserted on .called.
    // dismissForObject still uses the (fn) signature so accept either form.
    transactionStub = sandbox.stub(db, 'transaction').callsFake(async (...args: any[]) => {
      const fn = typeof args[0] === 'function' ? args[0] : args[1];
      return fn({ id: 'tx-stub' });
    });
    recipientUpdateStub = sandbox.stub(NotificationRecipientEntity, 'update').resolves([0]);
    activityFindAllStub = sandbox
      .stub(NotificationActivityEntity, 'findAll')
      .resolves([]);

    service = new NotificationService(
      {
        calendarInterface: {} as CalendarInterface,
        accountsInterface: {} as AccountsInterface,
      },
    );
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('throws synchronously when both actorAccountId and actorUri are set', async () => {
    await expect(
      service.dismissForObject({
        objectType: 'event',
        objectId: uuidv4(),
        actorAccountId: uuidv4(),
        actorUri: 'https://example.org/users/alice',
      }),
    ).rejects.toThrow(/at most one of actorAccountId.*actorUri/i);

    // The throw must precede any DB access — invariant violation is a
    // programming error and should not waste a round-trip.
    expect(transactionStub.called).toBe(false);
    expect(activityFindAllStub.called).toBe(false);
    expect(recipientUpdateStub.called).toBe(false);
  });

  it('does NOT throw when only actorAccountId is set', async () => {
    await expect(
      service.dismissForObject({
        objectType: 'event',
        objectId: uuidv4(),
        actorAccountId: uuidv4(),
      }),
    ).resolves.toBeUndefined();
  });

  it('does NOT throw when only actorUri is set', async () => {
    await expect(
      service.dismissForObject({
        objectType: 'event',
        objectId: uuidv4(),
        actorUri: 'https://example.org/users/alice',
      }),
    ).resolves.toBeUndefined();
  });

  it('does NOT throw when no actor filter is set (object-scoped)', async () => {
    await expect(
      service.dismissForObject({
        objectType: 'report',
        objectId: uuidv4(),
        verbs: ['Flag', 'ReportEscalated'],
      }),
    ).resolves.toBeUndefined();
  });
});

/**
 * Unit tests for the updateRecipientState surface (pv-jehu).
 *
 * Asserts the per-row PATCH semantics that back the inbox seen/dismissed
 * write path:
 *   - Account scoping: the WHERE clause carries both `id` and `account_id`
 *     so a recipient belonging to another account collapses into the
 *     "no row found" branch (NotificationRecipientNotFoundError, mapped
 *     to 404 by the route handler — no existence leak).
 *   - Flip semantics: false→true stamps the timestamp, true→false clears it.
 *   - Idempotency: applying the same boolean twice writes nothing.
 *   - Body validation: rejecting an empty patch throws before any DB access.
 */
describe('NotificationService.updateRecipientState', () => {
  let sandbox: sinon.SinonSandbox;
  let service: NotificationService;
  let recipientFindOneStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    recipientFindOneStub = sandbox.stub(NotificationRecipientEntity, 'findOne');

    service = new NotificationService(
      {
        calendarInterface: {} as CalendarInterface,
        accountsInterface: {} as AccountsInterface,
      },
    );
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('throws synchronously when neither seen nor dismissed is supplied', async () => {
    await expect(
      service.updateRecipientState(uuidv4(), uuidv4(), {}),
    ).rejects.toThrow(/at least one of/);

    // Body validation runs before any DB access.
    expect(recipientFindOneStub.called).toBe(false);
  });

  it('throws NotificationRecipientNotFoundError when no row matches (id, accountId)', async () => {
    recipientFindOneStub.resolves(null);

    await expect(
      service.updateRecipientState(uuidv4(), uuidv4(), { seen: true }),
    ).rejects.toBeInstanceOf(NotificationRecipientNotFoundError);
  });

  it('scopes the lookup to BOTH id AND account_id (cross-account 404 invariant)', async () => {
    recipientFindOneStub.resolves(null);

    const accountId = uuidv4();
    const recipientId = uuidv4();

    await expect(
      service.updateRecipientState(accountId, recipientId, { seen: true }),
    ).rejects.toBeInstanceOf(NotificationRecipientNotFoundError);

    // Critical: the account_id filter is part of the WHERE clause so the
    // service cannot distinguish "row exists but belongs to another
    // account" from "row does not exist". The route handler returns 404
    // for both — this is the no-existence-leak invariant.
    const where = recipientFindOneStub.firstCall.args[0].where;
    expect(where.id).toBe(recipientId);
    expect(where.account_id).toBe(accountId);
  });

  it('stamps seen_at = new Date() when flipping false → true', async () => {
    const updateStub = sandbox.stub().resolves();
    recipientFindOneStub.resolves({
      seen_at: null,
      dismissed_at: null,
      update: updateStub,
    });

    await service.updateRecipientState(uuidv4(), uuidv4(), { seen: true });

    expect(updateStub.calledOnce).toBe(true);
    const updates = updateStub.firstCall.args[0];
    expect(updates.seen_at).toBeInstanceOf(Date);
    expect(updates.dismissed_at).toBeUndefined();
  });

  it('clears seen_at to null when flipping true → false', async () => {
    const updateStub = sandbox.stub().resolves();
    recipientFindOneStub.resolves({
      seen_at: new Date(),
      dismissed_at: null,
      update: updateStub,
    });

    await service.updateRecipientState(uuidv4(), uuidv4(), { seen: false });

    expect(updateStub.calledOnce).toBe(true);
    expect(updateStub.firstCall.args[0].seen_at).toBeNull();
  });

  it('stamps dismissed_at when flipping false → true', async () => {
    const updateStub = sandbox.stub().resolves();
    recipientFindOneStub.resolves({
      seen_at: null,
      dismissed_at: null,
      update: updateStub,
    });

    await service.updateRecipientState(uuidv4(), uuidv4(), { dismissed: true });

    expect(updateStub.calledOnce).toBe(true);
    expect(updateStub.firstCall.args[0].dismissed_at).toBeInstanceOf(Date);
  });

  it('clears dismissed_at to null when flipping true → false', async () => {
    const updateStub = sandbox.stub().resolves();
    recipientFindOneStub.resolves({
      seen_at: null,
      dismissed_at: new Date(),
      update: updateStub,
    });

    await service.updateRecipientState(uuidv4(), uuidv4(), { dismissed: false });

    expect(updateStub.calledOnce).toBe(true);
    expect(updateStub.firstCall.args[0].dismissed_at).toBeNull();
  });

  it('is idempotent on seen: true when already seen (no UPDATE issued)', async () => {
    const updateStub = sandbox.stub().resolves();
    recipientFindOneStub.resolves({
      seen_at: new Date(),
      dismissed_at: null,
      update: updateStub,
    });

    await service.updateRecipientState(uuidv4(), uuidv4(), { seen: true });

    // No-op: derived boolean already matches the requested state.
    expect(updateStub.called).toBe(false);
  });

  it('is idempotent on seen: false when already unseen (no UPDATE issued)', async () => {
    const updateStub = sandbox.stub().resolves();
    recipientFindOneStub.resolves({
      seen_at: null,
      dismissed_at: null,
      update: updateStub,
    });

    await service.updateRecipientState(uuidv4(), uuidv4(), { seen: false });

    expect(updateStub.called).toBe(false);
  });

  it('flips both seen and dismissed in a single UPDATE when both supplied', async () => {
    const updateStub = sandbox.stub().resolves();
    recipientFindOneStub.resolves({
      seen_at: null,
      dismissed_at: null,
      update: updateStub,
    });

    await service.updateRecipientState(uuidv4(), uuidv4(), {
      seen: true,
      dismissed: true,
    });

    expect(updateStub.calledOnce).toBe(true);
    const updates = updateStub.firstCall.args[0];
    expect(updates.seen_at).toBeInstanceOf(Date);
    expect(updates.dismissed_at).toBeInstanceOf(Date);
  });

  it('skips no-op fields while still applying changed ones', async () => {
    // seen is already true (no change requested), dismissed flips false → true.
    // Only dismissed_at lands on the UPDATE payload.
    const updateStub = sandbox.stub().resolves();
    recipientFindOneStub.resolves({
      seen_at: new Date(),
      dismissed_at: null,
      update: updateStub,
    });

    await service.updateRecipientState(uuidv4(), uuidv4(), {
      seen: true,
      dismissed: true,
    });

    expect(updateStub.calledOnce).toBe(true);
    const updates = updateStub.firstCall.args[0];
    expect(updates.seen_at).toBeUndefined();
    expect(updates.dismissed_at).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal stub entity that satisfies the bits of
 * `NotificationActivityEntity` the service touches after insert (id
 * lookup). Sequelize entities have many internal symbols we don't need;
 * the service only reads `.id`.
 */
function buildActivityEntity(
  overrides: Partial<{ id: string; verb: string }> = {},
): NotificationActivityEntity {
  return {
    id: overrides.id ?? uuidv4(),
    verb: overrides.verb ?? 'Follow',
  } as unknown as NotificationActivityEntity;
}
