import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import db from '@/server/common/entity/db';
import { CalendarEditorRemoteEntity } from '@/server/calendar/entity/calendar_editor_remote';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { AccountEntity } from '@/server/common/entity/account';

describe('CalendarEditorRemoteEntity', () => {
  let testCalendarId: string;
  let testAccountId: string;

  beforeEach(async () => {
    // Reset database for each test
    await db.sync({ force: true });

    // Create test account
    testAccountId = uuidv4();
    await AccountEntity.create({
      id: testAccountId,
      email: 'test@example.com',
      is_activated: true,
    });

    // Create test calendar
    testCalendarId = uuidv4();
    await CalendarEntity.create({
      id: testCalendarId,
      account_id: testAccountId,
      url_name: 'test_calendar',
      languages: 'en',
    });
  });

  afterEach(async () => {
    // Clean up
    await CalendarEditorRemoteEntity.destroy({ where: {}, force: true });
    await CalendarEntity.destroy({ where: {}, force: true });
    await AccountEntity.destroy({ where: {}, force: true });
  });

  it('should create a remote editor record', async () => {
    const remoteEditor = await CalendarEditorRemoteEntity.create({
      id: uuidv4(),
      calendar_id: testCalendarId,
      actor_uri: 'https://beta.federation.local/users/Admin',
      remote_username: 'Admin',
      remote_domain: 'beta.federation.local',
      granted_by: testAccountId,
    });

    expect(remoteEditor.id).toBeDefined();
    expect(remoteEditor.calendar_id).toBe(testCalendarId);
    expect(remoteEditor.actor_uri).toBe('https://beta.federation.local/users/Admin');
    expect(remoteEditor.remote_username).toBe('Admin');
    expect(remoteEditor.remote_domain).toBe('beta.federation.local');
    expect(remoteEditor.granted_by).toBe(testAccountId);
  });

  it('should convert to model correctly', async () => {
    const remoteEditor = await CalendarEditorRemoteEntity.create({
      id: uuidv4(),
      calendar_id: testCalendarId,
      actor_uri: 'https://beta.federation.local/users/Admin',
      remote_username: 'Admin',
      remote_domain: 'beta.federation.local',
      granted_by: testAccountId,
    });

    const model = remoteEditor.toModel();

    expect(model.id).toBe(remoteEditor.id);
    expect(model.calendarId).toBe(testCalendarId);
    expect(model.actorUri).toBe('https://beta.federation.local/users/Admin');
    expect(model.remoteUsername).toBe('Admin');
    expect(model.remoteDomain).toBe('beta.federation.local');
    expect(model.grantedBy).toBe(testAccountId);
  });

  it('should enforce unique constraint on (calendar_id, actor_uri)', async () => {
    await CalendarEditorRemoteEntity.create({
      id: uuidv4(),
      calendar_id: testCalendarId,
      actor_uri: 'https://beta.federation.local/users/Admin',
      remote_username: 'Admin',
      remote_domain: 'beta.federation.local',
      granted_by: testAccountId,
    });

    // Attempt to create duplicate should fail
    await expect(CalendarEditorRemoteEntity.create({
      id: uuidv4(),
      calendar_id: testCalendarId,
      actor_uri: 'https://beta.federation.local/users/Admin',
      remote_username: 'Admin',
      remote_domain: 'beta.federation.local',
      granted_by: testAccountId,
    })).rejects.toThrow();
  });

  it('should allow same actor on different calendars', async () => {
    // Create second calendar
    const secondCalendarId = uuidv4();
    await CalendarEntity.create({
      id: secondCalendarId,
      account_id: testAccountId,
      url_name: 'second_calendar',
      languages: 'en',
    });

    // Same actor on first calendar
    await CalendarEditorRemoteEntity.create({
      id: uuidv4(),
      calendar_id: testCalendarId,
      actor_uri: 'https://beta.federation.local/users/Admin',
      remote_username: 'Admin',
      remote_domain: 'beta.federation.local',
      granted_by: testAccountId,
    });

    // Same actor on second calendar should work
    const secondEditor = await CalendarEditorRemoteEntity.create({
      id: uuidv4(),
      calendar_id: secondCalendarId,
      actor_uri: 'https://beta.federation.local/users/Admin',
      remote_username: 'Admin',
      remote_domain: 'beta.federation.local',
      granted_by: testAccountId,
    });

    expect(secondEditor.id).toBeDefined();
  });

  it('should cascade delete when calendar is deleted', async () => {
    await CalendarEditorRemoteEntity.create({
      id: uuidv4(),
      calendar_id: testCalendarId,
      actor_uri: 'https://beta.federation.local/users/Admin',
      remote_username: 'Admin',
      remote_domain: 'beta.federation.local',
      granted_by: testAccountId,
    });

    // Verify editor exists
    let count = await CalendarEditorRemoteEntity.count({ where: { calendar_id: testCalendarId } });
    expect(count).toBe(1);

    // Delete calendar
    await CalendarEntity.destroy({ where: { id: testCalendarId } });

    // Verify editor was cascade deleted
    count = await CalendarEditorRemoteEntity.count({ where: { calendar_id: testCalendarId } });
    expect(count).toBe(0);
  });
});
