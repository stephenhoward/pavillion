/**
 * Calendar Follow/Unfollow Tests
 *
 * These tests verify that the ActivityPub Follow and Undo(Follow) activities
 * work correctly between two Pavillion instances.
 *
 * Follow Flow:
 * 1. Beta's calendar sends a Follow activity to Alpha's calendar inbox
 * 2. Alpha's instance processes the Follow and sends an Accept activity back
 * 3. Beta's calendar is now following Alpha's calendar
 * 4. Alpha's calendar now has Beta's calendar as a follower
 *
 * Unfollow Flow:
 * 1. Beta's calendar sends an Undo(Follow) activity to Alpha's calendar inbox
 * 2. Alpha's instance processes the Undo and removes the follower relationship
 *
 * Prerequisites:
 * - Federation environment running: npm run federation:start
 * - /etc/hosts entries for alpha.federation.local and beta.federation.local
 */

import { test, expect } from '@playwright/test';
import { INSTANCE_ALPHA, INSTANCE_BETA, formatRemoteCalendarId, generateCalendarName } from './helpers/instances';
import {
  getToken,
  createCalendar,
  followCalendar,
  unfollowCalendar,
  getFollows,
  getFollowers,
} from './helpers/api';

test.describe('Calendar Follow/Unfollow', () => {
  let aliceToken: string;
  let bobToken: string;
  let aliceCalendar: { id: string; urlName: string };
  let bobCalendar: { id: string; urlName: string };

  test.beforeAll(async () => {
    // Get authentication tokens for both instances
    aliceToken = await getToken(
      INSTANCE_ALPHA,
      INSTANCE_ALPHA.adminEmail,
      INSTANCE_ALPHA.adminPassword
    );

    bobToken = await getToken(
      INSTANCE_BETA,
      INSTANCE_BETA.adminEmail,
      INSTANCE_BETA.adminPassword
    );

    // Create calendars on both instances
    aliceCalendar = await createCalendar(INSTANCE_ALPHA, aliceToken, {
      urlName: generateCalendarName('af'),
      content: {
        en: { name: 'Alpha Follow Test Calendar' },
      },
    });

    bobCalendar = await createCalendar(INSTANCE_BETA, bobToken, {
      urlName: generateCalendarName('bf'),
      content: {
        en: { name: 'Beta Follow Test Calendar' },
      },
    });
  });

  test('Instance B can follow Instance A calendar', async () => {
    // Get the remote calendar identifier that Beta will follow (format: calendar@domain)
    const aliceCalendarRemoteId = formatRemoteCalendarId(aliceCalendar.urlName, INSTANCE_ALPHA);

    // Beta follows Alpha's calendar
    await followCalendar(INSTANCE_BETA, bobToken, bobCalendar.id, aliceCalendarRemoteId);

    // Verify Beta is now following Alpha
    // Allow some time for federation to process
    await new Promise(resolve => setTimeout(resolve, 2000));

    const follows = await getFollows(INSTANCE_BETA, bobToken, bobCalendar.id);

    // Check that Alpha's calendar is in the follows list
    // The remoteCalendarId format is: calendar_name@domain
    const isFollowing = follows.some(
      (follow) => follow.remoteCalendarId === aliceCalendarRemoteId ||
                  follow.remoteCalendarId.includes(aliceCalendar.urlName)
    );

    expect(isFollowing).toBe(true);
  });

  test('Follow activity is delivered to Instance A inbox', async () => {
    // This test verifies that when Beta follows Alpha, Alpha receives the follow
    // and records Beta as a follower

    // Create fresh calendars for this test to avoid state from previous test
    const freshAlphaCalendar = await createCalendar(INSTANCE_ALPHA, aliceToken, {
      urlName: generateCalendarName('ai'),
      content: {
        en: { name: 'Alpha Inbox Test Calendar' },
      },
    });

    const freshBetaCalendar = await createCalendar(INSTANCE_BETA, bobToken, {
      urlName: generateCalendarName('bi'),
      content: {
        en: { name: 'Beta Inbox Test Calendar' },
      },
    });

    // Beta follows Alpha's fresh calendar
    const aliceCalendarRemoteId = formatRemoteCalendarId(freshAlphaCalendar.urlName, INSTANCE_ALPHA);
    await followCalendar(INSTANCE_BETA, bobToken, freshBetaCalendar.id, aliceCalendarRemoteId);

    // Wait for federation to process
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Verify Alpha sees Beta as a follower
    const followers = await getFollowers(INSTANCE_ALPHA, aliceToken, freshAlphaCalendar.id);

    // Check that Beta's calendar is in the followers list
    // The calendarActorId format is: calendar_name@domain
    const hasFollower = followers.some(
      (follower) => follower.calendarActorId.includes(INSTANCE_BETA.domain) ||
                    follower.calendarActorId.includes(freshBetaCalendar.urlName)
    );

    expect(hasFollower).toBe(true);
  });

  test('Instance A sends Accept activity in response to Follow', async () => {
    // This test verifies the Accept activity is sent by checking that
    // the follow relationship is properly established (Accept is implicit
    // when the follow succeeds)

    const acceptTestAlphaCalendar = await createCalendar(INSTANCE_ALPHA, aliceToken, {
      urlName: generateCalendarName('aa'),
      content: {
        en: { name: 'Alpha Accept Test Calendar' },
      },
    });

    const acceptTestBetaCalendar = await createCalendar(INSTANCE_BETA, bobToken, {
      urlName: generateCalendarName('ba'),
      content: {
        en: { name: 'Beta Accept Test Calendar' },
      },
    });

    const aliceCalendarRemoteId = formatRemoteCalendarId(acceptTestAlphaCalendar.urlName, INSTANCE_ALPHA);

    // Beta follows Alpha
    await followCalendar(INSTANCE_BETA, bobToken, acceptTestBetaCalendar.id, aliceCalendarRemoteId);

    // Wait for federation to process
    await new Promise(resolve => setTimeout(resolve, 3000));

    // If the follow succeeded and we can see it in Beta's follows list,
    // it means Alpha accepted the follow
    const follows = await getFollows(INSTANCE_BETA, bobToken, acceptTestBetaCalendar.id);

    const followSucceeded = follows.some(
      (follow) => follow.remoteCalendarId === aliceCalendarRemoteId ||
                  follow.remoteCalendarId.includes(acceptTestAlphaCalendar.urlName)
    );

    expect(followSucceeded).toBe(true);

    // Also verify Alpha has Beta as a follower
    const followers = await getFollowers(INSTANCE_ALPHA, aliceToken, acceptTestAlphaCalendar.id);
    expect(followers.length).toBeGreaterThan(0);
  });

  test('Instance B can unfollow Instance A calendar', async () => {
    // Create fresh calendars for the unfollow test
    const unfollowAlphaCalendar = await createCalendar(INSTANCE_ALPHA, aliceToken, {
      urlName: generateCalendarName('au'),
      content: {
        en: { name: 'Alpha Unfollow Test Calendar' },
      },
    });

    const unfollowBetaCalendar = await createCalendar(INSTANCE_BETA, bobToken, {
      urlName: generateCalendarName('bu'),
      content: {
        en: { name: 'Beta Unfollow Test Calendar' },
      },
    });

    const aliceCalendarRemoteId = formatRemoteCalendarId(unfollowAlphaCalendar.urlName, INSTANCE_ALPHA);

    // First, Beta follows Alpha
    await followCalendar(INSTANCE_BETA, bobToken, unfollowBetaCalendar.id, aliceCalendarRemoteId);

    // Wait for follow to process
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verify the follow exists
    let follows = await getFollows(INSTANCE_BETA, bobToken, unfollowBetaCalendar.id);
    const followBefore = follows.find(
      (follow) => follow.remoteCalendarId === aliceCalendarRemoteId ||
                  follow.remoteCalendarId.includes(unfollowAlphaCalendar.urlName)
    );
    expect(followBefore).toBeDefined();

    // Now Beta unfollows Alpha using the follow ID
    if (followBefore) {
      await unfollowCalendar(
        INSTANCE_BETA,
        bobToken,
        followBefore.id,
        unfollowBetaCalendar.id,
        aliceCalendarRemoteId
      );
    }

    // Wait for unfollow to process
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verify the follow no longer exists
    follows = await getFollows(INSTANCE_BETA, bobToken, unfollowBetaCalendar.id);
    const followAfter = follows.find(
      (follow) => follow.remoteCalendarId === aliceCalendarRemoteId ||
                  follow.remoteCalendarId.includes(unfollowAlphaCalendar.urlName)
    );

    expect(followAfter).toBeUndefined();
  });

  test('Undo(Follow) activity is delivered to Instance A', async () => {
    // This test verifies that when Beta unfollows Alpha, Alpha removes
    // Beta from her followers list

    const undoAlphaCalendar = await createCalendar(INSTANCE_ALPHA, aliceToken, {
      urlName: generateCalendarName('ax'),
      content: {
        en: { name: 'Alpha Undo Test Calendar' },
      },
    });

    const undoBetaCalendar = await createCalendar(INSTANCE_BETA, bobToken, {
      urlName: generateCalendarName('bx'),
      content: {
        en: { name: 'Beta Undo Test Calendar' },
      },
    });

    const aliceCalendarRemoteId = formatRemoteCalendarId(undoAlphaCalendar.urlName, INSTANCE_ALPHA);

    // Beta follows Alpha
    await followCalendar(INSTANCE_BETA, bobToken, undoBetaCalendar.id, aliceCalendarRemoteId);

    // Wait for follow to process
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Verify Alpha has Beta as a follower
    let followers = await getFollowers(INSTANCE_ALPHA, aliceToken, undoAlphaCalendar.id);
    expect(followers.length).toBeGreaterThan(0);

    // Get the follow ID so we can unfollow
    const follows = await getFollows(INSTANCE_BETA, bobToken, undoBetaCalendar.id);
    const follow = follows.find(
      (f) => f.remoteCalendarId === aliceCalendarRemoteId ||
             f.remoteCalendarId.includes(undoAlphaCalendar.urlName)
    );

    if (follow) {
      // Beta unfollows Alpha
      await unfollowCalendar(
        INSTANCE_BETA,
        bobToken,
        follow.id,
        undoBetaCalendar.id,
        aliceCalendarRemoteId
      );
    }

    // Wait for undo to process
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Verify Alpha no longer has Beta as a follower
    followers = await getFollowers(INSTANCE_ALPHA, aliceToken, undoAlphaCalendar.id);

    const stillHasFollower = followers.some(
      (follower) => follower.calendarActorId.includes(INSTANCE_BETA.domain) ||
                    follower.calendarActorId.includes(undoBetaCalendar.urlName)
    );

    expect(stillHasFollower).toBe(false);
  });
});
