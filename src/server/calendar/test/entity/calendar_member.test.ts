import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { CalendarMember } from '@/common/model/calendar_member';
import { CalendarMemberEntity } from '@/server/calendar/entity/calendar_member';

describe('CalendarMemberEntity', () => {

  afterEach(() => {
    // Clean up any test data if needed
  });

  describe('fromModel', () => {
    it('should create entity from a local member model', () => {
      const accountId = uuidv4();
      const calendarId = uuidv4();
      const grantedBy = uuidv4();
      const member = new CalendarMember(
        'test-member-id',
        calendarId,
        null, // calendarActorId - null for local calendar membership
        'editor',
        accountId,
        null,
        grantedBy,
      );

      const entity = CalendarMemberEntity.fromModel(member);

      expect(entity.id).toBe('test-member-id');
      expect(entity.calendar_id).toBe(calendarId);
      expect(entity.calendar_actor_id).toBeNull();
      expect(entity.role).toBe('editor');
      expect(entity.account_id).toBe(accountId);
      expect(entity.user_actor_id).toBeNull();
      expect(entity.granted_by).toBe(grantedBy);
    });

    it('should create entity from a remote member model', () => {
      const userActorId = uuidv4();
      const calendarId = uuidv4();
      const grantedBy = uuidv4();
      const member = new CalendarMember(
        'test-remote-id',
        calendarId,
        null, // calendarActorId - null for local calendar membership
        'editor',
        null,
        userActorId,
        grantedBy,
      );

      const entity = CalendarMemberEntity.fromModel(member);

      expect(entity.id).toBe('test-remote-id');
      expect(entity.calendar_id).toBe(calendarId);
      expect(entity.calendar_actor_id).toBeNull();
      expect(entity.role).toBe('editor');
      expect(entity.account_id).toBeNull();
      expect(entity.user_actor_id).toBe(userActorId);
      expect(entity.granted_by).toBe(grantedBy);
    });

    it('should create entity from an owner model with null grantedBy', () => {
      const accountId = uuidv4();
      const calendarId = uuidv4();
      const member = new CalendarMember(
        'test-owner-id',
        calendarId,
        null, // calendarActorId - null for local calendar membership
        'owner',
        accountId,
        null,
        null,
      );

      const entity = CalendarMemberEntity.fromModel(member);

      expect(entity.id).toBe('test-owner-id');
      expect(entity.calendar_id).toBe(calendarId);
      expect(entity.calendar_actor_id).toBeNull();
      expect(entity.role).toBe('owner');
      expect(entity.account_id).toBe(accountId);
      expect(entity.user_actor_id).toBeNull();
      expect(entity.granted_by).toBeNull();
    });
  });

  describe('toModel', () => {
    it('should convert a local member entity to model', () => {
      const accountId = uuidv4();
      const calendarId = uuidv4();
      const grantedBy = uuidv4();
      const member = new CalendarMember(
        'test-member-id',
        calendarId,
        null, // calendarActorId - null for local calendar membership
        'editor',
        accountId,
        null,
        grantedBy,
      );

      const entity = CalendarMemberEntity.fromModel(member);
      const model = entity.toModel();

      expect(model).toBeInstanceOf(CalendarMember);
      expect(model.id).toBe('test-member-id');
      expect(model.calendarId).toBe(calendarId);
      expect(model.calendarActorId).toBeNull();
      expect(model.role).toBe('editor');
      expect(model.accountId).toBe(accountId);
      expect(model.userActorId).toBeNull();
      expect(model.grantedBy).toBe(grantedBy);
    });

    it('should convert a remote member entity to model', () => {
      const userActorId = uuidv4();
      const calendarId = uuidv4();
      const grantedBy = uuidv4();
      const member = new CalendarMember(
        'test-remote-id',
        calendarId,
        null, // calendarActorId - null for local calendar membership
        'editor',
        null,
        userActorId,
        grantedBy,
      );

      const entity = CalendarMemberEntity.fromModel(member);
      const model = entity.toModel();

      expect(model).toBeInstanceOf(CalendarMember);
      expect(model.id).toBe('test-remote-id');
      expect(model.calendarId).toBe(calendarId);
      expect(model.calendarActorId).toBeNull();
      expect(model.role).toBe('editor');
      expect(model.accountId).toBeNull();
      expect(model.userActorId).toBe(userActorId);
      expect(model.grantedBy).toBe(grantedBy);
    });
  });

  describe('round-trip conversion', () => {
    it('should maintain data integrity for local member through model-entity-model', () => {
      const accountId = uuidv4();
      const calendarId = uuidv4();
      const grantedBy = uuidv4();
      const originalModel = new CalendarMember(
        'round-trip-id',
        calendarId,
        null, // calendarActorId - null for local calendar membership
        'editor',
        accountId,
        null,
        grantedBy,
      );

      const entity = CalendarMemberEntity.fromModel(originalModel);
      const roundTripModel = entity.toModel();

      expect(roundTripModel.id).toBe(originalModel.id);
      expect(roundTripModel.calendarId).toBe(originalModel.calendarId);
      expect(roundTripModel.calendarActorId).toBe(originalModel.calendarActorId);
      expect(roundTripModel.role).toBe(originalModel.role);
      expect(roundTripModel.accountId).toBe(originalModel.accountId);
      expect(roundTripModel.userActorId).toBe(originalModel.userActorId);
      expect(roundTripModel.grantedBy).toBe(originalModel.grantedBy);
    });

    it('should maintain data integrity for remote member through model-entity-model', () => {
      const userActorId = uuidv4();
      const calendarId = uuidv4();
      const grantedBy = uuidv4();
      const originalModel = new CalendarMember(
        'round-trip-remote-id',
        calendarId,
        null, // calendarActorId - null for local calendar membership
        'editor',
        null,
        userActorId,
        grantedBy,
      );

      const entity = CalendarMemberEntity.fromModel(originalModel);
      const roundTripModel = entity.toModel();

      expect(roundTripModel.id).toBe(originalModel.id);
      expect(roundTripModel.calendarId).toBe(originalModel.calendarId);
      expect(roundTripModel.calendarActorId).toBe(originalModel.calendarActorId);
      expect(roundTripModel.role).toBe(originalModel.role);
      expect(roundTripModel.accountId).toBe(originalModel.accountId);
      expect(roundTripModel.userActorId).toBe(originalModel.userActorId);
      expect(roundTripModel.grantedBy).toBe(originalModel.grantedBy);
    });

    it('should maintain data integrity for owner through model-entity-model', () => {
      const accountId = uuidv4();
      const calendarId = uuidv4();
      const originalModel = new CalendarMember(
        'round-trip-owner-id',
        calendarId,
        null, // calendarActorId - null for local calendar membership
        'owner',
        accountId,
        null,
        null,
      );

      const entity = CalendarMemberEntity.fromModel(originalModel);
      const roundTripModel = entity.toModel();

      expect(roundTripModel.id).toBe(originalModel.id);
      expect(roundTripModel.calendarId).toBe(originalModel.calendarId);
      expect(roundTripModel.calendarActorId).toBe(originalModel.calendarActorId);
      expect(roundTripModel.role).toBe('owner');
      expect(roundTripModel.accountId).toBe(originalModel.accountId);
      expect(roundTripModel.userActorId).toBeNull();
      expect(roundTripModel.grantedBy).toBeNull();
    });
  });
});
