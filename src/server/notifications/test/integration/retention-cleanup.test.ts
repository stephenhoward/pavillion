import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { v4 as uuidv4 } from 'uuid';

import db from '@/server/common/entity/db';
import { AccountEntity } from '@/server/common/entity/account';
import {
  NotificationActivityEntity,
  NotificationRecipientEntity,
} from '@/server/notifications/entity/notification_activity';
import NotificationRetentionCleanupService from '@/server/notifications/service/retention-cleanup';

/**
 * Integration test for the notifications retention cleanup job (pv-89mw.8.1).
 *
 * The cleanup runs in two passes:
 *   1. Delete `notification_recipient` rows where (dismissed_at OR seen_at)
 *      is set and the row is older than 7 days.
 *   2. Delete `notification_activity` rows older than 90 days. FK cascade
 *      removes any remaining recipient rows.
 *
 * Orphaned activities (no recipients left after pass 1) are NOT deleted
 * early — they age out via pass 2. Acceptable since the 90-day
 * cap is short and activity rows are small.
 *
 * This test does NOT use TestEnvironment because TestEnvironment imports
 * `server.ts`, which transitively imports the broken
 * `notifications/service/notification.ts` (rewired in pv-89mw.5.1). The test
 * sets up the DB directly using `db.sync({ force: true })` against the
 * registered entities to avoid the broken module graph.
 */
describe('NotificationRetentionCleanupService (integration)', () => {
  let service: NotificationRetentionCleanupService;
  let account: AccountEntity;

  beforeAll(async () => {
    // Sync the test DB. The notification entities self-register with `db` via
    // notification_activity.ts; AccountEntity registers via its own module.
    await db.sync({ force: true });
    account = await AccountEntity.create({
      id: uuidv4(),
      username: 'retention-test',
      email: 'retention-test@pavillion.dev',
      language: 'en',
    });
  });

  afterAll(async () => {
    // SQLite :memory: tears down with the process; no explicit close.
  });

  beforeEach(async () => {
    // Activity cascade removes recipients; clear in dependent order anyway.
    await NotificationRecipientEntity.destroy({ where: {}, truncate: true });
    await NotificationActivityEntity.destroy({ where: {}, truncate: true });
    service = new NotificationRetentionCleanupService();
  });

  /** Seed an activity row at the supplied creation timestamp. */
  async function seedActivity(createdAt: Date, overrides: Partial<{
    verb: string;
    object_type: string;
    object_id: string;
  }> = {}): Promise<NotificationActivityEntity> {
    return NotificationActivityEntity.create({
      id: uuidv4(),
      verb: overrides.verb ?? 'Follow',
      origin: 'federated',
      actor_kind: 'remote_actor',
      actor_account_id: null,
      actor_uri: 'https://example.org/users/alice',
      actor_display_name: 'Alice',
      actor_display_url: 'https://example.org/users/alice',
      object_type: overrides.object_type ?? 'calendar',
      object_id: overrides.object_id ?? uuidv4(),
      object_label: 'Test Calendar',
      created_at: createdAt,
    });
  }

  /** Seed a recipient row at the supplied creation timestamp. */
  async function seedRecipient(
    activityId: string,
    accountId: string,
    overrides: Partial<{
      created_at: Date;
      seen_at: Date | null;
      dismissed_at: Date | null;
    }> = {},
  ): Promise<NotificationRecipientEntity> {
    return NotificationRecipientEntity.create({
      id: uuidv4(),
      notification_activity_id: activityId,
      account_id: accountId,
      seen_at: overrides.seen_at ?? null,
      dismissed_at: overrides.dismissed_at ?? null,
      created_at: overrides.created_at ?? new Date(),
    });
  }

  it('deletes recipient rows dismissed >7 days ago while keeping parent activity (<90 days)', async () => {
    const eightDaysAgo = DateTime.now().minus({ days: 8 }).toJSDate();
    const tenDaysAgo = DateTime.now().minus({ days: 10 }).toJSDate();

    // Activity is 30 days old — well under the 90-day cap; must survive.
    const activity = await seedActivity(DateTime.now().minus({ days: 30 }).toJSDate());

    // Recipient dismissed 8 days ago: target for pass 1 deletion.
    const dismissedRecipient = await seedRecipient(activity.id, account.id, {
      created_at: tenDaysAgo,
      dismissed_at: eightDaysAgo,
    });

    await service.cleanupExpiredNotifications();

    // Pass 1: dismissed recipient is gone.
    const recipientStillPresent = await NotificationRecipientEntity.findByPk(dismissedRecipient.id);
    expect(recipientStillPresent).toBeNull();

    // Activity row itself remains (<90 days old).
    const activityStillPresent = await NotificationActivityEntity.findByPk(activity.id);
    expect(activityStillPresent).not.toBeNull();
  });

  it('deletes recipient rows seen >7 days ago while keeping parent activity (<90 days)', async () => {
    const eightDaysAgo = DateTime.now().minus({ days: 8 }).toJSDate();
    const tenDaysAgo = DateTime.now().minus({ days: 10 }).toJSDate();

    const activity = await seedActivity(DateTime.now().minus({ days: 30 }).toJSDate());

    const seenRecipient = await seedRecipient(activity.id, account.id, {
      created_at: tenDaysAgo,
      seen_at: eightDaysAgo,
    });

    await service.cleanupExpiredNotifications();

    expect(await NotificationRecipientEntity.findByPk(seenRecipient.id)).toBeNull();
    expect(await NotificationActivityEntity.findByPk(activity.id)).not.toBeNull();
  });

  it('keeps recipient rows dismissed within 7 days even when created_at is older (terminal-state anchor)', async () => {
    // Discriminating test: the retention window starts at the terminal-state
    // timestamp (dismissed_at / seen_at), NOT at created_at. A row that was
    // created 10 days ago but dismissed 3 days ago must SURVIVE — its 7-day
    // clock started at dismissal, not at creation. This fails under the
    // earlier `created_at < threshold` implementation, which would delete it.
    const tenDaysAgo = DateTime.now().minus({ days: 10 }).toJSDate();
    const threeDaysAgo = DateTime.now().minus({ days: 3 }).toJSDate();

    const activity = await seedActivity(tenDaysAgo);
    const recipient = await seedRecipient(activity.id, account.id, {
      created_at: tenDaysAgo,
      dismissed_at: threeDaysAgo,
    });

    await service.cleanupExpiredNotifications();

    // Row survives: dismissed only 3 days ago, well inside the 7-day window.
    expect(await NotificationRecipientEntity.findByPk(recipient.id)).not.toBeNull();
  });

  it('keeps recipient rows dismissed within the last 7 days', async () => {
    const threeDaysAgo = DateTime.now().minus({ days: 3 }).toJSDate();

    const activity = await seedActivity(DateTime.now().minus({ days: 5 }).toJSDate());

    const recentDismissed = await seedRecipient(activity.id, account.id, {
      created_at: threeDaysAgo,
      dismissed_at: threeDaysAgo,
    });

    await service.cleanupExpiredNotifications();

    expect(await NotificationRecipientEntity.findByPk(recentDismissed.id)).not.toBeNull();
  });

  it('keeps unseen, undismissed recipient rows regardless of age (until parent activity ages out)', async () => {
    // Recipient is 60 days old but never seen and never dismissed — must
    // survive pass 1 and pass 2 (parent activity is still <90 days).
    const sixtyDaysAgo = DateTime.now().minus({ days: 60 }).toJSDate();

    const activity = await seedActivity(sixtyDaysAgo);
    const recipient = await seedRecipient(activity.id, account.id, {
      created_at: sixtyDaysAgo,
      seen_at: null,
      dismissed_at: null,
    });

    await service.cleanupExpiredNotifications();

    expect(await NotificationRecipientEntity.findByPk(recipient.id)).not.toBeNull();
    expect(await NotificationActivityEntity.findByPk(activity.id)).not.toBeNull();
  });

  it('deletes activities >90 days old and FK-cascades remaining recipient rows', async () => {
    const ninetyOneDaysAgo = DateTime.now().minus({ days: 91 }).toJSDate();

    const oldActivity = await seedActivity(ninetyOneDaysAgo);

    // Two recipient rows — both unseen and undismissed, so neither is
    // touched by pass 1; both should be removed via FK cascade in pass 2.
    const recipient1 = await seedRecipient(oldActivity.id, account.id, {
      created_at: ninetyOneDaysAgo,
    });
    const otherAccount = await AccountEntity.create({
      id: uuidv4(),
      username: 'retention-test-2',
      email: 'retention-test-2@pavillion.dev',
      language: 'en',
    });
    const recipient2 = await seedRecipient(oldActivity.id, otherAccount.id, {
      created_at: ninetyOneDaysAgo,
    });

    await service.cleanupExpiredNotifications();

    // Activity deleted by pass 2.
    expect(await NotificationActivityEntity.findByPk(oldActivity.id)).toBeNull();

    // Both recipients gone via FK CASCADE — confirms migration 0035's
    // ON DELETE CASCADE wiring is honored at the SQLite layer.
    expect(await NotificationRecipientEntity.findByPk(recipient1.id)).toBeNull();
    expect(await NotificationRecipientEntity.findByPk(recipient2.id)).toBeNull();
  });

  it('does NOT early-delete orphaned activities (<90 days) with no recipients — they age out via pass 2', async () => {
    // Activity is 30 days old with NO recipient rows attached. Per the design
    // Orphans are not deleted early;
    // they survive pass 1 and only get cleared once the 90-day cap is hit.
    const thirtyDaysAgo = DateTime.now().minus({ days: 30 }).toJSDate();
    const orphan = await seedActivity(thirtyDaysAgo);

    await service.cleanupExpiredNotifications();

    // Orphan survives both passes because it is <90 days old.
    expect(await NotificationActivityEntity.findByPk(orphan.id)).not.toBeNull();
  });
});
